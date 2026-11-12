import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function hash(p: string) {
  return bcrypt.hash(p, 10);
}
function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}
function monthsFromDate(base: Date, n: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}

// Creates the demo stores, users, buyers, devices, contracts and schedules.
// Non-destructive — callers decide whether to clear first (seed) or guard on
// an empty database (bootstrap).
export async function buildDemo(prisma: PrismaClient) {
  await prisma.user.create({
    data: {
      role: "MAIN_ADMIN",
      name: "BlazeOS Admin",
      email: "admin@blazeos.dev",
      passwordHash: await hash("admin123"),
    },
  });

  const store1 = await prisma.store.create({
    data: {
      name: "Tashkent Mobile",
      contactName: "Jahongir",
      contactPhone: "+998901112233",
      telegramChatId: "100000001",
      monthlyFeeAmount: 15000,
    },
  });
  await prisma.user.create({
    data: {
      storeId: store1.id,
      role: "STORE_ADMIN",
      name: "Jahongir (owner)",
      email: "admin@tashkentmobile.uz",
      passwordHash: await hash("store123"),
    },
  });
  await prisma.user.create({
    data: {
      storeId: store1.id,
      role: "STORE_STAFF",
      name: "Aziz (clerk)",
      email: "staff@tashkentmobile.uz",
      passwordHash: await hash("store123"),
    },
  });

  const store2 = await prisma.store.create({
    data: {
      name: "Samarqand Phones",
      contactName: "Dilshod",
      contactPhone: "+998933334455",
      telegramChatId: "100000002",
      monthlyFeeAmount: 18000,
    },
  });
  await prisma.user.create({
    data: {
      storeId: store2.id,
      role: "STORE_ADMIN",
      name: "Dilshod (owner)",
      email: "admin@samarqandphones.uz",
      passwordHash: await hash("store123"),
    },
  });

  async function makeDeal(opts: {
    storeId: string;
    buyerName: string;
    idNumber: string;
    phone: string;
    telegramChatId?: string;
    imei: string;
    model: string;
    total: number;
    down: number;
    term: number;
    startedMonthsAgo: number;
    paymentsMade: number;
    enroll: boolean;
  }) {
    const buyer = await prisma.buyer.create({
      data: {
        storeId: opts.storeId,
        fullName: opts.buyerName,
        idNumber: opts.idNumber,
        phone: opts.phone,
        telegramChatId: opts.telegramChatId,
      },
    });
    const device = await prisma.device.create({
      data: {
        storeId: opts.storeId,
        buyerId: buyer.id,
        imei: opts.imei,
        serial: "SN" + opts.imei.slice(-8),
        model: opts.model,
        enrollmentStatus: opts.enroll ? "ENROLLED" : "PENDING",
        abmDeviceId: opts.enroll ? "ABM-" + opts.imei.slice(-6) : null,
        mdmProfileLocked: opts.enroll,
        supervisedAt: opts.enroll ? monthsAgo(opts.startedMonthsAgo) : null,
      },
    });
    const financed = opts.total - opts.down;
    const monthly = Math.round((financed / opts.term) * 100) / 100;
    const start = monthsAgo(opts.startedMonthsAgo);
    const contract = await prisma.contract.create({
      data: {
        storeId: opts.storeId,
        deviceId: device.id,
        buyerId: buyer.id,
        totalPrice: opts.total,
        downPayment: opts.down,
        termMonths: opts.term,
        monthlyAmount: monthly,
        startDate: start,
      },
    });
    for (let i = 0; i < opts.term; i++) {
      const due = monthsFromDate(start, i + 1);
      const paid = i < opts.paymentsMade;
      await prisma.payment.create({
        data: {
          contractId: contract.id,
          storeId: opts.storeId,
          amount: monthly,
          dueDate: due,
          paidDate: paid ? due : null,
          method: paid ? "CASH" : null,
          status: paid ? "PAID" : due < new Date() ? "OVERDUE" : "DUE",
        },
      });
    }
    if (opts.enroll) {
      await prisma.lockEvent.create({
        data: {
          storeId: opts.storeId,
          deviceId: device.id,
          action: "ENROLL",
          triggeredBy: "USER",
          reason: "Enrolled at point of sale",
          createdAt: monthsAgo(opts.startedMonthsAgo),
        },
      });
    }
  }

  await makeDeal({
    storeId: store1.id,
    buyerName: "Oybek Karimov",
    idNumber: "AA1234567",
    phone: "+998901234567",
    telegramChatId: "200000001",
    imei: "356789101112131",
    model: "iPhone 14",
    total: 12000000,
    down: 2000000,
    term: 10,
    startedMonthsAgo: 3,
    paymentsMade: 3,
    enroll: true,
  });
  await makeDeal({
    storeId: store1.id,
    buyerName: "Sardor Tashmatov",
    idNumber: "AA7654321",
    phone: "+998907654321",
    telegramChatId: "200000002",
    imei: "356789101112132",
    model: "iPhone 13",
    total: 9000000,
    down: 1000000,
    term: 12,
    startedMonthsAgo: 4,
    paymentsMade: 1,
    enroll: true,
  });
  await makeDeal({
    storeId: store2.id,
    buyerName: "Nilufar Yusupova",
    idNumber: "AB1112223",
    phone: "+998935556677",
    imei: "356789101112133",
    model: "iPhone 15 Pro",
    total: 18000000,
    down: 4000000,
    term: 14,
    startedMonthsAgo: 0,
    paymentsMade: 0,
    enroll: false,
  });
}

export const demoLogins = [
  "  Main admin:    admin@blazeos.dev (admin123)",
  "  Store 1 admin: admin@tashkentmobile.uz (store123)",
  "  Store 1 staff: staff@tashkentmobile.uz (store123)",
  "  Store 2 admin: admin@samarqandphones.uz (store123)",
].join("\n");
