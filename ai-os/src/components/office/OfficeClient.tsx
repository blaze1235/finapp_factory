"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { departments, workers, type DeptKey } from "@/server/office/registry";
import OfficeMap, { type WorkerLive } from "./OfficeMap";
import TaskDetail from "./TaskDetail";
import { BOARD_W, BOARD_H } from "./layout";

interface ActiveTask {
  id: string;
  title: string;
  department: string;
  status: string;
  subtasks: { worker: string; title: string; status: string }[];
}

interface TaskListItem {
  id: string;
  title: string;
  department: string;
  status: string;
  created_at: string;
}

interface TickerItem {
  worker_key: string | null;
  message: string;
  created_at: string;
}

export default function OfficeClient() {
  const [live, setLive] = useState<Record<string, WorkerLive>>({});
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [brief, setBrief] = useState("");
  const [dept, setDept] = useState<string>("auto");
  const [busy, setBusy] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const boardWrap = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // ── responsive board scale ──────────────────────────
  useEffect(() => {
    const el = boardWrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setScale(Math.min(w / BOARD_W, h / BOARD_H, 1.35));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── polling ─────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const [stateRes, tasksRes] = await Promise.all([
        fetch("/api/office/state"),
        fetch("/api/office/tasks"),
      ]);
      if (stateRes.status === 401) {
        router.push("/login");
        return;
      }
      const state = await stateRes.json();
      const tl = await tasksRes.json();
      setTasks(tl.tasks ?? []);
      setTicker(state.ticker ?? []);

      const map: Record<string, WorkerLive> = {};
      for (const t of (state.active ?? []) as ActiveTask[]) {
        for (const s of t.subtasks) {
          if (s.status === "working") map[s.worker] = { status: "working" };
          else if (s.status === "done" && !map[s.worker]) map[s.worker] = { status: "done" };
        }
        if (t.status === "synthesizing") {
          const lead = departments[t.department as DeptKey]?.lead;
          if (lead) map[lead] = { status: "working" };
        }
      }
      setLive(map);
    } catch {
      /* transient network errors are fine — next poll retries */
    }
  }, [router]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [poll]);

  // ── submit ──────────────────────────────────────────
  async function submit() {
    if (brief.trim().length < 5 || busy) return;
    setBusy(true);
    const res = await fetch("/api/office/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, department: dept === "auto" ? undefined : dept }),
    });
    setBusy(false);
    if (res.ok) {
      const { id } = await res.json();
      setBrief("");
      setOpenTask(id);
      poll();
    }
  }

  const anyWorking = Object.values(live).some((v) => v.status === "working");

  async function callParty(kind: "gather" | "coffeebreak" | "party") {
    await fetch("/api/office/party", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
  }

  async function callPlace(mode: "place" | "free") {
    await fetch("/api/office/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-3">
        <span className="text-xs text-[var(--muted)]">Office HQ · all 8 departments</span>
        <span className={`ml-1 h-2 w-2 rounded-full ${anyWorking ? "led-blink bg-amber-400" : "bg-emerald-500"}`} />
        <span className="hidden text-[10px] text-[var(--muted)] sm:inline">
          {anyWorking ? "team working" : "free time — agents hanging out"}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => callParty("gather")}
            title="Pull idle agents to the collab table — AI-free, instant"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
          >
            🤝 Gather
          </button>
          <button
            onClick={() => callParty("coffeebreak")}
            title="Send idle agents to the lounge — AI-free, instant"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
          >
            ☕ Coffee break
          </button>
          <button
            onClick={() => callParty("party")}
            title="Everyone idle parties in the commons — AI-free, instant"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
          >
            🎉 Party
          </button>
          <span className="mx-0.5 w-px self-stretch bg-[var(--border)]" />
          <button
            onClick={() => callPlace("place")}
            title="Send every idle agent back to their own desk and keep them there"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-sky-400 hover:text-white"
          >
            📍 Place
          </button>
          <button
            onClick={() => callPlace("free")}
            title="Cancel place/party — agents move freely again"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-emerald-400 hover:text-white"
          >
            🕊️ Free
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* office board */}
        <main ref={boardWrap} className="relative min-h-[42vh] min-w-0 flex-1 overflow-hidden p-4 md:min-h-0">
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: BOARD_W * scale,
              height: BOARD_H * scale,
              transform: "translate(-50%, -50%)",
            }}
          >
            <OfficeMap live={live} scale={scale} onDeptClick={(d) => setDept(d)} />
          </div>
        </main>

        {/* sidebar */}
        <aside className="flex max-h-[46vh] w-full shrink-0 flex-col border-t border-[var(--border)] bg-[var(--panel)] md:max-h-none md:w-[340px] md:border-l md:border-t-0">
          {/* composer */}
          <div className="border-b border-[var(--border)] p-4">
            <label className="font-pixel text-[7px] tracking-wider text-[var(--muted)]">NEW TASK</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              rows={3}
              placeholder="e.g. Plan an Instagram campaign for BlazeRent's new subscription tier…"
              className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-xs outline-none focus:border-[var(--accent)]"
            />
            <div className="mt-2 flex gap-2">
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none"
              >
                <option value="auto">🎯 Auto-route</option>
                {Object.values(departments).map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                onClick={submit}
                disabled={busy || brief.trim().length < 5}
                className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {busy ? "…" : "Assign"}
              </button>
            </div>
          </div>

          {/* task list */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="px-1 pb-2 font-pixel text-[7px] tracking-wider text-[var(--muted)]">TASKS</p>
            <div className="space-y-1.5">
              {tasks.map((t) => {
                const d = departments[t.department as DeptKey];
                return (
                  <button
                    key={t.id}
                    onClick={() => setOpenTask(t.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-left transition hover:border-[var(--accent)]"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${["planning", "working", "synthesizing"].includes(t.status) ? "led-blink" : ""}`}
                      style={{ background: t.status === "done" ? "#4ade80" : t.status === "failed" ? "#f87171" : "#facc15" }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{t.title}</span>
                      <span className="text-[10px]" style={{ color: d?.accent ?? "var(--muted)" }}>
                        {d?.name ?? "routing…"}
                      </span>
                    </span>
                  </button>
                );
              })}
              {tasks.length === 0 && (
                <p className="px-1 text-xs text-[var(--muted)]">
                  No tasks yet. Give your team something to do 👆
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ticker */}
      <footer className="flex h-9 items-center gap-2 overflow-hidden border-t border-[var(--border)] bg-[var(--panel)] px-4">
        <span className="font-pixel text-[7px] text-[var(--accent)]">FEED</span>
        {ticker[0] && (
          <p key={ticker[0].message + ticker[0].created_at} className="tick-in truncate text-[11px] text-[var(--muted)]">
            {ticker[0].worker_key && workers[ticker[0].worker_key] ? (
              <span style={{ color: departments[workers[ticker[0].worker_key].dept].accent }}>
                {workers[ticker[0].worker_key].name}:{" "}
              </span>
            ) : (
              <span className="text-[var(--accent)]">Orchestrator: </span>
            )}
            {ticker[0].message}
          </p>
        )}
      </footer>

      {openTask && <TaskDetail taskId={openTask} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
