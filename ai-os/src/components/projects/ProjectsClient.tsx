"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { projects, workers, type Project } from "@/server/office/registry";

interface TaskRow {
  id: string;
  title: string;
  department: string;
  status: string;
  created_at: string;
}

interface ReportRow {
  department: string;
  content: string;
}

interface ServerRoomProject {
  id: string;
  name: string;
  purpose: string;
  department: string | null;
}

const ACTIVE = new Set(["planning", "working", "synthesizing"]);

export default function ProjectsClient() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [srProjects, setSrProjects] = useState<ServerRoomProject[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/office/tasks")
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .catch(() => {});
    fetch("/api/reports")
      .then((r) => r.json())
      .then((d) => setReports(d.reports ?? []))
      .catch(() => {});
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setSrProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-[var(--border)] px-5 py-3.5">
        <h1 className="text-sm font-semibold">🚀 Projects</h1>
        <p className="text-[11px] text-[var(--muted)]">
          {Object.values(projects).length} workspaces. Each has a lead, a squad of existing agents, its own tasks,
          reports, chat and memory. Agents stay in their permanent departments — squads just borrow them.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.values(projects).map((p) => (
            <ProjectCard
              key={p.key}
              project={p}
              tasks={tasks.filter((t) => t.department === p.key)}
              report={reports.find((r) => r.department === p.key) ?? null}
              srDescription={srProjects.filter((s) => s.department === p.key)}
              expanded={open === p.key}
              onToggle={() => setOpen(open === p.key ? null : p.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  project: p,
  tasks,
  report,
  srDescription,
  expanded,
  onToggle,
}: {
  project: Project;
  tasks: TaskRow[];
  report: ReportRow | null;
  srDescription: ServerRoomProject[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const lead = workers[p.lead];
  const active = tasks.filter((t) => ACTIVE.has(t.status));
  const done = tasks.filter((t) => t.status === "done");

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4" style={{ borderTopColor: p.accent, borderTopWidth: 3 }}>
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
          style={{ background: p.accent }}
        >
          {p.short}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold" style={{ color: p.accent }}>
            {p.name}
          </h2>
          <p className="text-[10px] text-[var(--muted)]">
            Lead: <span className="font-semibold text-white">{lead.name}</span> · {lead.role}
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[9px] text-[var(--muted)]">
          {active.length > 0 ? `⏳ ${active.length} active` : done.length > 0 ? `✅ ${done.length} done` : "idle"}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">{p.description}</p>

      {/* squad — references existing agents, never duplicates */}
      <p className="mt-3 mb-1 text-[9px] font-semibold tracking-wide text-[var(--muted)]">CURRENT SQUAD</p>
      <div className="flex flex-wrap gap-1">
        {p.squad.map((k) => {
          const w = workers[k];
          if (!w) return null;
          return (
            <span
              key={k}
              className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[10px]"
              title={`${w.role} — from their permanent department`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: w.shirt }} />
              {p.lead === k ? "★ " : ""}
              {w.name}
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link
          href={`/chats?dept=${p.key}`}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
        >
          💬 Chat
        </Link>
        <Link
          href="/server"
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
        >
          🗄️ Memory
        </Link>
        <Link
          href="/reports"
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
        >
          📊 Reports
        </Link>
        <button
          onClick={onToggle}
          className="ml-auto rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-white"
        >
          {expanded ? "▴ Less" : "▾ Details"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          {srDescription.length > 0 && (
            <div>
              <p className="mb-1 text-[9px] font-semibold tracking-wide text-[var(--muted)]">SERVER ROOM DEFINITION</p>
              {srDescription.map((s) => (
                <p key={s.id} className="text-[11px] leading-relaxed text-[var(--muted)]">
                  <span className="font-semibold text-white">{s.name}:</span> {s.purpose.slice(0, 280)}
                  {s.purpose.length > 280 ? "…" : ""}
                </p>
              ))}
            </div>
          )}

          <div>
            <p className="mb-1 text-[9px] font-semibold tracking-wide text-[var(--muted)]">TASKS ({tasks.length})</p>
            {tasks.slice(0, 6).map((t) => (
              <p key={t.id} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: t.status === "done" ? "#4ade80" : t.status === "failed" ? "#f87171" : "#facc15" }}
                />
                <span className="truncate">{t.title}</span>
              </p>
            ))}
            {tasks.length === 0 && <p className="text-[11px] text-[var(--muted)]">No tasks yet — assign one from the Office.</p>}
          </div>

          {report && (
            <div>
              <p className="mb-1 text-[9px] font-semibold tracking-wide text-[var(--muted)]">THIS WEEK&apos;S REPORT</p>
              <div className="deliverable text-[11px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
