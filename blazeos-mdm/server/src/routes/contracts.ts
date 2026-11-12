import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, BadRequestError, NotFoundError } from "../lib/http.js";
import { resolveWriteStoreId, tenantScope } from "../auth.js";

export const contractsRouter = Router();

contractsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const contracts = await prisma.contract.findMany({
      where: storeId ? { storeId } : {},
      orderBy: { createdAt: "desc" },
      include: {
        buyer: { select: { fullName: true } },
        device: { select: { imei: true, model: true, lockState: true } },
        payments: { select: { status: true, amount: true, dueDate: true, paidDate: true } },
      },
    });
    res.json(contracts);
  })
);

const createSchema = z.object({
  storeId: z.string().optional(),
  deviceId: z.string(),
  buyerId: z.string(),
  totalPrice: z.number().positive(),
  downPayment: z.number().min(0).default(0),
  termMonths: z.number().int().positive(),
  startDate: z.string(), // ISO date
});

// Creating a contract also generates the monthly payment schedule.
contractsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const storeId = resolveWriteStoreId(req, body.storeId);

    const device = await prisma.device.findFirst({ where: { id: body.deviceId, storeId } });
    if (!device) throw new NotFoundError("Device not found in this store");
    const existing = await prisma.contract.findUnique({ where: { deviceId: body.deviceId } });
    if (existing) throw new BadRequestError("This device already has a contract");

    const financed = body.totalPrice - body.downPayment;
    if (financed <= 0) throw new BadRequestError("Financed amount must be positive");
    const monthly = Math.round((financed / body.termMonths) * 100) / 100;
    const start = new Date(body.startDate);
    if (isNaN(start.getTime())) throw new BadRequestError("Invalid startDate");

    const contract = await prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({
        data: {
          storeId,
          deviceId: body.deviceId,
          buyerId: body.buyerId,
          totalPrice: body.totalPrice,
          downPayment: body.downPayment,
          termMonths: body.termMonths,
          monthlyAmount: monthly,
          startDate: start,
        },
      });
      // Generate schedule: one payment per month, first due one month after start.
      const payments = Array.from({ length: body.termMonths }, (_, i) => {
        const due = new Date(start);
        due.setMonth(due.getMonth() + i + 1);
        return { contractId: c.id, storeId, amount: monthly, dueDate: due, status: "DUE" as const };
      });
      await tx.payment.createMany({ data: payments });
      // Link buyer to device if not already.
      await tx.device.update({ where: { id: body.deviceId }, data: { buyerId: body.buyerId } });
      return c;
    });

    const withPayments = await prisma.contract.findUnique({
      where: { id: contract.id },
      include: { payments: { orderBy: { dueDate: "asc" } } },
    });
    res.status(201).json(withPayments);
  })
);
