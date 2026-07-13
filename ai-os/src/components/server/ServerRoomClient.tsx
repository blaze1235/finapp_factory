"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { departments, type DeptKey } from "@/server/office/registry";

interface ProjectFile {
  id: string;
  filename: string;
}

interface Project {
  id: string;
  name: string;
  purpose: string;
  department: string | null;
  files: ProjectFile[];
  updated_at: string;
}

export default function ServerRoomClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Record<string, { name: string; purpose: string }>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [creatingDept, setCreatingDept] = useState<string>("");
  const [newName, setNewName] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const noteInputs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const d = await res.json();
      setProjects(d.projects ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(p: Project) {
    setEditing((e) => ({ ...e, [p.id]: { name: p.name, purpose: p.purpose } }));
  }

  async function saveEdit(id: string) {
    const draft = editing[id];
    if (!draft) return;
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draft.name, purpose: draft.purpose }),
    });
    setEditing((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
    setSavedFlash(id);
    setTimeout(() => setSavedFlash(null), 1500);
    load();
  }

  async function removeProject(id: string) {
    if (!confirm("Delete this project entry? Its notes/files go too.")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    load();
  }

  async function createProject(dept: string) {
    if (!newName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), purpose: "", department: dept || null }),
    });
    if (res.ok) {
      setNewName("");
      setCreatingDept("");
      load();
    }
  }

  async function uploadFile(projectId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("project_id", projectId);
    await fetch("/api/documents", { method: "POST", body: form });
    load();
  }

  async function addNote(projectId: string) {
    const el = noteInputs.current[projectId];
    const text = el?.value.trim();
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain" });
    const file = new File([blob], `Note ${new Date().toLocaleDateString()}.txt`, { type: "text/plain" });
    await uploadFile(projectId, file);
    if (el) el.value = "";
  }

  async function removeFile(id: string) {
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    load();
  }

  const grouped: Record<string, Project[]> = { _none: [] };
  for (const d of Object.values(departments)) grouped[d.key] = [];
  for (const p of projects) grouped[p.department ?? "_none"] = [...(grouped[p.department ?? "_none"] ?? []), p];

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-[var(--border)] px-5 py-3.5">
        <h1 className="text-sm font-semibold">🗄️ Server Room</h1>
        <p className="text-[11px] text-[var(--muted)]">
          Project names, purposes, notes and files — edit directly here, no AI needed. Every agent reads the latest
          version instantly.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="space-y-6">
          {[...Object.values(departments).map((d) => d.key), "_none"].map((deptKey) => {
            const dept = deptKey === "_none" ? null : departments[deptKey as DeptKey];
            const list = grouped[deptKey] ?? [];
            if (list.length === 0 && deptKey === "_none") return null;
            return (
              <section key={deptKey}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: dept?.accent ?? "#8b93b8" }} />
                  <h2 className="text-xs font-bold" style={{ color: dept?.accent ?? "#8b93b8" }}>
                    {dept?.name ?? "Unassigned"}
                  </h2>
                  <button
                    onClick={() => {
                      setCreatingDept(deptKey);
                      setNewName("");
                    }}
                    className="ml-auto rounded-lg border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-white"
                  >
                    + Add project
                  </button>
                </div>

                {creatingDept === deptKey && (
                  <div className="mb-2 flex gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2">
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createProject(deptKey === "_none" ? "" : deptKey)}
                      placeholder="Project name…"
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      onClick={() => createProject(deptKey === "_none" ? "" : deptKey)}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Add
                    </button>
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-2">
                  {list.map((p) => {
                    const draft = editing[p.id];
                    return (
                      <div key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                        {draft ? (
                          <>
                            <input
                              value={draft.name}
                              onChange={(e) => setEditing((ed) => ({ ...ed, [p.id]: { ...draft, name: e.target.value } }))}
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-sm font-semibold outline-none focus:border-[var(--accent)]"
                            />
                            <textarea
                              value={draft.purpose}
                              onChange={(e) => setEditing((ed) => ({ ...ed, [p.id]: { ...draft, purpose: e.target.value } }))}
                              rows={4}
                              placeholder="What is this project, in your own words? Agents will read this exactly."
                              className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => saveEdit(p.id)}
                                className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white hover:brightness-110"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditing((e) => { const n = { ...e }; delete n[p.id]; return n; })}
                                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:text-white"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-sm font-semibold">{p.name}</h3>
                              <div className="flex shrink-0 gap-1">
                                {savedFlash === p.id && <span className="text-[10px] text-emerald-400">✔ saved</span>}
                                <button onClick={() => startEdit(p)} className="text-[10px] text-[var(--muted)] hover:text-white">
                                  ✎ edit
                                </button>
                                <button onClick={() => removeProject(p.id)} className="text-[10px] text-[var(--muted)] hover:text-red-400">
                                  ✕
                                </button>
                              </div>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted)]">
                              {p.purpose || <span className="italic">No purpose written yet — click edit.</span>}
                            </p>
                          </>
                        )}

                        {p.files.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {p.files.map((f) => (
                              <div key={f.id} className="group flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
                                <span className="text-xs">📄</span>
                                <span className="min-w-0 flex-1 truncate text-[11px]">{f.filename}</span>
                                <button
                                  onClick={() => removeFile(f.id)}
                                  className="shrink-0 text-[10px] text-[var(--muted)] opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex gap-2">
                          <input
                            ref={(el) => {
                              fileInputs.current[p.id] = el;
                            }}
                            type="file"
                            className="hidden"
                            accept=".txt,.md,.csv,.json,.log,.pdf"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) uploadFile(p.id, f);
                            }}
                          />
                          <button
                            onClick={() => fileInputs.current[p.id]?.click()}
                            className="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-white"
                          >
                            📎 Upload
                          </button>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <textarea
                            ref={(el) => {
                              noteInputs.current[p.id] = el;
                            }}
                            rows={1}
                            placeholder="Quick note…"
                            className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]"
                          />
                          <button
                            onClick={() => addNote(p.id)}
                            className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-[10px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-white"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {list.length === 0 && creatingDept !== deptKey && (
                  <p className="px-1 text-[11px] text-[var(--muted)]">No projects yet.</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
