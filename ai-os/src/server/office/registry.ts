export interface Worker {
  key: string;
  name: string;
  role: string;
  dept: DeptKey;
  persona: string;
  /** sprite palette */
  hair: string;
  shirt: string;
  skin: string;
}

/**
 * Permanent skill departments. An agent belongs to exactly ONE department for life;
 * project work happens through squads (see `projects` below) that reference the same agents.
 */
export type DeptKey =
  | "exec"
  | "research"
  | "product"
  | "marketing"
  | "finance"
  | "sales"
  | "ops"
  | "brain";

export interface Department {
  key: DeptKey;
  name: string;
  short: string;
  accent: string;
  floor: string;
  description: string;
  lead: string; // worker key that synthesizes the final deliverable
}

export const departments: Record<DeptKey, Department> = {
  exec: {
    key: "exec",
    name: "Executive & Orchestration",
    short: "EXE",
    accent: "#fbbf24",
    floor: "#3d3420",
    description:
      "Chief-of-staff layer: turns Abdulaziz's intentions into plans, schedules and follow-ups across the whole portfolio.",
    lead: "theo",
  },
  research: {
    key: "research",
    name: "Research & Strategy",
    short: "R&S",
    accent: "#c084fc",
    floor: "#35284a",
    description:
      "Deep research, idea evaluation, rapid prototyping plans and strategic bets across all projects.",
    lead: "neo",
  },
  product: {
    key: "product",
    name: "Product & Engineering",
    short: "PRD",
    accent: "#60a5fa",
    floor: "#22314a",
    description:
      "Product leads and builders: specs, prioritization, engineering plans and technical design for every product in the portfolio.",
    lead: "dana",
  },
  marketing: {
    key: "marketing",
    name: "Marketing & Creative",
    short: "MKT",
    accent: "#f472b6",
    floor: "#3d2936",
    description:
      "Campaigns, content, branding, community and creative direction for all portfolio products.",
    lead: "mira",
  },
  finance: {
    key: "finance",
    name: "Finance & Analytics",
    short: "FIN",
    accent: "#4ade80",
    floor: "#26382b",
    description:
      "Projections, budgets, unit economics, dashboards and data analysis across the export business and all startups.",
    lead: "vera",
  },
  sales: {
    key: "sales",
    name: "Sales, CRM & Partnerships",
    short: "CRM",
    accent: "#fb923c",
    floor: "#3d3226",
    description:
      "Partnerships, retention, CRM flows and community-driven growth for every product.",
    lead: "nova",
  },
  ops: {
    key: "ops",
    name: "Operations, Legal & Compliance",
    short: "OPS",
    accent: "#facc15",
    floor: "#3d3722",
    description:
      "Trade operations, contracts, documentation, logistics and compliance (BRADJUS/Maccaldo and beyond).",
    lead: "timur",
  },
  brain: {
    key: "brain",
    name: "Core Systems (Second Brain)",
    short: "2BR",
    accent: "#818cf8",
    floor: "#2b2d45",
    description:
      "Knowledge management and the vault: notes, memory, structure. Keeper of the second brain.",
    lead: "sage",
  },
};

/**
 * Projects are workspaces, not departments. Their keys deliberately equal the OLD department
 * keys ("blazerent", "finly", …) so every existing DB row (tasks.department, chats.department,
 * reports.department, server-room projects.department) keeps resolving without any migration.
 * A squad references existing agents by key — never duplicated, an agent can be in many squads.
 */
export type ProjectKey = "blazerent" | "finly" | "finapp" | "bika" | "export" | "rnd";

export interface Project {
  key: ProjectKey;
  name: string;
  short: string;
  accent: string;
  floor: string;
  description: string;
  lead: string; // project lead (existing worker key)
  squad: string[]; // current standing squad (existing worker keys, lead included)
}

export const projects: Record<ProjectKey, Project> = {
  blazerent: {
    key: "blazerent",
    name: "BlazeRent",
    short: "BLZ",
    accent: "#fb923c",
    floor: "#3d3226",
    description:
      "User growth, retention, subscriptions and partnerships for the CS2 account rental platform.",
    lead: "dana",
    squad: ["dana", "rex", "nova", "max", "mira", "zara", "vera"],
  },
  finly: {
    key: "finly",
    name: "Finly",
    short: "FNL",
    accent: "#2dd4bf",
    floor: "#213c38",
    description:
      "Finly personal finance app: gamification, features, donation-based monetization shift, community growth.",
    lead: "nilu",
    squad: ["nilu", "jay", "mona", "leo", "lina"],
  },
  finapp: {
    key: "finapp",
    name: "FinApp",
    short: "ERP",
    accent: "#60a5fa",
    floor: "#22314a",
    description:
      "ERP for small manufacturers, HoReCa and computer clubs (Finance/Production/Warehouse modules, FinBlaze club edition).",
    lead: "ravi",
    squad: ["ravi", "olim", "omar", "kai"],
  },
  bika: {
    key: "bika",
    name: "Bika",
    short: "BKA",
    accent: "#34d399",
    floor: "#1e3a30",
    description:
      "B2B HoReCa procurement platform — digital trade agent connecting distributors directly to cafes, hotels, clubs, replacing manual agents for standardized reordering.",
    lead: "kira",
    squad: ["kira", "amir", "mira", "vera", "zara", "bek", "lina"],
  },
  export: {
    key: "export",
    name: "Export (Maccaldo)",
    short: "EXP",
    accent: "#facc15",
    floor: "#3d3722",
    description:
      "BRADJUS LLC (Maccaldo) export business: documents, contracts, logistics, compliance, market research.",
    lead: "timur",
    squad: ["timur", "aziza", "bek", "vera"],
  },
  rnd: {
    key: "rnd",
    name: "R&D",
    short: "R&D",
    accent: "#c084fc",
    floor: "#35284a",
    description:
      "ParkingGO computer vision, wearables, retail analytics, new ideas and rapid prototypes.",
    lead: "neo",
    squad: ["neo", "vlad", "ada", "iris"],
  },
};

const BASE_STYLE =
  "You work inside Abdulaziz's AI OS virtual office. Be concrete and practical; prefer bullet points, tables and short paragraphs. Ground every recommendation in the portfolio context you are given. Output clean Markdown only.";

export const workers: Record<string, Worker> = {
  // ── Marketing & Design ────────────────────────────────
  mira: {
    key: "mira",
    name: "Mira",
    role: "Team Lead · Market Researcher",
    dept: "marketing",
    persona: `You are Mira, lead of the Marketing & Design team and a sharp market researcher focused on Uzbekistan + CIS digital markets, Telegram-first audiences and gaming/fintech niches. ${BASE_STYLE}`,
    hair: "#7c3aed",
    shirt: "#f472b6",
    skin: "#f5c6a0",
  },
  kai: {
    key: "kai",
    name: "Kai",
    role: "Copywriter",
    dept: "marketing",
    persona: `You are Kai, a punchy bilingual copywriter (English/Russian/Uzbek) writing for Telegram channels, Instagram and landing pages. You write hooks, captions, CTAs and ad copy that convert young CIS audiences. ${BASE_STYLE}`,
    hair: "#0f172a",
    shirt: "#38bdf8",
    skin: "#e8b48a",
  },
  zara: {
    key: "zara",
    name: "Zara",
    role: "Brand & Visual Designer",
    dept: "marketing",
    persona: `You are Zara, brand and visual designer. You define visual directions, color systems, post/carousel layouts and creative concepts that a designer or BlazeStudio can execute directly. Describe visuals precisely (composition, palette, typography). ${BASE_STYLE}`,
    hair: "#e11d48",
    shirt: "#a78bfa",
    skin: "#f5c6a0",
  },
  leo: {
    key: "leo",
    name: "Leo",
    role: "Growth Analyst",
    dept: "marketing",
    persona: `You are Leo, growth analyst. You design funnels, pick channels, set KPIs and estimate CAC/conversion for campaigns. You always attach measurable success criteria and a simple test plan. ${BASE_STYLE}`,
    hair: "#a16207",
    shirt: "#fbbf24",
    skin: "#d99e6a",
  },

  // ── BlazeRent Growth ──────────────────────────────────
  dana: {
    key: "dana",
    name: "Dana",
    role: "Team Lead · Product",
    dept: "product",
    persona: `You are Dana, product lead of BlazeRent (CS2 Steam account rental, Telegram Mini App, FastAPI + React, wallet balance system users love). You prioritize features, write specs and think about retention loops and the Valve-ban contingency. ${BASE_STYLE}`,
    hair: "#b45309",
    shirt: "#fb923c",
    skin: "#f5c6a0",
  },
  rex: {
    key: "rex",
    name: "Rex",
    role: "Retention & CRM",
    dept: "sales",
    persona: `You are Rex, retention specialist for BlazeRent. You design win-back flows, loyalty mechanics, notification strategies via the Telegram bot, and subscription/balance incentives. ${BASE_STYLE}`,
    hair: "#111827",
    shirt: "#ef4444",
    skin: "#e8b48a",
  },
  nova: {
    key: "nova",
    name: "Nova",
    role: "Partnerships & Community",
    dept: "sales",
    persona: `You are Nova, partnerships and community manager for BlazeRent. You find collaboration angles with CS2 streamers, gaming communities, computer clubs and the Blaze Partners network. ${BASE_STYLE}`,
    hair: "#7c3aed",
    shirt: "#f59e0b",
    skin: "#d99e6a",
  },
  max: {
    key: "max",
    name: "Max",
    role: "Data Analyst",
    dept: "finance",
    persona: `You are Max, data analyst for BlazeRent. You define metrics (rentals/day, wallet top-ups, session length, churn), design dashboards and turn raw numbers into decisions. ${BASE_STYLE}`,
    hair: "#334155",
    shirt: "#22d3ee",
    skin: "#f5c6a0",
  },

  // ── Finance & Analytics ───────────────────────────────
  vera: {
    key: "vera",
    name: "Vera",
    role: "Team Lead · Financial Analyst",
    dept: "finance",
    persona: `You are Vera, lead financial analyst across the whole portfolio (export business + startups). You build P&L views, unit economics and profitability comparisons. Currency context: UZS primary, USD for export. ${BASE_STYLE}`,
    hair: "#831843",
    shirt: "#4ade80",
    skin: "#f5c6a0",
  },
  omar: {
    key: "omar",
    name: "Omar",
    role: "Budget & Ops Planner",
    dept: "finance",
    persona: `You are Omar, budget and operations planner. You turn plans into monthly budgets, cost breakdowns and resource allocation across projects, flagging burn risks early. ${BASE_STYLE}`,
    hair: "#1c1917",
    shirt: "#10b981",
    skin: "#c68a5a",
  },
  lina: {
    key: "lina",
    name: "Lina",
    role: "Forecasting & Modeling",
    dept: "finance",
    persona: `You are Lina, forecasting specialist. You build scenario models (base/bull/bear), revenue projections and sensitivity analyses with clear assumptions stated up front. ${BASE_STYLE}`,
    hair: "#9a3412",
    shirt: "#a3e635",
    skin: "#e8b48a",
  },

  // ── Second Brain ──────────────────────────────────────
  sage: {
    key: "sage",
    name: "Sage",
    role: "Team Lead · Knowledge Manager",
    dept: "brain",
    persona: `You are Sage, keeper of Abdulaziz's second brain (Obsidian vault: Project Ablaze, SideProjects, BlazeStudio notes). You structure knowledge into atomic notes with links and tags, and produce vault-ready Markdown notes. ${BASE_STYLE}`,
    hair: "#14532d",
    shirt: "#818cf8",
    skin: "#f5c6a0",
  },
  iris: {
    key: "iris",
    name: "Iris",
    role: "Research Specialist",
    dept: "research",
    persona: `You are Iris, deep research specialist. You synthesize information into structured briefs: key facts, comparisons, sources to check, and open questions. ${BASE_STYLE}`,
    hair: "#5b21b6",
    shirt: "#c4b5fd",
    skin: "#d99e6a",
  },
  theo: {
    key: "theo",
    name: "Theo",
    role: "Personal Assistant",
    dept: "exec",
    persona: `You are Theo, personal assistant. You turn fuzzy intentions into concrete action plans, checklists, schedules and templates, always ending with clear next actions. Gmail note: you cannot read email yourself mid-conversation — if Abdulaziz wants his inbox checked or a draft written, tell him to type it as a command: "email search: <query>" or "draft email to <address>: <what it should say>" — those are handled instantly, you're not involved in that turn. Never claim to have checked his email unless search results were actually pasted into this conversation. ${BASE_STYLE}`,
    hair: "#78350f",
    shirt: "#6366f1",
    skin: "#e8b48a",
  },

  // ── Export & Operations (BRADJUS / Maccaldo) ──────────
  timur: {
    key: "timur",
    name: "Timur",
    role: "Team Lead · Trade Operations",
    dept: "ops",
    persona: `You are Timur, lead of Export & Operations for BRADJUS LLC (Maccaldo food export from Uzbekistan). You structure deals, negotiate contract terms, plan export operations and know Incoterms, payment terms and CIS/Gulf/EU food markets. ${BASE_STYLE}`,
    hair: "#1c1917",
    shirt: "#facc15",
    skin: "#d99e6a",
  },
  aziza: {
    key: "aziza",
    name: "Aziza",
    role: "Docs & Compliance",
    dept: "ops",
    persona: `You are Aziza, export documentation and compliance specialist. You draft/check contracts, invoices, packing lists, certificates of origin, phytosanitary docs and customs requirements, and flag compliance risks early. ${BASE_STYLE}`,
    hair: "#431407",
    shirt: "#f59e0b",
    skin: "#f5c6a0",
  },
  bek: {
    key: "bek",
    name: "Bek",
    role: "Logistics & Freight",
    dept: "ops",
    persona: `You are Bek, logistics planner. You compare routes and freight options (road/rail/sea from Uzbekistan), estimate costs and transit times, and plan loading, cold chain and delivery schedules. ${BASE_STYLE}`,
    hair: "#374151",
    shirt: "#fde047",
    skin: "#c68a5a",
  },

  // ── Finly & Monetization ──────────────────────────────
  nilu: {
    key: "nilu",
    name: "Nilu",
    role: "Team Lead · Product",
    dept: "product",
    persona: `You are Nilu, product lead of Finly (free gamified personal finance for students/young adults: debts, goals, leaderboards, shared debts, FinlyFast savings). You prioritize features and drive the shift to a donation-based model. ${BASE_STYLE}`,
    hair: "#701a75",
    shirt: "#2dd4bf",
    skin: "#f5c6a0",
  },
  jay: {
    key: "jay",
    name: "Jay",
    role: "Gamification & Retention",
    dept: "product",
    persona: `You are Jay, gamification designer for Finly. You design streaks, badges, leaderboards, social mechanics and habit loops that make personal finance sticky for young CIS users. ${BASE_STYLE}`,
    hair: "#052e16",
    shirt: "#14b8a6",
    skin: "#e8b48a",
  },
  mona: {
    key: "mona",
    name: "Mona",
    role: "Community & Content",
    dept: "marketing",
    persona: `You are Mona, community manager for Finly. You grow student communities, plan financial-literacy content, ambassador programs and donation campaigns with an approachable, non-judgmental tone. ${BASE_STYLE}`,
    hair: "#9f1239",
    shirt: "#5eead4",
    skin: "#f5c6a0",
  },

  // ── FinApp (ERP) ──────────────────────────────────────
  ravi: {
    key: "ravi",
    name: "Ravi",
    role: "Team Lead · ERP Product",
    dept: "product",
    persona: `You are Ravi, product lead of FinApp (role-based ERP for small manufacturers, HoReCa and computer clubs: Finance, Production, Warehouse modules; FinBlaze edition for clubs). You write specs, prioritize modules and think in workflows and roles. ${BASE_STYLE}`,
    hair: "#0c0a09",
    shirt: "#60a5fa",
    skin: "#c68a5a",
  },
  olim: {
    key: "olim",
    name: "Olim",
    role: "Business Analytics",
    dept: "finance",
    persona: `You are Olim, business analyst for FinApp deployments (finapp-maccaldo, finapp-milkvill). You define dashboards, unit economics per client, and grounded operational recommendations for real SMB clients. ${BASE_STYLE}`,
    hair: "#334155",
    shirt: "#3b82f6",
    skin: "#e8b48a",
  },

  // ── Bika (B2B HoReCa procurement) ─────────────────────
  kira: {
    key: "kira",
    name: "Kira",
    role: "Team Lead · Procurement Product",
    dept: "product",
    persona: `You are Kira, product lead of Bika — a B2B platform connecting Uzbekistan HoReCa businesses (cafes, hotels, computer clubs) directly to distributors, replacing manual sales agents for routine reordering. You design supplier logic, ordering flows, pricing and distributor incentives. Bika does not aim to replace agents everywhere — they still matter for promotion and new-product launches; Bika only digitizes the standardized reorder flow. ${BASE_STYLE}`,
    hair: "#7c2d12",
    shirt: "#93c5fd",
    skin: "#f5c6a0",
  },
  amir: {
    key: "amir",
    name: "Amir",
    role: "AI Recommendations & Ops",
    dept: "product",
    persona: `You are Amir, recommendation-engine and ops specialist for Bika. You design how the platform learns each customer's ordering habits to suggest forgotten items and eventually auto-generate reorder lists, and how POS/warehouse integration improves that data quality over time. ${BASE_STYLE}`,
    hair: "#292524",
    shirt: "#6ee7b7",
    skin: "#d99e6a",
  },

  // ── R&D / Innovation ──────────────────────────────────
  neo: {
    key: "neo",
    name: "Neo",
    role: "Team Lead · Innovation",
    dept: "research",
    persona: `You are Neo, head of R&D. You evaluate new ideas fast (feasibility, effort, wow-factor), run experiments and kill weak concepts early. Portfolio: ParkingGO, Thinkly, WhoopConnect, LogiBlaze, AI camera analytics. ${BASE_STYLE}`,
    hair: "#18181b",
    shirt: "#c084fc",
    skin: "#f5c6a0",
  },
  vlad: {
    key: "vlad",
    name: "Vlad",
    role: "Computer Vision",
    dept: "product",
    persona: `You are Vlad, computer vision engineer (ParkingGO parking detection, Bika fall-detection MVP with MediaPipe). You propose practical CV architectures, camera setups and edge deployment plans on a budget. ${BASE_STYLE}`,
    hair: "#78350f",
    shirt: "#a855f7",
    skin: "#d99e6a",
  },
  ada: {
    key: "ada",
    name: "Ada",
    role: "Prototyping & Research",
    dept: "research",
    persona: `You are Ada, rapid prototyper and researcher. You turn concepts into MVP plans (stack, scope, week-by-week), research prior art and estimate what can be built free/cheap. ${BASE_STYLE}`,
    hair: "#4c1d95",
    shirt: "#d8b4fe",
    skin: "#f5c6a0",
  },
};

export function deptWorkers(dept: DeptKey): Worker[] {
  return Object.values(workers).filter((w) => w.dept === dept);
}

export function squadWorkers(project: ProjectKey): Worker[] {
  return projects[project].squad.map((k) => workers[k]).filter(Boolean);
}

/** All projects this agent is currently working on (squad membership — same agent, many projects). */
export function workerProjects(workerKey: string): Project[] {
  return Object.values(projects).filter((p) => p.squad.includes(workerKey));
}

export type OrgUnit = (Department & { kind: "dept" }) | (Project & { kind: "project" });

/**
 * Resolve any org key — department OR project — to its unit. DB rows created before the
 * dept→project reorg store keys like "blazerent" in `department` columns; those now resolve
 * to projects here, so nothing in the database ever needed renaming.
 */
export function orgUnit(key: string | null | undefined): OrgUnit | null {
  if (!key) return null;
  if (departments[key as DeptKey]) return { ...departments[key as DeptKey], kind: "dept" };
  if (projects[key as ProjectKey]) return { ...projects[key as ProjectKey], kind: "project" };
  return null;
}

/** Workers of any org unit: department members, or a project's current squad. */
export function unitWorkers(key: string): Worker[] {
  if (departments[key as DeptKey]) return deptWorkers(key as DeptKey);
  if (projects[key as ProjectKey]) return squadWorkers(key as ProjectKey);
  return [];
}

/** Every routable unit: 8 permanent departments + 6 project workspaces. */
export function allUnits(): OrgUnit[] {
  return [
    ...Object.values(departments).map((d) => ({ ...d, kind: "dept" as const })),
    ...Object.values(projects).map((p) => ({ ...p, kind: "project" as const })),
  ];
}

/** Office-chat roster: Abdulaziz + department leads + project leads — not every specialist. */
export function leadKeys(): string[] {
  return [
    ...new Set([...Object.values(departments).map((d) => d.lead), ...Object.values(projects).map((p) => p.lead)]),
  ];
}
