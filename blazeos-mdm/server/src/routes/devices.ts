import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, BadRequestError, NotFoundError } from "../lib/http.js";
import { requireRole, resolveWriteStoreId, tenantScope } from "../auth.js";
import { enrollDevice, lockDevice, releaseDevice, unlockDevice } from "../services/lock.js";

export const devicesRouter = Router();

// Ensure a device belongs to the caller's tenant (or caller is main admin).
async function assertDeviceInScope(req: any, deviceId: string) {
  const storeId = tenantScope(req);
  const device = await prisma.device.findFirst({
    where: { id: deviceId, ...(storeId ? { storeId } : {}) },
  });
  if (!device) throw new NotFoundError("Device not found");
  return device;
}

devicesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const devices = await prisma.device.findMany({
      where: storeId ? { storeId } : {},
      orderBy: { createdAt: "desc" },
      include: {
        buyer: { select: { fullName: true, phone: true } },
        store: { select: { name: true } },
        contract: { select: { status: true } },
      },
    });
    res.json(devices);
  })
);

devicesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertDeviceInScope(req, req.params.id);
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
      include: {
        buyer: true,
        store: { select: { name: true } },
        contract: { include: { payments: { orderBy: { dueDate: "asc" } } } },
        lockEvents: { orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { name: true } } } },
      },
    });
    res.json(device);
  })
);

const createSchema = z.object({
  storeId: z.string().optional(),
  buyerId: z.string().optional(),
  imei: z.string().min(10),
  serial: z.string().optional(),
  model: z.string().optional(),
});

devicesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const storeId = resolveWriteStoreId(req, body.storeId);
    const existing = await prisma.device.findUnique({ where: { imei: body.imei } });
    if (existing) throw new BadRequestError("A device with this IMEI already exists");
    const device = await prisma.device.create({
      data: {
        storeId,
        buyerId: body.buyerId,
        imei: body.imei,
        serial: body.serial,
        model: body.model,
      },
    });
    res.status(201).json(device);
  })
);

// Enroll — staff may do this at point of sale.
devicesRouter.post(
  "/:id/enroll",
  asyncHandler(async (req, res) => {
    await assertDeviceInScope(req, req.params.id);
    const device = await enrollDevice(req.params.id, {
      triggeredBy: "USER",
      userId: req.user!.userId,
      reason: "Enrolled at point of sale",
    });
    res.json(device);
  })
);

// Lock / unlock / release — STORE_ADMIN and MAIN_ADMIN only (not staff).
const adminOnly = requireRole("MAIN_ADMIN", "STORE_ADMIN");

const lockSchema = z.object({ message: z.string().optional(), reason: z.string().optional() });

devicesRouter.post(
  "/:id/lock",
  adminOnly,
  asyncHandler(async (req, res) => {
    await assertDeviceInScope(req, req.params.id);
    const body = lockSchema.parse(req.body ?? {});
    const device = await lockDevice(
      req.params.id,
      body.message ?? "This device is locked. Please contact your store.",
      { triggeredBy: "USER", userId: req.user!.userId, reason: body.reason ?? "Manual lock" }
    );
    res.json(device);
  })
);

devicesRouter.post(
  "/:id/unlock",
  adminOnly,
  asyncHandler(async (req, res) => {
    await assertDeviceInScope(req, req.params.id);
    const device = await unlockDevice(req.params.id, {
      triggeredBy: "USER",
      userId: req.user!.userId,
      reason: (req.body?.reason as string) ?? "Manual unlock",
    });
    res.json(device);
  })
);

devicesRouter.post(
  "/:id/release",
  adminOnly,
  asyncHandler(async (req, res) => {
    await assertDeviceInScope(req, req.params.id);
    const device = await releaseDevice(req.params.id, {
      triggeredBy: "USER",
      userId: req.user!.userId,
      reason: "Released from management",
    });
    res.json(device);
  })
);
