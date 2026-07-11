"use client";

import { departments, deptWorkers, type DeptKey } from "@/server/office/registry";
import { iso, zones, FLOOR, BOARD_W, BOARD_H, type Zone } from "./layout";

export interface WorkerLive {
  status: "idle" | "working" | "done";
  bubble?: string;
}

const WALL_H = 104;
const DESK_H = 26;
const SLAB = 16;

const P = (pts: [number, number][]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** isometric 3-face box */
function IsoBox({
  gx,
  gy,
  w,
  d,
  h,
  z = 0,
  top,
  front,
  side,
}: {
  gx: number;
  gy: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  top: string;
  front: string;
  side: string;
}) {
  const topFace: [number, number][] = [
    iso(gx, gy, z + h),
    iso(gx + w, gy, z + h),
    iso(gx + w, gy + d, z + h),
    iso(gx, gy + d, z + h),
  ];
  const frontFace: [number, number][] = [
    iso(gx, gy + d, z + h),
    iso(gx + w, gy + d, z + h),
    iso(gx + w, gy + d, z),
    iso(gx, gy + d, z),
  ];
  const sideFace: [number, number][] = [
    iso(gx + w, gy, z + h),
    iso(gx + w, gy + d, z + h),
    iso(gx + w, gy + d, z),
    iso(gx + w, gy, z),
  ];
  return (
    <g>
      <polygon points={P(sideFace)} fill={side} />
      <polygon points={P(frontFace)} fill={front} />
      <polygon points={P(topFace)} fill={top} />
    </g>
  );
}

function Plant({ gx, gy, scale = 1 }: { gx: number; gy: number; scale?: number }) {
  const [x, y] = iso(gx, gy);
  return (
    <g transform={`translate(${x},${y})`}>
      <ellipse cx={0} cy={4} rx={16 * scale} ry={6 * scale} fill="#000" opacity={0.22} />
      {/* pot */}
      <polygon
        points={P([
          [-11 * scale, -2],
          [11 * scale, -2],
          [8 * scale, -20 * scale],
          [-8 * scale, -20 * scale],
        ])}
        fill="#7c5138"
      />
      <polygon
        points={P([
          [-11 * scale, -2],
          [11 * scale, -2],
          [11 * scale, -6],
          [-11 * scale, -6],
        ])}
        fill="#5f3d29"
      />
      {/* foliage */}
      {[
        [0, -46, 15],
        [-11, -34, 11],
        [11, -34, 11],
        [-6, -52, 10],
        [7, -50, 10],
      ].map(([dx, dy, r], i) => (
        <circle key={i} cx={dx * scale} cy={-20 * scale + dy * scale * 0.6} r={r * scale} fill={i % 2 ? "#3f8a52" : "#4fa062"} />
      ))}
    </g>
  );
}

function Avatar({ px, py, skin, hair, shirt, working, accent }: { px: number; py: number; skin: string; hair: string; shirt: string; working: boolean; accent: string }) {
  const shirtDark = shade(shirt, -0.22);
  return (
    <g className={working ? "anim-bob" : undefined} style={working ? undefined : undefined}>
      {working && <ellipse cx={px} cy={py - 30} rx={30} ry={30} fill={accent} opacity={0.14} />}
      {/* chair back */}
      <rect x={px - 20} y={py - 60} width={40} height={54} rx={12} fill="#262b3a" />
      <rect x={px - 20} y={py - 60} width={40} height={10} rx={6} fill={shade(accent, -0.1)} opacity={0.5} />
      {/* arms */}
      <rect x={px - 27} y={py - 50} width={11} height={34} rx={5.5} fill={shirtDark} />
      <rect x={px + 16} y={py - 50} width={11} height={34} rx={5.5} fill={shirtDark} />
      <circle cx={px - 21} cy={py - 18} r={5} fill={skin} />
      <circle cx={px + 21} cy={py - 18} r={5} fill={skin} />
      {/* torso */}
      <path
        d={`M ${px - 20} ${py - 4} L ${px - 23} ${py - 44} Q ${px - 23} ${py - 55} ${px - 12} ${py - 57} L ${px + 12} ${py - 57} Q ${px + 23} ${py - 55} ${px + 23} ${py - 44} L ${px + 20} ${py - 4} Z`}
        fill={shirt}
      />
      <path d={`M ${px - 20} ${py - 4} L ${px + 20} ${py - 4} L ${px + 22} ${py - 22} Q ${px} ${py - 14} ${px - 22} ${py - 22} Z`} fill={shirtDark} opacity={0.6} />
      {/* collar */}
      <path d={`M ${px - 8} ${py - 56} L ${px} ${py - 48} L ${px + 8} ${py - 56} Z`} fill={shade(shirt, -0.32)} />
      {/* neck */}
      <rect x={px - 6} y={py - 62} width={12} height={9} rx={3} fill={shade(skin, -0.12)} />
      {/* head */}
      <ellipse cx={px} cy={py - 74} rx={14} ry={16} fill={skin} />
      <ellipse cx={px - 4} cy={py - 78} rx={6} ry={7} fill="#fff" opacity={0.12} />
      <ellipse cx={px + 6} cy={py - 70} rx={7} ry={8} fill="#000" opacity={0.08} />
      <circle cx={px - 14} cy={py - 73} r={2.6} fill={shade(skin, -0.1)} />
      <circle cx={px + 14} cy={py - 73} r={2.6} fill={shade(skin, -0.1)} />
      {/* hair */}
      <path
        d={`M ${px - 15} ${py - 72} Q ${px - 16} ${py - 92} ${px} ${py - 92} Q ${px + 16} ${py - 92} ${px + 15} ${py - 72} Q ${px + 8} ${py - 80} ${px} ${py - 79} Q ${px - 8} ${py - 80} ${px - 15} ${py - 72} Z`}
        fill={hair}
      />
      {/* eyes */}
      <ellipse cx={px - 5.5} cy={py - 73} rx={1.7} ry={2.5} fill="#1b1e28" />
      <ellipse cx={px + 5.5} cy={py - 73} rx={1.7} ry={2.5} fill="#1b1e28" />
      <circle cx={px - 5} cy={py - 74} r={0.6} fill="#fff" />
      <circle cx={px + 6} cy={py - 74} r={0.6} fill="#fff" />
      {/* mouth */}
      <path d={`M ${px - 4} ${py - 65} Q ${px} ${py - 62} ${px + 4} ${py - 65}`} stroke={shade(skin, -0.35)} strokeWidth={1.2} fill="none" strokeLinecap="round" />
    </g>
  );
}

function DeskCluster({
  gx,
  gy,
  worker,
  live,
  accent,
}: {
  gx: number;
  gy: number;
  worker: { name: string; role: string; skin: string; hair: string; shirt: string };
  live: WorkerLive;
  accent: string;
}) {
  const working = live.status === "working";
  const done = live.status === "done";
  const [px, py] = iso(gx + 0.5, gy + 0.5, 0);

  // desk sits in front of the person (larger gy)
  const dGx = gx - 0.15;
  const dGy = gy + 0.62;
  const dW = 1.55;
  const dD = 0.62;

  // monitor on the desk, screen facing the viewer
  const mGx = gx + 0.15;
  const mGy = gy + 1.02;
  const [nameX, nameY] = iso(gx + 0.5, gy + 1.55, 0);
  const screenFace: [number, number][] = [
    iso(mGx, mGy + 0.12, DESK_H + 20),
    iso(mGx + 1.0, mGy + 0.12, DESK_H + 20),
    iso(mGx + 1.0, mGy + 0.12, DESK_H + 3),
    iso(mGx, mGy + 0.12, DESK_H + 3),
  ];

  return (
    <g>
      {/* floor shadow */}
      <ellipse cx={px} cy={py + 8} rx={30} ry={11} fill="#000" opacity={0.22} />

      <Avatar px={px} py={py} skin={worker.skin} hair={worker.hair} shirt={worker.shirt} working={working} accent={accent} />

      {/* desk */}
      <IsoBox gx={dGx} gy={dGy} w={dW} d={dD} h={DESK_H} top="#e7e8ec" front="#c7cad4" side="#a9adba" />

      {/* monitor */}
      <IsoBox gx={mGx} gy={mGy} w={1.0} d={0.1} h={20} z={DESK_H + 3} top="#2a2e3a" front="#23262f" side="#191c25" />
      <polygon points={P(screenFace)} fill={working ? accent : "#10131c"} opacity={working ? 0.92 : 1} />
      {working && (
        <>
          <polygon points={P(screenFace)} fill="#fff" opacity={0.18} className="led-blink" />
          <polyline points={P([screenFace[0], screenFace[1]])} stroke="#fff" strokeWidth={1} opacity={0.5} />
        </>
      )}
      {/* monitor stand + base */}
      <IsoBox gx={mGx + 0.42} gy={mGy + 0.02} w={0.16} d={0.06} h={6} z={DESK_H + 3} top="#3a3f4c" front="#2b2f3a" side="#22252f" />

      {/* status bubble */}
      {working && (
        <g transform={`translate(${px}, ${py - 100})`}>
          <rect x={-16} y={-13} width={32} height={20} rx={8} fill="#fff" />
          <polygon points="-4,6 4,6 0,12" fill="#fff" />
          {[-7, 0, 7].map((dx, i) => (
            <circle key={i} cx={dx} cy={-3} r={2.4} fill="#3a3f52" className="led-blink" style={{ animationDelay: `${i * 0.18}s` }} />
          ))}
        </g>
      )}
      {done && (
        <g transform={`translate(${px}, ${py - 100})`}>
          <circle cx={0} cy={-3} r={11} fill="#0f2a1c" stroke="#2f9e6a" />
          <path d="M -5 -3 L -1 1 L 5 -7" stroke="#4ade80" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

      {/* nameplate */}
      <g transform={`translate(${nameX}, ${nameY})`} style={{ pointerEvents: "none" }}>
        <rect x={-42} y={-9} width={84} height={19} rx={9} fill="#171b2b" opacity={0.92} stroke={working ? accent : "#2a3050"} />
        <circle cx={-32} cy={0.5} r={3} fill={accent} className={working ? "led-blink" : undefined} />
        <text x={-24} y={4} fontSize={11} fontWeight={600} fill="#e5e9ff" fontFamily="ui-sans-serif, system-ui">
          {worker.name}
        </text>
      </g>
    </g>
  );
}

export default function IsoOffice({
  live,
  scale,
  onDeptClick,
}: {
  live: Record<string, WorkerLive>;
  scale: number;
  onDeptClick?: (d: DeptKey) => void;
}) {
  // ── collect depth-sorted objects ────────────────────
  type Obj = { key: string; sort: number; el: React.ReactNode };
  const objects: Obj[] = [];

  for (const zone of zones) {
    const dept = departments[zone.dept];
    const team = deptWorkers(zone.dept);
    team.forEach((w, i) => {
      const slot = zone.slots[i];
      if (!slot) return;
      const [gx, gy] = slot;
      objects.push({
        key: w.key,
        sort: gx + gy,
        el: <DeskCluster key={w.key} gx={gx} gy={gy} worker={w} live={live[w.key] ?? { status: "idle" }} accent={dept.accent} />,
      });
    });
  }

  // decor
  const plants: [number, number, number][] = [
    [0.3, 0.3, 1.1],
    [16.6, 0.3, 1.1],
    [0.3, 12.8, 1.1],
    [16.6, 12.8, 1.1],
    [8.5, 6.5, 1.25],
  ];
  plants.forEach(([gx, gy, s], i) => objects.push({ key: `plant${i}`, sort: gx + gy - 0.01, el: <Plant key={`plant${i}`} gx={gx} gy={gy} scale={s} /> }));

  // central meeting table
  objects.push({
    key: "meeting",
    sort: 7.5 + 6.5,
    el: (
      <g key="meeting">
        <ellipse cx={iso(8.4, 7)[0]} cy={iso(8.4, 7)[1] + 8} rx={54} ry={20} fill="#000" opacity={0.18} />
        <IsoBox gx={7.4} gy={6} w={2.0} d={1.4} h={22} top="#3a2f26" front="#2c231b" side="#221b15" />
        <ellipse cx={iso(8.4, 6.7)[0]} cy={iso(8.4, 6.7)[1] - 22} rx={40} ry={20} fill="#6b4f38" />
        <ellipse cx={iso(8.4, 6.7)[0]} cy={iso(8.4, 6.7)[1] - 23} rx={40} ry={20} fill="#7c5c42" />
      </g>
    ),
  });

  objects.sort((a, b) => a.sort - b.sort);

  // ── floor + zone rugs ───────────────────────────────
  const floorTop: [number, number][] = [
    iso(FLOOR.gx0, FLOOR.gy0),
    iso(FLOOR.gx1 + 1, FLOOR.gy0),
    iso(FLOOR.gx1 + 1, FLOOR.gy1 + 1),
    iso(FLOOR.gx0, FLOOR.gy1 + 1),
  ];
  const slabFrontL: [number, number][] = [
    iso(FLOOR.gx0, FLOOR.gy1 + 1),
    iso(FLOOR.gx1 + 1, FLOOR.gy1 + 1),
    iso(FLOOR.gx1 + 1, FLOOR.gy1 + 1, -SLAB),
    iso(FLOOR.gx0, FLOOR.gy1 + 1, -SLAB),
  ];
  const slabFrontR: [number, number][] = [
    iso(FLOOR.gx1 + 1, FLOOR.gy0),
    iso(FLOOR.gx1 + 1, FLOOR.gy1 + 1),
    iso(FLOOR.gx1 + 1, FLOOR.gy1 + 1, -SLAB),
    iso(FLOOR.gx1 + 1, FLOOR.gy0, -SLAB),
  ];

  // walls
  const leftWall: [number, number][] = [
    iso(FLOOR.gx0, FLOOR.gy0, 0),
    iso(FLOOR.gx0, FLOOR.gy1 + 1, 0),
    iso(FLOOR.gx0, FLOOR.gy1 + 1, WALL_H),
    iso(FLOOR.gx0, FLOOR.gy0, WALL_H),
  ];
  const topWall: [number, number][] = [
    iso(FLOOR.gx0, FLOOR.gy0, 0),
    iso(FLOOR.gx1 + 1, FLOOR.gy0, 0),
    iso(FLOOR.gx1 + 1, FLOOR.gy0, WALL_H),
    iso(FLOOR.gx0, FLOOR.gy0, WALL_H),
  ];

  const window = (a: number, b: number): [number, number][] => [
    iso(FLOOR.gx0, a, 40),
    iso(FLOOR.gx0, b, 40),
    iso(FLOOR.gx0, b, 86),
    iso(FLOOR.gx0, a, 86),
  ];
  const whiteboard: [number, number][] = [
    iso(5, FLOOR.gy0, 44),
    iso(9.5, FLOOR.gy0, 44),
    iso(9.5, FLOOR.gy0, 84),
    iso(5, FLOOR.gy0, 84),
  ];

  return (
    <div className="origin-top-left" style={{ width: BOARD_W, height: BOARD_H, transform: `scale(${scale})` }}>
      <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} width={BOARD_W} height={BOARD_H} style={{ overflow: "visible" }}>
        {/* walls */}
        <polygon points={P(leftWall)} fill="#aeb2c0" />
        <polygon points={P(topWall)} fill="#c3c7d3" />
        {/* baseboards */}
        <polygon points={P([iso(FLOOR.gx0, FLOOR.gy0, 0), iso(FLOOR.gx0, FLOOR.gy1 + 1, 0), iso(FLOOR.gx0, FLOOR.gy1 + 1, 9), iso(FLOOR.gx0, FLOOR.gy0, 9)])} fill="#7c8091" />
        <polygon points={P([iso(FLOOR.gx0, FLOOR.gy0, 0), iso(FLOOR.gx1 + 1, FLOOR.gy0, 0), iso(FLOOR.gx1 + 1, FLOOR.gy0, 9), iso(FLOOR.gx0, FLOOR.gy0, 9)])} fill="#8b8fa0" />
        {/* windows on left wall */}
        {[window(1.5, 4), window(5, 7.5), window(9, 11.5)].map((w, i) => (
          <g key={i}>
            <polygon points={P(w)} fill="#8fc7e8" opacity={0.85} />
            <polygon points={P(w)} fill="none" stroke="#e8eef4" strokeWidth={2} />
          </g>
        ))}
        {/* whiteboard on top wall */}
        <polygon points={P(whiteboard)} fill="#f4f5f7" stroke="#d3d6dd" strokeWidth={2} />
        <polyline points={P([iso(5.6, FLOOR.gy0, 74), iso(7, FLOOR.gy0, 70), iso(8.2, FLOOR.gy0, 76)])} stroke="#f472b6" strokeWidth={2} fill="none" />
        <polyline points={P([iso(6, FLOOR.gy0, 60), iso(9, FLOOR.gy0, 60)])} stroke="#4ade80" strokeWidth={2} fill="none" />

        {/* floor slab */}
        <polygon points={P(slabFrontL)} fill="#4a3623" />
        <polygon points={P(slabFrontR)} fill="#3c2c1c" />
        <polygon points={P(floorTop)} fill="#a67c4f" />
        {/* wood planks */}
        {Array.from({ length: FLOOR.gy1 + 1 }, (_, k) => k + 1).map((k) => (
          <polyline key={`pl${k}`} points={P([iso(FLOOR.gx0, k), iso(FLOOR.gx1 + 1, k)])} stroke="#96703f" strokeWidth={1} opacity={0.5} />
        ))}

        {/* zone rugs (clickable) */}
        {zones.map((zone: Zone) => {
          const dept = departments[zone.dept];
          const team = deptWorkers(zone.dept);
          const anyActive = team.some((w) => live[w.key]?.status === "working");
          const rug: [number, number][] = [
            iso(zone.gx0 - 0.3, zone.gy0 - 0.3),
            iso(zone.gx1 + 1.3, zone.gy0 - 0.3),
            iso(zone.gx1 + 1.3, zone.gy1 + 1.3),
            iso(zone.gx0 - 0.3, zone.gy1 + 1.3),
          ];
          return (
            <g key={zone.dept} onClick={() => onDeptClick?.(zone.dept)} style={{ cursor: "pointer" }}>
              <polygon points={P(rug)} fill={dept.accent} opacity={anyActive ? 0.2 : 0.11} />
              <polygon points={P(rug)} fill="none" stroke={dept.accent} strokeWidth={anyActive ? 2.5 : 1.5} opacity={anyActive ? 0.9 : 0.45} className={anyActive ? "led-blink" : undefined} />
            </g>
          );
        })}

        {/* depth-sorted objects */}
        {objects.map((o) => o.el)}

        {/* department signs (rendered on top, in the clear aisle) */}
        {zones.map((zone: Zone) => {
          const dept = departments[zone.dept];
          const team = deptWorkers(zone.dept);
          const anyActive = team.some((w) => live[w.key]?.status === "working");
          const [lx, ly] = iso((zone.gx0 + zone.gx1 + 1) / 2, zone.gy1 + 1.15);
          return (
            <g key={`sign-${zone.dept}`} transform={`translate(${lx}, ${ly})`} onClick={() => onDeptClick?.(zone.dept)} style={{ cursor: "pointer" }}>
              <rect x={-72} y={-13} width={144} height={22} rx={6} fill="#141728" opacity={0.94} stroke={anyActive ? dept.accent : `${dept.accent}88`} strokeWidth={anyActive ? 2 : 1} />
              <circle cx={-58} cy={-1} r={3.5} fill={dept.accent} className={anyActive ? "led-blink" : undefined} />
              <text x={-48} y={3} fontSize={11} fontWeight={700} fill={dept.accent} fontFamily="ui-sans-serif, system-ui" letterSpacing={0.4}>
                {dept.name.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── color helper ──────────────────────────────────────
function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  let r = parseInt(n.slice(0, 2), 16);
  let g = parseInt(n.slice(2, 4), 16);
  let b = parseInt(n.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  r = f(r);
  g = f(g);
  b = f(b);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
