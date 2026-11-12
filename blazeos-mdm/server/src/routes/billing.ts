import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/http.js";
import { requireRole, tenantScope } from "../auth.js";
import {
  billingSummary,
  currentPeriod,
  generateChargesForPeriod,
} from "../services/billing.js";

export const billingRouter = Router();

// Summary grouped by store + period. Store users see only their own.
billingRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const summary = await billingSummary(storeId);
    res.json({ currentPeriod: currentPeriod(), rows: summary });
  })
);

// Raw charge lines, scoped.
billingRouter.get(
  "/charges",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const charges = await prisma.billingCharge.findMany({
      where: storeId ? { storeId } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { store: { select: { name: true } } },
    });
    res.json(charges);
  })
);

// Generate charges for a period — MAIN_ADMIN only.
const genSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });

billingRouter.post(
  "/generate",
  requireRole("MAIN_ADMIN"),
  asyncHandler(async (req, res) => {
    const { period } = genSchema.parse(req.body ?? {});
    const result = await generateChargesForPeriod(period ?? currentPeriod());
    res.json(result);
  })
);
