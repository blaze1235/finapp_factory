import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, NotFoundError } from "../lib/http.js";
import { hashPassword, requireRole } from "../auth.js";

// Store management is MAIN_ADMIN only.
export const storesRouter = Router();
storesRouter.use(requireRole("MAIN_ADMIN"));

storesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const stores = await prisma.store.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { devices: true, buyers: true, users: true } },
      },
    });
    res.json(stores);
  })
);

const createStoreSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  billingPlan: z.enum(["PER_DEVICE_MONTH", "PER_EVENT"]).default("PER_DEVICE_MONTH"),
  // Optional: create the store's first admin in the same call.
  adminName: z.string().optional(),
  adminEmail: z.string().email().optional(),
  adminPassword: z.string().min(6).optional(),
});

storesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createStoreSchema.parse(req.body);
    const store = await prisma.store.create({
      data: {
        name: body.name,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        billingPlan: body.billingPlan,
      },
    });

    let admin = null;
    if (body.adminEmail && body.adminPassword && body.adminName) {
      admin = await prisma.user.create({
        data: {
          storeId: store.id,
          role: "STORE_ADMIN",
          name: body.adminName,
          email: body.adminEmail,
          passwordHash: await hashPassword(body.adminPassword),
        },
      });
    }

    res.status(201).json({ store, admin: admin ? { id: admin.id, email: admin.email } : null });
  })
);

const statusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });

storesRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const store = await prisma.store
      .update({ where: { id: req.params.id }, data: { status } })
      .catch(() => {
        throw new NotFoundError("Store not found");
      });
    res.json(store);
  })
);

// Create a store user (STORE_ADMIN or STORE_STAFF) under a store.
const createUserSchema = z.object({
  storeId: z.string(),
  role: z.enum(["STORE_ADMIN", "STORE_STAFF"]),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(6),
});

storesRouter.post(
  "/users",
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        storeId: body.storeId,
        role: body.role,
        name: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash: await hashPassword(body.password),
      },
    });
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  })
);
