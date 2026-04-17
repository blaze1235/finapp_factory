import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

// ── Google Sheets setup ──────────────────────────────────────────────────────

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const CREDS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON!);

function getJWT() {
  return new JWT({
    email: CREDS.client_email,
    key: CREDS.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

async function getDoc() {
  const doc = new GoogleSpreadsheet(SHEET_ID, getJWT());
  await doc.loadInfo();
  return doc;
}

// ── /api/init ─────────────────────────────────────────────────────────────────
app.get("/api/init", async (req, res) => {
  try {
    const doc = await getDoc();

    // Accounts
    const accountsSheet = doc.sheetsByTitle["Accounts"];
    const accountRows = await accountsSheet.getRows();
    const accounts = accountRows.map((r) => ({
      TG_ID: r.get("TG_ID") ?? "",
      Username: r.get("Username") ?? "",
      Full_Name: r.get("Full_Name") ?? "",
      Role: (r.get("Role") ?? "").toLowerCase(),
      Active: r.get("Active") ?? "FALSE",
    }));

    // Categories
    const catSheet = doc.sheetsByTitle["Categories"];
    const catRows = await catSheet.getRows();
    const categories = catRows
      .map((r) => ({
        Category: r.get("Category") ?? "",
        Type: r.get("Type") ?? "",
      }))
      .filter((c) => c.Category);

    res.json({ accounts, categories });
  } catch (err: any) {
    console.error("/api/init error:", err.message);
    res.status(503).json({ error: err.message });
  }
});

// ── /api/transactions GET ─────────────────────────────────────────────────────
app.get("/api/transactions", async (req, res) => {
  try {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle["Transactions"];
    const rows = await sheet.getRows();
    const HEADERS = [
      "ID","Timestamp","Date","Type","Category",
      "Amount_UZS","Amount_USD","USD_Rate","Note",
      "Editor_ID","Editor_Name","Currency",
    ];
    const txs = rows
      .map((r) => {
        const obj: any = {};
        HEADERS.forEach((h) => (obj[h] = r.get(h) ?? ""));
        return obj;
      })
      .filter((t) => t.ID);
    res.json(txs);
  } catch (err: any) {
    console.error("/api/transactions GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/transactions POST ────────────────────────────────────────────────────
app.post("/api/transactions", async (req, res) => {
  try {
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle["Transactions"];
    const tx = req.body;
    if (!tx.ID) {
      tx.ID = Math.random().toString(36).substr(2, 8).toUpperCase();
    }
    await sheet.addRow([
      tx.ID, tx.Timestamp, tx.Date, tx.Type, tx.Category,
      tx.Amount_UZS, tx.Amount_USD ?? "", tx.USD_Rate ?? "",
      tx.Note, tx.Editor_ID, tx.Editor_Name, tx.Currency ?? "UZS",
    ]);
    res.json(tx);
  } catch (err: any) {
    console.error("/api/transactions POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/transactions/:id PUT ─────────────────────────────────────────────────
app.put("/api/transactions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle["Transactions"];
    const rows = await sheet.getRows();
    const row = rows.find((r) => r.get("ID") === id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const updates = req.body;
    Object.keys(updates).forEach((k) => row.set(k, updates[k]));
    await row.save();
    const updated: any = {};
    ["ID","Timestamp","Date","Type","Category","Amount_UZS","Amount_USD","USD_Rate","Note","Editor_ID","Editor_Name","Currency"]
      .forEach((h) => (updated[h] = row.get(h) ?? ""));
    res.json(updated);
  } catch (err: any) {
    console.error("/api/transactions PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/transactions/:id DELETE ──────────────────────────────────────────────
app.delete("/api/transactions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await getDoc();
    const sheet = doc.sheetsByTitle["Transactions"];
    const rows = await sheet.getRows();
    const row = rows.find((r) => r.get("ID") === id);
    if (!row) return res.status(404).json({ error: "Not found" });
    await row.delete();
    res.json({ success: true });
  } catch (err: any) {
    console.error("/api/transactions DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Vite / static serving ─────────────────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ FinApp web server running on http://localhost:${PORT}`);
  });
}

startServer();
