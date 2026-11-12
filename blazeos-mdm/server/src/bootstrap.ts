// Production bootstrap: seeds demo data ONLY if the database is empty.
// Compiled with the server (dist/bootstrap.js) and run at deploy time.
// Safe to run on every deploy — it never wipes existing data.
import { PrismaClient } from "@prisma/client";
import { buildDemo, demoLogins } from "./demo.js";

const prisma = new PrismaClient();

async function main() {
  const storeCount = await prisma.store.count();
  if (storeCount > 0) {
    console.log(`[bootstrap] ${storeCount} store(s) already present — skipping demo seed.`);
    return;
  }
  console.log("[bootstrap] empty database — seeding demo data...");
  await buildDemo(prisma);
  console.log("[bootstrap] demo data created. Logins:");
  console.log(demoLogins);
}

main()
  .catch((e) => {
    console.error("[bootstrap] failed", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
