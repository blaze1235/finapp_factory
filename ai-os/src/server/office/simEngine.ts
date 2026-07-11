import { sql } from "@/server/db";
import { departments, deptWorkers, workers, type DeptKey, type Worker } from "./registry";
import { roomOf, roomAt, HANGOUTS } from "@/components/office/layout";

interface P {
  x: number;
  y: number;
}

type Mode = "desk" | "collab" | "party" | "idle";

interface Sim extends P {
  path: P[];
  mode: Mode;
  talking: boolean;
  emoji?: string;
  nextThink: number;
}

type PartyKind = "gather" | "coffeebreak" | "party";

const VIBE_EMOJI: Record<string, string[]> = {
  coffee: ["☕", "☕", "🍩"],
  couch: ["😌", "📱", "🎧"],
  collab: ["💡", "🗒️"],
  game: ["🏓", "😄"],
  walk: [],
};

const COLLAB_SPOTS: P[] = HANGOUTS.filter((h) => h.vibe === "collab").map(({ x, y }) => ({ x, y }));
const PARTY_SPOTS: Record<PartyKind, P[]> = {
  gather: COLLAB_SPOTS,
  coffeebreak: HANGOUTS.filter((h) => h.vibe === "coffee" || h.vibe === "couch").map(({ x, y }) => ({ x, y })),
  party: HANGOUTS.filter((h) => h.vibe === "game" || h.vibe === "couch" || h.vibe === "collab").map(({ x, y }) => ({
    x,
    y,
  })),
};
const PARTY_EMOJI: Record<PartyKind, string[]> = {
  gather: ["🗒️", "💡"],
  coffeebreak: ["☕", "🍩", "😌"],
  party: ["🎉", "🥳", "🎶", "😄"],
};
const PARTY_DURATION_MS: Record<PartyKind, number> = {
  gather: 45_000,
  coffeebreak: 40_000,
  party: 60_000,
};

function stepsTo(a: P, b: P): P[] {
  const pts: P[] = [];
  let { x, y } = a;
  const sx = Math.sign(b.x - x);
  while (Math.abs(b.x - x) > 0.75) {
    x += sx;
    pts.push({ x, y });
  }
  x = b.x;
  pts.push({ x, y });
  const sy = Math.sign(b.y - y);
  while (Math.abs(b.y - y) > 0.75) {
    y += sy;
    pts.push({ x, y });
  }
  pts.push({ x, y: b.y });
  return pts;
}

function route(from: P, to: P): P[] {
  const fr = roomAt(from.x, from.y);
  const tr = roomAt(to.x, to.y);
  let path: P[] = [];
  let cur = from;
  if (fr && fr !== tr) {
    path = path.concat(stepsTo(cur, { x: fr.doorIn[0], y: fr.doorIn[1] }));
    path.push({ x: fr.doorOut[0], y: fr.doorOut[1] });
    cur = { x: fr.doorOut[0], y: fr.doorOut[1] };
  }
  if (tr && tr !== fr) {
    path = path.concat(stepsTo(cur, { x: tr.doorOut[0], y: tr.doorOut[1] }));
    path.push({ x: tr.doorIn[0], y: tr.doorIn[1] });
    path = path.concat(stepsTo({ x: tr.doorIn[0], y: tr.doorIn[1] }, to));
  } else {
    path = path.concat(stepsTo(cur, to));
  }
  return path;
}

function deskSeat(w: Worker): P {
  const room = roomOf(w.dept);
  const idx = deptWorkers(w.dept).findIndex((t) => t.key === w.key);
  const [dx, dy] = room.desks[idx % room.desks.length];
  return { x: dx + 0.85, y: dy + 1.55 };
}

function near(a: P, b: P, eps = 0.4): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

// ── singleton engine state (survives across requests in the same process) ──
declare global {
  // eslint-disable-next-line no-var
  var __aios_sim: {
    state: Record<string, Sim>;
    workingSet: Set<string>;
    collabAssignment: Map<string, P>;
    partyAssignment: Map<string, P>;
    party: { kind: PartyKind; until: number } | null;
    started: boolean;
  } | undefined;
}

function engine() {
  if (!globalThis.__aios_sim) {
    const state: Record<string, Sim> = {};
    for (const w of Object.values(workers)) {
      const seat = deskSeat(w);
      state[w.key] = { ...seat, path: [], mode: "desk", talking: false, nextThink: Date.now() + 2000 + Math.random() * 9000 };
    }
    globalThis.__aios_sim = {
      state,
      workingSet: new Set(),
      collabAssignment: new Map(),
      partyAssignment: new Map(),
      party: null,
      started: false,
    };
  }
  return globalThis.__aios_sim;
}

async function refreshWorking() {
  const e = engine();
  try {
    const rows = await sql`
      SELECT s.worker_key FROM subtasks s
      JOIN tasks t ON t.id = s.task_id
      WHERE t.status IN ('planning','working','synthesizing') AND s.status = 'working'`;
    const synth = await sql`SELECT department FROM tasks WHERE status = 'synthesizing'`;
    const set = new Set<string>();
    for (const r of rows as unknown as { worker_key: string }[]) set.add(r.worker_key);
    for (const r of synth as unknown as { department: string }[]) {
      const lead = departments[r.department as DeptKey]?.lead;
      if (lead) set.add(lead);
    }
    e.workingSet = set;
  } catch {
    // keep previous set on transient DB errors
  }
}

function tick() {
  const e = engine();
  const now = Date.now();
  if (e.party && now >= e.party.until) {
    e.party = null;
    e.partyAssignment.clear();
  }
  const partyOn = e.party;

  const list = Object.values(workers);
  for (const w of list) {
    const s = e.state[w.key];
    const isWorking = e.workingSet.has(w.key);
    const isCollab = e.collabAssignment.has(w.key);

    let goal: P | null = null;
    let mode: Mode = "idle";

    if (isWorking) {
      goal = deskSeat(w);
      mode = "desk";
    } else if (isCollab) {
      goal = e.collabAssignment.get(w.key)!;
      mode = "collab";
    } else if (partyOn) {
      if (!e.partyAssignment.has(w.key)) {
        const spots = PARTY_SPOTS[partyOn.kind];
        const base = spots[Math.floor(Math.random() * spots.length)];
        e.partyAssignment.set(w.key, {
          x: base.x + (Math.random() - 0.5) * 1.2,
          y: base.y + (Math.random() - 0.5) * 0.8,
        });
        const pool = PARTY_EMOJI[partyOn.kind];
        s.emoji = pool.length && Math.random() < 0.8 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
      }
      goal = e.partyAssignment.get(w.key)!;
      mode = "party";
    }

    if (goal) {
      const atGoal = near(s, goal);
      if (s.mode !== mode) {
        s.path = atGoal ? [] : route(s, goal);
        s.mode = mode;
        if (mode !== "party") s.emoji = undefined;
      } else if (!atGoal && s.path.length === 0) {
        s.path = route(s, goal);
      }
    } else {
      if (s.mode !== "idle") {
        s.mode = "idle";
        s.nextThink = now;
        e.partyAssignment.delete(w.key);
      }
      if (now > s.nextThink && s.path.length === 0) {
        const seat = deskSeat(w);
        const isAtSeat = near(s, seat);
        const r = Math.random();
        if (r < 0.42) {
          s.nextThink = now + 4000 + Math.random() * 10000;
        } else if (r < 0.62 && !isAtSeat) {
          s.path = route(s, seat);
          s.emoji = undefined;
          s.nextThink = now + 6000 + Math.random() * 12000;
        } else {
          const spot = HANGOUTS[Math.floor(Math.random() * HANGOUTS.length)];
          const jitter = { x: spot.x + (Math.random() - 0.5) * 0.8, y: spot.y + (Math.random() - 0.5) * 0.5 };
          s.path = route(s, jitter);
          const pool = VIBE_EMOJI[spot.vibe];
          s.emoji = pool.length && Math.random() < 0.75 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
          s.nextThink = now + 7000 + Math.random() * 16000;
        }
      }
    }

    if (s.path.length > 0) {
      const nxt = s.path.shift()!;
      s.x = nxt.x;
      s.y = nxt.y;
    }
  }

  // talking: collab members always "debating" once settled; idle agents standing close pair up
  for (const w of list) e.state[w.key].talking = false;
  for (const w of list) {
    const s = e.state[w.key];
    if (s.mode === "collab" && s.path.length === 0) s.talking = true;
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = e.state[list[i].key];
      const b = e.state[list[j].key];
      if (a.mode === "desk" || b.mode === "desk" || a.mode === "collab" || b.mode === "collab") continue;
      if (a.path.length > 0 || b.path.length > 0) continue;
      if (near(a, b, 2) && Math.abs(a.y - b.y) < 1.6) {
        a.talking = true;
        b.talking = true;
      }
    }
  }
}

function ensureStarted() {
  const e = engine();
  if (e.started) return;
  e.started = true;
  refreshWorking();
  setInterval(tick, 650);
  setInterval(refreshWorking, 2500);
}
ensureStarted();

// ── public API ─────────────────────────────────────────
export function snapshot() {
  const e = engine();
  const out: Record<string, { x: number; y: number; walking: boolean; mode: Mode; talking: boolean; emoji?: string }> = {};
  for (const [key, s] of Object.entries(e.state)) {
    out[key] = { x: s.x, y: s.y, walking: s.path.length > 0, mode: s.mode, talking: s.talking, emoji: s.emoji };
  }
  return out;
}

export function partyStatus() {
  const e = engine();
  return e.party && Date.now() < e.party.until ? { kind: e.party.kind, until: e.party.until } : null;
}

export function startParty(kind: PartyKind) {
  const e = engine();
  e.party = { kind, until: Date.now() + PARTY_DURATION_MS[kind] };
  e.partyAssignment.clear();
  return e.party;
}

/** Called by the collab engine when an office debate starts — routes participants to the collab table. */
export function beginCollab(keys: string[]) {
  const e = engine();
  keys.forEach((k, i) => e.collabAssignment.set(k, COLLAB_SPOTS[i % COLLAB_SPOTS.length]));
}

export function endCollab(keys: string[]) {
  const e = engine();
  keys.forEach((k) => e.collabAssignment.delete(k));
}
