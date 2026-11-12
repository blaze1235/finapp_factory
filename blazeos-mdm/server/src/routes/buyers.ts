import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, NotFoundError } from "../lib/http.js";
import { resolveWriteStoreId, tenantScope } from "../auth.js";

export const buyersRouter = Router();

buyersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const buyers = await prisma.buyer.findMany({
      where: storeId ? { storeId } : {},
      orderBy: { createdAt: "desc" },
      include: {
        store: { select: { name: true } },
        _count: { select: { devices: true, contracts: true } },
      },
    });
    res.json(buyers);
  })
);

buyersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const storeId = tenantScope(req);
    const buyer = await prisma.buyer.findFirst({
      where: { id: req.params.id, ...(storeId ? { storeId } : {}) },
      include: {
        devices: true,
        contracts: { include: { payments: true, device: true } },
      },
    });
    if (!buyer) throw new NotFoundError("Buyer not found");
    res.json(buyer);
  })
);

const createSchema = z.object({
  storeId: z.string().optional(), // main admin only
  fullName: z.string().min(1),
  idNumber: z.string().min(1),
  phone: z.string().min(1),
  guarantorInfo: z
    .object({ name: z.string(), phone: z.string(), idNumber: z.string().optional() })
    .optional(),
});

buyersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const storeId = resolveWriteStoreId(req, body.storeId);
    const buyer = await prisma.buyer.create({
      data: {
        storeId,
        fullName: body.fullName,
        idNumber: body.idNumber,
        phone: body.phone,
        guarantorInfo: body.guarantorInfo ?? undefined,
      },
    });
    res.status(201).json(buyer);
  })
);
