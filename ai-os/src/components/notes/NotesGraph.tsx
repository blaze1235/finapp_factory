"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { orgUnit } from "@/server/office/registry";
import TeamMemoryPanel from "./TeamMemoryPanel";

interface Note {
  id: string;
  title: string;
  department: string;
  result: string;
  created_at: string;
}

interface Node {
  id: string;
  label: string;
  kind: "hub" | "note";
  dept: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Edge {
  a: string;
  b: string;
}

const W = 900;
const H = 620;

export default function NotesGraph() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    fetch("/api/notes")
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []));
  }, []);

  // build graph
  useEffect(() => {
    const usedDepts = [...new Set(notes.map((n) => n.department))].filter((d) => orgUnit(d));
    const ns: Node[] = [
      ...usedDepts.map((d, i) => ({
        id: `hub-${d}`,
        label: orgUnit(d)!.name,
        kind: "hub" as const,
        dept: d,
        x: W / 2 + Math.cos((i / Math.max(usedDepts.length, 1)) * Math.PI * 2) * 180,
        y: H / 2 + Math.sin((i / Math.max(usedDepts.length, 1)) * Math.PI * 2) * 140,
        vx: 0,
        vy: 0,
      })),
      ...notes.map((n, i) => ({
        id: n.id,
        label: n.title,
        kind: "note" as const,
        dept: n.department,
        x: W / 2 + Math.cos(i * 2.4) * (220 + (i % 5) * 30),
        y: H / 2 + Math.sin(i * 2.4) * (170 + (i % 4) * 30),
        vx: 0,
        vy: 0,
      })),
    ];
    const es: Edge[] = notes
      .filter((n) => orgUnit(n.department))
      .map((n) => ({ a: `hub-${n.department}`, b: n.id }));
    // wiki-links between notes: [[Title]] mentions or title inclusion
    for (const n of notes) {
      const links = [...n.result.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].toLowerCase());
      for (const other of notes) {
        if (other.id !== n.id && links.some((l) => other.title.toLowerCase().includes(l) || l.includes(other.title.toLowerCase()))) {
          es.push({ a: n.id, b: other.id });
        }
      }
    }
    setNodes(ns);
    setEdges(es);
  }, [notes]);

  // force simulation
  useEffect(() => {
    if (nodes.length === 0) return;
    let ticks = 0;
    const sim = () => {
      setNodes((prev) => {
        const next = prev.map((n) => ({ ...n }));
        const byId = Object.fromEntries(next.map((n) => [n.id, n]));
        // repulsion
        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const a = next[i];
            const b = next[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            const d2 = Math.max(dx * dx + dy * dy, 40);
            const f = 2600 / d2;
            const d = Math.sqrt(d2);
            dx /= d;
            dy /= d;
            a.vx += dx * f;
            a.vy += dy * f;
            b.vx -= dx * f;
            b.vy -= dy * f;
          }
        }
        // springs
        for (const e of edges) {
          const a = byId[e.a];
          const b = byId[e.b];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = (d - 95) * 0.012;
          a.vx += (dx / d) * f;
          a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f;
          b.vy -= (dy / d) * f;
        }
        // gravity + integrate
        for (const n of next) {
          n.vx += (W / 2 - n.x) * 0.0015;
          n.vy += (H / 2 - n.y) * 0.0015;
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x = Math.max(30, Math.min(W - 30, n.x + n.vx));
          n.y = Math.max(24, Math.min(H - 24, n.y + n.vy));
        }
        return next;
      });
      ticks++;
      if (ticks < 160) animRef.current = requestAnimationFrame(sim);
    };
    animRef.current = requestAnimationFrame(sim);
    return () => cancelAnimationFrame(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges.length, notes.length]);

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const neighbors = new Set<string>();
  if (hover) {
    neighbors.add(hover);
    for (const e of edges) {
      if (e.a === hover) neighbors.add(e.b);
      if (e.b === hover) neighbors.add(e.a);
    }
  }

  return (
    <div className="flex h-screen">
      <TeamMemoryPanel />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-[var(--border)] px-5 py-3.5">
          <h1 className="text-sm font-semibold">🕸️ Brain Net</h1>
          <p className="text-[11px] text-[var(--muted)]">
            Every deliverable your teams produce becomes a node, linked to its department. {notes.length} notes.
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {notes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <p className="max-w-sm text-xs text-[var(--muted)]">
                No notes yet — give your teams tasks in the Office, and finished deliverables will appear here as a
                knowledge graph.
              </p>
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-full w-full" style={{ maxWidth: 1100 }}>
              {edges.map((e, i) => {
                const a = byId[e.a];
                const b = byId[e.b];
                if (!a || !b) return null;
                const lit = hover && (e.a === hover || e.b === hover);
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={lit ? "#818cf8" : "#39415f"}
                    strokeWidth={lit ? 1.6 : 0.8}
                    opacity={hover && !lit ? 0.25 : 0.8}
                  />
                );
              })}
              {nodes.map((n) => {
                const accent = orgUnit(n.dept)?.accent ?? "#818cf8";
                const dim = hover && !neighbors.has(n.id);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    opacity={dim ? 0.25 : 1}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => {
                      if (n.kind === "note") setSelected(notes.find((x) => x.id === n.id) ?? null);
                    }}
                  >
                    <circle r={n.kind === "hub" ? 14 : 7} fill={n.kind === "hub" ? `${accent}33` : accent} stroke={accent} strokeWidth={n.kind === "hub" ? 2 : 1} />
                    <text
                      y={n.kind === "hub" ? 28 : 19}
                      textAnchor="middle"
                      fontSize={n.kind === "hub" ? 11 : 9}
                      fontWeight={n.kind === "hub" ? 700 : 500}
                      fill={n.kind === "hub" ? accent : "#aeb6d9"}
                      fontFamily="ui-sans-serif, system-ui"
                    >
                      {n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* note panel */}
      {selected && (
        <aside className="fixed inset-0 z-40 flex flex-col border-l border-[var(--border)] bg-[var(--panel)] md:static md:inset-auto md:z-auto md:w-[440px] md:shrink-0">
          <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] p-4">
            <div>
              <span
                className="rounded px-1.5 py-0.5 font-pixel text-[7px]"
                style={{
                  background: `${orgUnit(selected.department)?.accent ?? "#818cf8"}22`,
                  color: orgUnit(selected.department)?.accent ?? "#818cf8",
                }}
              >
                {orgUnit(selected.department)?.name.toUpperCase() ?? selected.department}
              </span>
              <h2 className="mt-1.5 text-sm font-semibold">{selected.title}</h2>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  const blob = new Blob([selected.result], { type: "text/markdown" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${selected.title.replace(/[^\w\d]+/g, "-").toLowerCase()}.md`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
                className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-white"
              >
                ⬇ .md
              </button>
              <button
                onClick={() => setSelected(null)}
                className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="deliverable min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.result}</ReactMarkdown>
          </div>
        </aside>
      )}
    </div>
  );
}
