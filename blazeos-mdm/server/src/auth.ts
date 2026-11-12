import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "./config.js";

export interface AuthUser {
  userId: string;
  role: Role;
  storeId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "12h" });
}

/** Require a valid JWT. Populates req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as AuthUser;
    req.user = { userId: payload.userId, role: payload.role, storeId: payload.storeId };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Require the user to hold one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    next();
  };
}

/**
 * Tenant scope for the current request.
 * - MAIN_ADMIN: unrestricted. May optionally pass ?storeId= to focus a store;
 *   returns null meaning "all stores" when not provided.
 * - STORE_ADMIN / STORE_STAFF: always locked to their own storeId.
 *
 * Returns the storeId to filter by, or null for "no filter" (main admin, all).
 * Throws a 403 (via the sentinel) if a store user has no storeId — a data bug.
 */
export function tenantScope(req: Request): string | null {
  const u = req.user!;
  if (u.role === "MAIN_ADMIN") {
    const q = req.query.storeId;
    return typeof q === "string" && q.length > 0 ? q : null;
  }
  if (!u.storeId) throw new ForbiddenError("Store user has no store assigned");
  return u.storeId;
}

/**
 * Resolve the storeId a write must belong to.
 * - Store users: forced to their own store (ignores any body value).
 * - Main admin: must specify, since they have no implicit store.
 */
export function resolveWriteStoreId(req: Request, bodyStoreId?: string): string {
  const u = req.user!;
  if (u.role !== "MAIN_ADMIN") return u.storeId!;
  if (!bodyStoreId) throw new ForbiddenError("storeId is required for main admin writes");
  return bodyStoreId;
}

export class ForbiddenError extends Error {}
