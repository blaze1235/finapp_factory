import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, NotFoundError } from "../lib/http.js";
import { tenantScope } from "../auth.js";
import { unlockDevice } from "../services/lock.js";

export const paymentsRouter = Router();

contractsScopedList();
function contractsScopedList() {
  paymentsRouter.get(
    "/",
    asyncHandler(async (req, res) => {
      const storeId = tenantScope(req);
      const payments = await prisma.payment.findMany({
        where: storeId ? { storeId } : {},
        orderBy: { dueDate: "asc" },
        include: {
          contract: { include: { buyer: { select: { fullName: true } }, device: { select: { imei: true } } } },
        },
      });
      res.json(payments);
    })
  );
}

const paySchema = z.object({
  method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).default("CASH"),
  paidDate: z.string().optional(),
});

// Record a payment as paid. If this clears the contract's overdue state,
// auto-unlock the device. If it was the final payment, mark contract paid off.
paymentsRouter.post(
  "/:id/pay",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const body = paySchema.parse(req.body ?? {});
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.id, ...(storeId ? { storeId } : {}) },
      include: { contract: { include: { device: true, payments: true } } },
    });
    if (!payment) throw new NotFoundError("Payment not found");

    const paidDate = body.paidDate ? new Date(body.paidDate) : new Date();
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidDate, method: body.method },
    });

    const contract = payment.contract;
    const device = contract.device;

    // Recompute overdue after this payment.
    const now = new Date();
    const stillOverdue = contract.payments.some(
      (p) => p.id !== payment.id && p.status !== "PAID" && p.paidDate === null && p.dueDate < now
    );

    let unlocked = false;
    if (!stillOverdue && device && device.lockState === "LOCKED") {
      await unlockDevice(device.id, { triggeredBy: "SYSTEM", reason: "Payment received" });
      unlocked = true;
    }

    // Final payment? Mark contract paid off.
    const remaining = contract.payments.filter((p) => p.id !== payment.id && p.status !== "PAID");
    let paidOff = false;
    if (remaining.length === 0) {
      await prisma.contract.update({ where: { id: contract.id }, data: { status: "PAID_OFF" } });
      paidOff = true;
    }

    res.json({ ok: true, unlocked, paidOff });
  })
);
