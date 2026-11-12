// Standalone job entry — run on a schedule (Railway cron, system cron, etc.):
//   npm run evaluate-overdue
// It locks devices whose payments are overdue and unlocks ones that caught up.
import { evaluateOverdue } from "../services/overdue.js";
import { prisma } from "../db.js";

evaluateOverdue()
  .then((result) => {
    console.log("[evaluate-overdue]", JSON.stringify(result));
  })
  .catch((err) => {
    console.error("[evaluate-overdue] failed", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
