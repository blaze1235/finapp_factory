// Local dev seed: wipes all data and rebuilds the demo set. Destructive.
import { PrismaClient } from "@prisma/client";
import { buildDemo, demoLogins } from "../src/demo.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Resetting data...");
  await prisma.lockEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.device.deleteMany();
  await prisma.buyer.deleteMany();
  await prisma.billingCharge.deleteMany();
  await prisma.user.deleteMany();
  await prisma.store.deleteMany();

  console.log("Building demo data...");
  await buildDemo(prisma);

  console.log("\nSeed complete. Logins (password in parentheses):");
  console.log(demoLogins);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
