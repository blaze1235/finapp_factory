// One-time (re-runnable) import: reads real project notes from the Obsidian vault and seeds
// the Server Room (projects + documents tables). Run locally — the deployed Railway app has
// NO access to this Mac's filesystem, so this can't be a button inside the app itself. Re-run
// this script any time you want to re-sync after editing the vault.
//
// Usage: node --env-file=.env scripts/seed-server-room.mjs
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import postgres from "postgres";

const VAULT = "/Users/aa.sobirjonov/Library/Mobile Documents/iCloud~md~obsidian/Documents/ObsidianBrain";
const SKIP_FILE = "What every man have gone through.md"; // off-limits, per user instruction

function read(rel) {
  const p = path.join(VAULT, rel);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8").trim();
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

// project -> { department, purpose, files: [vault-relative paths to attach as documents] }
const PROJECTS = [
  {
    name: "BlazeRent",
    department: "blazerent",
    purpose: read("Project Ablaze/Blazerent/BlazeRent.md"),
    files: [
      "Project Ablaze/Blazerent/BlazeApp.md",
      "Project Ablaze/Blazerent/BlazeFarm.md",
      "Project Ablaze/Blazerent/BlazeStrategy.md",
      "Project Ablaze/Blazerent/Blaze Partners.md",
      "Project Ablaze/Blazerent/New Directions.md",
      "Project Ablaze/Blazerent/Plan X.md",
      "Project Ablaze/Blazerent/ComputerClubs.md",
      "Project Ablaze/Blazerent/BlazeMarketing.md",
    ],
  },
  {
    name: "FinApp",
    department: "finapp",
    purpose: read("Project Ablaze/FinApp/FinApp.md"),
    files: [
      "Project Ablaze/FinApp/FinApp - Finance.md",
      "Project Ablaze/FinApp/FinApp - Production.md",
      "Project Ablaze/FinApp/FinApp - Warehouse.md",
      "Project Ablaze/FinApp/FinApp x BikaAI.md",
      "Project Ablaze/FinApp/FinBlaze.md",
      "Project Ablaze/FinApp/Hardware FB.md",
    ],
  },
  {
    name: "Bika",
    department: "bika",
    purpose: read("Project Ablaze/Bika/Bika.md"),
    files: [
      "Project Ablaze/Bika/Bika Value.md",
      "Project Ablaze/Bika/Bika Bot.md",
      "Project Ablaze/Bika/BikaApp.md",
      "Project Ablaze/Bika/BikaAI.md",
      "Project Ablaze/Bika/Bika Monetisation.md",
      "POS integration.md",
    ],
  },
  {
    name: "Finly",
    department: "finly",
    purpose: read("Project Ablaze/FinApp/Finly.md"),
    files: [
      "Project Ablaze/FinApp/FinlyFeatures.md",
      "Project Ablaze/FinApp/FinlyStrategy.md",
      "Project Ablaze/FinApp/FinlyCard.md",
      "Project Ablaze/FinApp/FinlyCharity.md",
      "Project Ablaze/FinApp/FinlyDebts.md",
      "Project Ablaze/FinApp/FinlyFriends.md",
      "Project Ablaze/FinApp/FinlyGoals.md",
      "Project Ablaze/FinApp/FinlyFast.md",
      "Project Ablaze/FinApp/Finly Expansion.md",
      "Project Ablaze/FinApp/Finly Marketing.md",
      "Project Ablaze/FinApp/Leaderboard.md",
      "Project Ablaze/FinApp/Smart Budgeting.md",
    ],
  },
  {
    name: "Maccaldo Export (BRADJUS)",
    department: "export",
    purpose:
      "Export client relationship around an ERP deal that fell through — the client purchased an ERP system elsewhere without informing us first. Currently inactive; treat as a past lesson rather than a live deal unless Abdulaziz says otherwise.",
    files: ["Project Ablaze/Maccaldo.md"],
  },
  {
    name: "BlazeStudio",
    department: "marketing",
    purpose: read("BlazeStudio.md"),
    files: [],
  },
  {
    name: "CamAI",
    department: "rnd",
    purpose: read("Project Ablaze/CamAI.md"),
    files: [],
  },
  {
    name: "LogiBlaze",
    department: "rnd",
    purpose: read("Project Ablaze/LogiBlaze.md"),
    files: [],
  },
  {
    name: "ParkingGO",
    department: "rnd",
    purpose: read("SideProjects/ParkingGO.md"),
    files: [],
  },
  {
    name: "Thinkly",
    department: "rnd",
    purpose: read("SideProjects/Thinkly.md"),
    files: [],
  },
  {
    name: "WhoopConnect",
    department: "rnd",
    purpose: read("SideProjects/WhoopConnect.md"),
    files: [],
  },
  {
    name: "Prayer App",
    department: "rnd",
    purpose: read("SideProjects/Prayer App.md"),
    files: [],
  },
  {
    name: "Exhibition App",
    department: "rnd",
    purpose: read("SideProjects/Exhibition app.md"),
    files: [],
  },
];

async function upsertProject(p) {
  const [existing] = await sql`SELECT id FROM projects WHERE name = ${p.name} AND department = ${p.department}`;
  const id = existing?.id ?? randomUUID();
  if (existing) {
    await sql`UPDATE projects SET purpose = ${p.purpose}, updated_at = now() WHERE id = ${id}`;
  } else {
    await sql`INSERT INTO projects (id, name, purpose, department) VALUES (${id}, ${p.name}, ${p.purpose}, ${p.department})`;
  }
  return id;
}

async function attachFile(projectId, vaultRelPath) {
  const filename = path.basename(vaultRelPath);
  const content = read(vaultRelPath);
  if (!content) return;
  const [existing] = await sql`SELECT id FROM documents WHERE project_id = ${projectId} AND filename = ${filename}`;
  if (existing) {
    await sql`UPDATE documents SET content = ${content} WHERE id = ${existing.id}`;
    return;
  }
  await sql`INSERT INTO documents (id, filename, content, size_bytes, project_id)
            VALUES (${randomUUID()}, ${filename}, ${content}, ${Buffer.byteLength(content)}, ${projectId})`;
}

let created = 0;
let filesAttached = 0;
for (const p of PROJECTS) {
  if (!p.purpose && p.files.length === 0) continue;
  const id = await upsertProject(p);
  created++;
  for (const f of p.files) {
    await attachFile(id, f);
    filesAttached++;
  }
}

console.log(`✅ Seeded ${created} projects, attached ${filesAttached} vault notes as files.`);
await sql.end();
