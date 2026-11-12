import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/http.js";
import { tenantScope } from "../auth.js";
import { evaluateOverdue } from "../services/overdue.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const where = storeId ? { storeId } : {};

    const [
      deviceTotal,
      enrolled,
      locked,
      activeContracts,
      overduePayments,
      storeCount,
    ] = await Promise.all([
      prisma.device.count({ where }),
      prisma.device.count({ where: { ...where, enrollmentStatus: "ENROLLED" } }),
      prisma.device.count({ where: { ...where, lockState: "LOCKED" } }),
      prisma.contract.count({ where: { ...where, status: "ACTIVE" } }),
      prisma.payment.count({
        where: { ...where, status: { not: "PAID" }, dueDate: { lt: new Date() } },
      }),
      storeId ? Promise.resolve(1) : prisma.store.count(),
    ]);

    res.json({
      scope: storeId ? "store" : "platform",
      stores: storeCount,
      devices: deviceTotal,
      enrolled,
      locked,
      activeContracts,
      overduePayments,
    });
  })
);

// Recent lock events feed for the dashboard.
dashboardRouter.get(
  "/events",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const events = await prisma.lockEvent.findMany({
      where: storeId ? { storeId } : {},
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        device: { select: { imei: true, model: true } },
        store: { select: { name: true } },
        user: { select: { name: true } },
      },
    });
    res.json(events);
  })
);

// Trigger the overdue evaluation on demand (also runs via cron/job).
dashboardRouter.post(
  "/evaluate-overdue",
  asyncHandler(async (_req, res) => {
    const result = await evaluateOverdue();
    res.json(result);
  })
);
