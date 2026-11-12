import { prisma } from "../db.js";
import { config } from "../config.js";
import { lockDevice, unlockDevice } from "./lock.js";

export interface OverdueResult {
  contractsChecked: number;
  locked: string[]; // deviceIds locked
  unlocked: string[]; // deviceIds unlocked (payment caught up)
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * The core nasiya rule, evaluated per active contract:
 *  - If any payment is unpaid and more than `graceDays` past its due date,
 *    the device should be LOCKED.
 *  - Otherwise, if it is currently locked, it should be UNLOCKED (caught up).
 *
 * Safe to run repeatedly (cron). Only acts when the desired state differs
 * from the current device state, so it won't spam lock events.
 */
export async function evaluateOverdue(
  asOf: Date = new Date(),
  graceDays: number = config.overdueGraceDays
): Promise<OverdueResult> {
  const result: OverdueResult = { contractsChecked: 0, locked: [], unlocked: [] };

  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE" },
    include: { device: true, payments: true },
  });

  for (const contract of contracts) {
    result.contractsChecked++;
    const device = contract.device;
    if (!device || device.enrollmentStatus !== "ENROLLED") continue;

    const hasOverdue = contract.payments.some(
      (p) =>
        p.status !== "PAID" &&
        p.paidDate === null &&
        daysBetween(asOf, p.dueDate) > graceDays
    );

    // Keep payment rows' status honest as a side effect.
    await markOverdueStatuses(contract.payments, asOf);

    if (hasOverdue && device.lockState === "UNLOCKED") {
      await lockDevice(
        device.id,
        "This device is locked for a missed payment. Please contact your store to resume.",
        { triggeredBy: "SYSTEM", reason: "Payment overdue" }
      );
      result.locked.push(device.id);
    } else if (!hasOverdue && device.lockState === "LOCKED") {
      await unlockDevice(device.id, {
        triggeredBy: "SYSTEM",
        reason: "Payments caught up",
      });
      result.unlocked.push(device.id);
    }
  }

  return result;
}

async function markOverdueStatuses(
  payments: { id: string; status: string; paidDate: Date | null; dueDate: Date }[],
  asOf: Date
) {
  for (const p of payments) {
    if (p.paidDate) continue;
    const shouldBe = asOf > p.dueDate ? "OVERDUE" : "DUE";
    if (p.status !== shouldBe) {
      await prisma.payment.update({ where: { id: p.id }, data: { status: shouldBe as any } });
    }
  }
}
