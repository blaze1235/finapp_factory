import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, BadRequestError } from "../lib/http.js";
import { requireAuth, signToken, verifyPassword } from "../auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new BadRequestError("Invalid email or password");
    }
    const token = signToken({ userId: user.id, role: user.role, storeId: user.storeId });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      },
    });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { store: true },
    });
    if (!user) throw new BadRequestError("User not found");
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      storeId: user.storeId,
      storeName: user.store?.name ?? null,
    });
  })
);
