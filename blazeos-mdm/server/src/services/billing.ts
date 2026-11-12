import { prisma } from "../db.js";

// Billing model: BlazeOS charges each store a per-device monthly fee for every
// device under management (ENROLLED). Charges are generated per period (YYYY-MM)
// and are idempotent — running generation twice for the same period won't
// double-charge.

export function currentPeriod(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface GenerateResult {
  period: string;
  storesCharged: number;
  devicesCharged: number;
  skippedExisting: number;
  totalAmount: number;
}

/**
 * Generate PER_DEVICE_MONTH charges for the given period.
 * One charge per enrolled device in each active store, at the store's rate.
 */
export async function generateChargesForPeriod(
  period: string = currentPeriod()
): Promise<GenerateResult> {
  const result: GenerateResult = {
    period,
    storesCharged: 0,
    devicesCharged: 0,
    skippedExisting: 0,
    totalAmount: 0,
  };

  const stores = await prisma.store.findMany({
    where: { status: "ACTIVE" },
    include: { devices: { where: { enrollmentStatus: "ENROLLED" } } },
  });

  for (const store of stores) {
    if (store.devices.length === 0) continue;
    let chargedThisStore = 0;

    for (const device of store.devices) {
      const existing = await prisma.billingCharge.findFirst({
        where: {
          storeId: store.id,
          deviceId: device.id,
          chargeType: "PER_DEVICE_MONTH",
          period,
        },
      });
      if (existing) {
        result.skippedExisting++;
        continue;
      }
      const amount = store.monthlyFeeAmount;
      await prisma.billingCharge.create({
        data: {
          storeId: store.id,
          deviceId: device.id,
          chargeType: "PER_DEVICE_MONTH",
          amount,
          period,
        },
      });
      chargedThisStore++;
      result.devicesCharged++;
      result.totalAmount += Number(amount);
    }
    if (chargedThisStore > 0) result.storesCharged++;
  }

  return result;
}

export interface StoreBilling {
  storeId: string;
  storeName: string;
  period: string;
  deviceCount: number;
  total: number;
}

/**
 * Billing summary grouped by store and period.
 * storeId filter: store users see only their own; main admin sees all (or one).
 */
export async function billingSummary(storeId: string | null): Promise<StoreBilling[]> {
  const charges = await prisma.billingCharge.findMany({
    where: storeId ? { storeId } : {},
    include: { store: { select: { name: true } } },
    orderBy: { period: "desc" },
  });

  const map = new Map<string, StoreBilling>();
  for (const c of charges) {
    const key = `${c.storeId}:${c.period}`;
    const existing = map.get(key);
    if (existing) {
      existing.total += Number(c.amount);
      if (c.deviceId) existing.deviceCount++;
    } else {
      map.set(key, {
        storeId: c.storeId,
        storeName: c.store.name,
        period: c.period ?? "—",
        deviceCount: c.deviceId ? 1 : 0,
        total: Number(c.amount),
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    b.period.localeCompare(a.period) || a.storeName.localeCompare(b.storeName)
  );
}
