"use client";

import { useEffect, useState } from "react";
import { departments, deptWorkers, workers, type DeptKey, type Worker } from "@/server/office/registry";
import { TILE, BOARD_W, BOARD_H, rooms } from "./layout";

export interface WorkerLive {
  status: "idle" | "working" | "done";
}

interface Position {
  x: number;
  y: number;
  walking: boolean;
  mode: "desk" | "collab" | "party" | "idle";
  talking: boolean;
  emoji?: string;
}

/** Positions live server-side (src/server/office/simEngine.ts) so every tab/device sees the same office. */
function usePositions() {
  const [data, setData] = useState<{ positions: Record<string, Position>; party: { kind: string; until: number } | null }>({
    positions: {},
    party: null,
  });
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/office/positions");
        if (res.ok && alive) setData(await res.json());
      } catch {
        /* transient — next poll retries */
      }
    };
    poll();
    const t = setInterval(poll, 700);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return data;
}

// ── sprites ───────────────────────────────────────────
function PixelDude({ w, walking, working }: { w: Worker; walking: boolean; working: boolean }) {
  const px = (x: number, y: number, wd: number, h: number, f: string, k: string) => (
    <rect key={k} x={x} y={y} width={wd} height={h} fill={f} />
  );
  return (
    <svg
      viewBox="0 0 12 16"
      width={26}
      height={35}
      shapeRendering="crispEdges"
      className={walking ? "anim-waddle" : working ? "anim-bob" : "anim-sway"}
    >
      {px(3, 0, 6, 1, w.hair, "h0")}
      {px(2, 1, 8, 2, w.hair, "h1")}
      {px(2, 3, 1, 1, w.hair, "h2")}
      {px(9, 3, 1, 1, w.hair, "h3")}
      {px(3, 3, 6, 3, w.skin, "f")}
      {px(4, 4, 1, 1, "#181b26", "e1")}
      {px(7, 4, 1, 1, "#181b26", "e2")}
      {px(3, 6, 6, 5, w.shirt, "b")}
      {px(2, 6, 1, 4, w.shirt, "a1")}
      {px(9, 6, 1, 4, w.shirt, "a2")}
      {px(2, 10, 1, 1, w.skin, "hd1")}
      {px(9, 10, 1, 1, w.skin, "hd2")}
      {px(3, 11, 3, 3, "#232b3f", "l1")}
      {px(6, 11, 3, 3, "#232b3f", "l2")}
      {px(3, 14, 3, 1, "#11141f", "s1")}
      {px(6, 14, 3, 1, "#11141f", "s2")}
    </svg>
  );
}

function Desk({ x, y, accent, on }: { x: number; y: number; accent: string; on: boolean }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) + 14 }}>
      <svg viewBox="0 0 34 18" width={2.4 * TILE} height={1.3 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={4} width={34} height={12} fill="#8a6444" />
        <rect x={0} y={4} width={34} height={3} fill="#a37a54" />
        <rect x={0} y={14} width={34} height={2} fill="#6d4e34" />
        {/* monitor */}
        <rect x={11} y={0} width={12} height={8} fill="#20242f" />
        <rect x={12} y={1} width={10} height={6} fill={on ? accent : "#39414f"} />
        {on && <rect x={12} y={1} width={10} height={2} fill="#ffffff" opacity={0.45} />}
        <rect x={15} y={8} width={4} height={1} fill="#20242f" />
        {/* keyboard + paper */}
        <rect x={13} y={10} width={8} height={2.5} fill="#3a4152" />
        <rect x={25} y={9} width={6} height={4} fill="#eef0f4" />
      </svg>
    </div>
  );
}

function Couch({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 40 16" width={3.4 * TILE} height={1.4 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={0} width={40} height={6} fill={color} />
        <rect x={0} y={6} width={40} height={7} fill={color} opacity={0.75} />
        <rect x={0} y={0} width={4} height={13} fill={color} />
        <rect x={36} y={0} width={4} height={13} fill={color} />
        <rect x={0} y={13} width={40} height={2} fill="#00000033" />
      </svg>
    </div>
  );
}

function CoffeeMachine({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 14 20" width={1.2 * TILE} height={1.7 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={0} width={14} height={18} fill="#b3372f" />
        <rect x={1} y={1} width={12} height={4} fill="#111722" />
        <rect x={4} y={8} width={6} height={5} fill="#111722" />
        <rect x={5.5} y={10} width={3} height={3} fill="#e8e2d0" />
        <rect x={0} y={18} width={14} height={2} fill="#5c1d19" />
      </svg>
    </div>
  );
}

function Vending({ x, y }: { x: number; y: number }) {
  const dots = ["#f87171", "#fbbf24", "#4ade80", "#60a5fa", "#f472b6", "#c084fc"];
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 16 22" width={1.35 * TILE} height={1.85 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={0} width={16} height={20} fill="#c53030" />
        <rect x={1.5} y={1.5} width={9} height={12} fill="#151b28" />
        {dots.map((c, i) => (
          <rect key={i} x={3 + (i % 3) * 2.5} y={3 + Math.floor(i / 3) * 3} width={1.8} height={2} fill={c} />
        ))}
        <rect x={12} y={2} width={2.5} height={5} fill="#2d3648" />
        <rect x={2} y={15} width={8} height={3} fill="#2d3648" />
        <rect x={0} y={20} width={16} height={2} fill="#5c1d19" />
      </svg>
    </div>
  );
}

function PingPong({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 56 30" width={4.6 * TILE} height={2.5 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={0} width={56} height={26} fill="#2e8b57" />
        <rect x={0} y={0} width={56} height={26} fill="none" stroke="#e8f4ec" strokeWidth={2} />
        <rect x={27} y={0} width={2} height={26} fill="#dce9e0" />
        <rect x={0} y={26} width={56} height={3} fill="#1d5c39" />
        <rect x={44} y={5} width={4} height={4} fill="#fef08a" />
      </svg>
    </div>
  );
}

function Bookshelf({ x, y }: { x: number; y: number }) {
  const books = ["#e05252", "#e0a052", "#52a2e0", "#52c98a", "#a26be0", "#e05287"];
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 24 26" width={2 * TILE} height={2.15 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={0} width={24} height={24} fill="#7a5230" />
        {[2, 10, 17].map((ry, row) => (
          <g key={row}>
            <rect x={2} y={ry} width={20} height={6} fill="#3d2817" />
            {books.slice(0, 4 + (row % 3)).map((c, i) => (
              <rect key={i} x={3 + i * 3.2} y={ry + 0.6} width={2.4} height={5} fill={c} />
            ))}
          </g>
        ))}
        <rect x={0} y={24} width={24} height={2} fill="#4a3018" />
      </svg>
    </div>
  );
}

function WaterCooler({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 10 18" width={0.9 * TILE} height={1.6 * TILE} shapeRendering="crispEdges">
        <rect x={1.5} y={0} width={7} height={6} fill="#7dd3fc" />
        <rect x={0} y={6} width={10} height={10} fill="#e8ecf4" />
        <rect x={3} y={8} width={4} height={2} fill="#3b82f6" />
        <rect x={0} y={16} width={10} height={2} fill="#9aa3b8" />
      </svg>
    </div>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 12 16" width={TILE} height={1.35 * TILE} shapeRendering="crispEdges">
        <rect x={3} y={0} width={6} height={3} fill="#3f9e58" />
        <rect x={1} y={2} width={10} height={5} fill="#4bb86a" />
        <rect x={2} y={4} width={8} height={3} fill="#3f9e58" />
        <rect x={3} y={9} width={6} height={5} fill="#a05a2c" />
        <rect x={3} y={13} width={6} height={1.5} fill="#7a421f" />
      </svg>
    </div>
  );
}

function BigTable({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 100 40" width={8.4 * TILE} height={3.35 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={2} width={100} height={32} rx={6} fill="#8a6444" />
        <rect x={3} y={5} width={94} height={24} rx={4} fill="#a37a54" />
        <rect x={0} y={34} width={100} height={4} rx={2} fill="#6d4e34" />
        <rect x={40} y={12} width={20} height={10} fill="#eef0f4" />
        <rect x={42} y={14} width={12} height={1.5} fill="#8b93b8" />
        <rect x={42} y={17} width={14} height={1.5} fill="#8b93b8" />
      </svg>
    </div>
  );
}

function Whiteboard({ x, y }: { x: number; y: number }) {
  return (
    <div className="absolute" style={{ left: x * TILE, top: y * TILE, zIndex: Math.round(y * 10) }}>
      <svg viewBox="0 0 30 20" width={2.5 * TILE} height={1.7 * TILE} shapeRendering="crispEdges">
        <rect x={0} y={0} width={30} height={14} fill="#f4f6f8" stroke="#aab2c4" strokeWidth={1.5} />
        <path d="M 4 8 L 9 4 L 14 7 L 19 3" stroke="#f472b6" strokeWidth={1.5} fill="none" />
        <rect x={4} y={10} width={12} height={1.2} fill="#60a5fa" />
        <rect x={13} y={14} width={2} height={5} fill="#8b93a8" />
        <rect x={15.5} y={14} width={2} height={5} fill="#8b93a8" />
      </svg>
    </div>
  );
}

// ── board ─────────────────────────────────────────────
export default function OfficeMap({
  live,
  scale,
  onDeptClick,
}: {
  live: Record<string, WorkerLive>;
  scale: number;
  onDeptClick?: (d: DeptKey) => void;
}) {
  const { positions, party } = usePositions();

  return (
    <div
      className="relative origin-top-left overflow-hidden rounded-xl"
      style={{
        width: BOARD_W,
        height: BOARD_H,
        transform: `scale(${scale})`,
        background: "repeating-conic-gradient(#d8dbe4 0% 25%, #cfd3dd 0% 50%) 0 0 / 40px 40px",
        border: "6px solid #262c44",
        boxShadow: "0 0 0 2px #3a4166",
      }}
    >
      {/* rooms */}
      {rooms.map((room) => {
        const dept = departments[room.dept];
        const team = deptWorkers(room.dept);
        const anyActive = team.some((w) => live[w.key]?.status === "working");
        const doorY = room.y + 2.4;
        return (
          <div key={room.dept} onClick={() => onDeptClick?.(room.dept)} className="cursor-pointer">
            {/* floor + walls */}
            <div
              className={`absolute ${anyActive ? "room-active" : ""}`}
              style={{
                left: room.x * TILE - 4,
                top: room.y * TILE - 4,
                width: room.w * TILE + 8,
                height: room.h * TILE + 8,
                background: `linear-gradient(${dept.accent}26, ${dept.accent}26), #dfe2ea`,
                border: `4px solid ${anyActive ? dept.accent : "#454e74"}`,
                borderRadius: 6,
                transition: "border-color .4s",
              }}
            />
            {/* door gap on the inner wall */}
            <div
              className="absolute"
              style={{
                left: room.side === "left" ? (room.x + room.w) * TILE - 2 : room.x * TILE - 6,
                top: doorY * TILE,
                width: 8,
                height: 1.4 * TILE,
                background: `linear-gradient(${dept.accent}26, ${dept.accent}26), #dfe2ea`,
                zIndex: 2,
              }}
            />
            {/* name plate */}
            <div
              className="absolute z-30 flex items-center gap-1.5 rounded px-2 py-[3px] font-pixel text-[7px] tracking-wide"
              style={{
                left: room.x * TILE + 4,
                top: room.y * TILE - 14,
                background: "#1a2036",
                color: dept.accent,
                border: `1px solid ${dept.accent}66`,
              }}
            >
              {anyActive && <span className="led-blink inline-block h-[6px] w-[6px] rounded-full" style={{ background: dept.accent }} />}
              {dept.name.toUpperCase()}
            </div>
            {/* desks */}
            {team.map((w, i) => {
              const [dx, dy] = room.desks[i % room.desks.length];
              return <Desk key={w.key} x={dx} y={dy + 0.55} accent={dept.accent} on={live[w.key]?.status === "working"} />;
            })}
          </div>
        );
      })}

      {/* commons furniture */}
      <div className="absolute z-20 font-pixel text-[8px] tracking-widest text-[#8890ad]" style={{ left: 20.4 * TILE, top: 0.5 * TILE }}>
        ☕ LOUNGE
      </div>
      <CoffeeMachine x={19.2} y={1.2} />
      <Vending x={22.2} y={1} />
      <Couch x={13.8} y={3.6} color="#5b8cd9" />
      <Couch x={26.8} y={3.6} color="#d97b5b" />
      <Plant x={12.6} y={1} />
      <Plant x={32.4} y={1} />

      <div className="absolute z-20 font-pixel text-[8px] tracking-widest text-[#8890ad]" style={{ left: 19.4 * TILE, top: 10.6 * TILE }}>
        COLLAB ZONE
      </div>
      <Whiteboard x={14.6} y={12.4} />
      <BigTable x={17.6} y={13.6} />
      <Plant x={31.6} y={13.5} />

      <div className="absolute z-20 font-pixel text-[8px] tracking-widest text-[#8890ad]" style={{ left: 20.2 * TILE, top: 21 * TILE }}>
        CHILL
      </div>
      <PingPong x={15.4} y={22.4} />
      <Bookshelf x={27.4} y={21.8} />
      <WaterCooler x={31.8} y={22.4} />
      <Plant x={13} y={27.2} />
      <Plant x={33} y={27.2} />

      {/* party banner */}
      {party && (
        <div
          className="absolute z-40 rounded-full border border-amber-300/60 bg-[#1a2036] px-3 py-1 font-pixel text-[8px] tracking-wide text-amber-300"
          style={{ left: 16 * TILE, top: -1.4 * TILE }}
        >
          {party.kind === "party" ? "🎉 PARTY MODE" : party.kind === "coffeebreak" ? "☕ COFFEE BREAK" : "🤝 GATHERING"}
        </div>
      )}

      {/* agents */}
      {Object.values(workers).map((w) => {
        const p = positions[w.key];
        if (!p) return null;
        const st = live[w.key]?.status ?? "idle";
        const working = st === "working" && p.mode === "desk" && !p.walking;
        const debating = p.mode === "collab" && !p.walking;
        const dept = departments[w.dept];
        return (
          <div
            key={w.key}
            className="absolute flex flex-col items-center"
            style={{
              left: p.x * TILE - 13,
              top: p.y * TILE - 30,
              zIndex: Math.round(p.y * 10) + 15,
              transition: "left .68s linear, top .68s linear",
            }}
            title={`${w.name} — ${w.role}`}
          >
            {/* bubble */}
            <div className="pointer-events-none flex h-[16px] items-end">
              {working && (
                <span className="typing-dots rounded border border-[#39415f] bg-white px-1 pb-[1px] text-[8px] leading-[12px] text-[#232b3f]" />
              )}
              {!working && debating && (
                <span className="rounded border border-indigo-300 bg-white px-[3px] text-[9px] leading-[13px]">🗣️</span>
              )}
              {!working && !debating && p.talking && !p.walking && (
                <span className="typing-dots rounded border border-[#c8cede] bg-white px-1 pb-[1px] text-[8px] leading-[12px] text-[#5964a8]" />
              )}
              {!working && !debating && !p.talking && p.emoji && !p.walking && (
                <span className="rounded border border-[#c8cede] bg-white px-[3px] text-[9px] leading-[13px]">{p.emoji}</span>
              )}
              {st === "done" && !working && !debating && !p.talking && !p.emoji && (
                <span className="rounded border border-emerald-500 bg-white px-[3px] text-[8px] leading-[13px] text-emerald-600">✔</span>
              )}
            </div>
            <PixelDude w={w} walking={p.walking} working={working} />
            <span
              className="pointer-events-none -mt-[2px] whitespace-nowrap rounded-sm px-1 text-[8px] font-bold leading-[11px]"
              style={{
                background: working ? dept.accent : debating ? "#818cf8" : "#ffffffd9",
                color: working || debating ? "#fff" : "#2a3050",
                boxShadow: "0 1px 0 #00000022",
              }}
            >
              {w.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
