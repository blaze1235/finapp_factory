import type { Device, LockAction, TriggeredBy } from "@prisma/client";
import { prisma } from "../db.js";
import { mdm } from "../mdm/index.js";
import { NotFoundError } from "../lib/http.js";

interface ActorContext {
  triggeredBy: TriggeredBy;
  userId?: string | null;
  reason?: string;
}

function deviceRef(device: Device) {
  return {
    deviceId: device.id,
    imei: device.imei,
    serial: device.serial,
    abmDeviceId: device.abmDeviceId,
  };
}

async function record(
  deviceId: string,
  storeId: string,
  action: LockAction,
  ctx: ActorContext
) {
  await prisma.lockEvent.create({
    data: {
      deviceId,
      storeId,
      action,
      triggeredBy: ctx.triggeredBy,
      userId: ctx.userId ?? null,
      reason: ctx.reason,
    },
  });
}

async function getDevice(deviceId: string): Promise<Device> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new NotFoundError("Device not found");
  return device;
}

/** Lock a device (Lost Mode) and log the event. Idempotent-ish: safe to call when already locked. */
export async function lockDevice(deviceId: string, message: string, ctx: ActorContext) {
  const device = await getDevice(deviceId);
  await mdm().lock(deviceRef(device), message);
  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: { lockState: "LOCKED" },
  });
  await record(deviceId, device.storeId, "LOCK", ctx);
  return updated;
}

/** Unlock a device and log the event. */
export async function unlockDevice(deviceId: string, ctx: ActorContext) {
  const device = await getDevice(deviceId);
  await mdm().unlock(deviceRef(device));
  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: { lockState: "UNLOCKED" },
  });
  await record(deviceId, device.storeId, "UNLOCK", ctx);
  return updated;
}

/** Enroll a device: assign to ABM, push supervised non-removable profile. */
export async function enrollDevice(deviceId: string, ctx: ActorContext) {
  const device = await getDevice(deviceId);
  const result = await mdm().enroll(deviceRef(device));
  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: {
      enrollmentStatus: "ENROLLED",
      abmDeviceId: result.abmDeviceId,
      mdmProfileLocked: result.profileRemovalBlocked,
      supervisedAt: new Date(),
    },
  });
  await record(deviceId, device.storeId, "ENROLL", ctx);
  return updated;
}

/** Release a device from management (e.g. on payoff). */
export async function releaseDevice(deviceId: string, ctx: ActorContext) {
  const device = await getDevice(deviceId);
  await mdm().release(deviceRef(device));
  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: { enrollmentStatus: "REMOVED", lockState: "UNLOCKED", mdmProfileLocked: false },
  });
  await record(deviceId, device.storeId, "REMOVE", ctx);
  return updated;
}
