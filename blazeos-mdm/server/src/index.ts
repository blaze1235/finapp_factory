import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { requireAuth } from "./auth.js";
import { errorMiddleware } from "./lib/http.js";
import { authRouter } from "./routes/auth.js";
import { storesRouter } from "./routes/stores.js";
import { buyersRouter } from "./routes/buyers.js";
import { devicesRouter } from "./routes/devices.js";
import { contractsRouter } from "./routes/contracts.js";
import { paymentsRouter } from "./routes/payments.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { billingRouter } from "./routes/billing.js";
import { mdm } from "./mdm/index.js";
import { notifier } from "./notify/index.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({ ok: true, mdm: mdm().name, notify: notifier().name })
);

app.use("/api/auth", authRouter);

// Everything below requires authentication.
app.use("/api/stores", requireAuth, storesRouter);
app.use("/api/buyers", requireAuth, buyersRouter);
app.use("/api/devices", requireAuth, devicesRouter);
app.use("/api/contracts", requireAuth, contractsRouter);
app.use("/api/payments", requireAuth, paymentsRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/billing", requireAuth, billingRouter);

// In production, serve the built React app from the same origin as the API.
// WEB_DIST overrides the default (web/dist relative to the compiled server).
const here = dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST ?? join(here, "..", "..", "web", "dist");
if (existsSync(join(webDist, "index.html"))) {
  app.use(express.static(webDist));
  // SPA fallback: non-API routes return index.html so client routing works.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(webDist, "index.html")));
  console.log(`Serving web build from ${webDist}`);
}

app.use(errorMiddleware);

app.listen(config.port, () => {
  console.log(`BlazeOS MDM API on http://localhost:${config.port} (mdm=${mdm().name})`);
});
