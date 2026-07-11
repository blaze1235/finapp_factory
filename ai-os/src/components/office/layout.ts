import type { DeptKey } from "@/server/office/registry";

// ── Isometric geometry ────────────────────────────────
export const TW = 58; // tile width
export const TH = 30; // tile height (2:1-ish iso)
export const OX = 452; // screen origin x
export const OY = 150; // screen origin y
export const BOARD_W = 980;
export const BOARD_H = 640;

/** Grid → screen. z is in pixels (height above the floor). */
export function iso(gx: number, gy: number, z = 0): [number, number] {
  return [OX + (gx - gy) * (TW / 2), OY + (gx + gy) * (TH / 2) - z];
}

/** Floor extent in tiles. */
export const FLOOR = { gx0: 0, gy0: 0, gx1: 17, gy1: 13 };

export interface Zone {
  dept: DeptKey;
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
  /** desk anchor cells (person tile) */
  slots: [number, number][];
}

// four team zones in a 2×2 grid with a cross-shaped walkway between them
export const zones: Zone[] = [
  { dept: "marketing", gx0: 1, gy0: 1, gx1: 7, gy1: 5, slots: [[2, 2], [5, 2], [2, 4], [5, 4]] },
  { dept: "blazerent", gx0: 10, gy0: 1, gx1: 16, gy1: 5, slots: [[11, 2], [14, 2], [11, 4], [14, 4]] },
  { dept: "finance", gx0: 1, gy0: 8, gx1: 7, gy1: 12, slots: [[2, 9], [5, 9], [2, 11], [5, 11]] },
  { dept: "brain", gx0: 10, gy0: 8, gx1: 16, gy1: 12, slots: [[11, 9], [14, 9], [11, 11], [14, 11]] },
];
