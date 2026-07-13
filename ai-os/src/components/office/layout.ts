import type { DeptKey } from "@/server/office/registry";

export const TILE = 20;
export const COLS = 46;
export const ROWS = 40;
export const BOARD_W = COLS * TILE; // 920
export const BOARD_H = ROWS * TILE; // 800

export interface Room {
  dept: DeptKey;
  x: number; // floor tiles
  y: number;
  w: number;
  h: number;
  side: "left" | "right";
  /** desk anchor tiles (agent stands/sits at desk+1 row) */
  desks: [number, number][];
  /** door tile just inside / just outside the room */
  doorIn: [number, number];
  doorOut: [number, number];
}

function leftRoom(dept: DeptKey, y: number): Room {
  return {
    dept,
    x: 1,
    y,
    w: 10,
    h: 6,
    side: "left",
    desks: [
      [2.6, y + 0.7],
      [6.6, y + 0.7],
      [2.6, y + 3.2],
      [6.6, y + 3.2],
    ],
    doorIn: [9.5, y + 3],
    doorOut: [12.5, y + 3],
  };
}

function rightRoom(dept: DeptKey, y: number): Room {
  return {
    dept,
    x: 35,
    y,
    w: 10,
    h: 6,
    side: "right",
    desks: [
      [36.6, y + 0.7],
      [40.6, y + 0.7],
      [36.6, y + 3.2],
      [40.6, y + 3.2],
    ],
    doorIn: [36, y + 3],
    doorOut: [33, y + 3],
  };
}

export const rooms: Room[] = [
  leftRoom("marketing", 1),
  leftRoom("finance", 8.5),
  leftRoom("export", 16),
  leftRoom("finapp", 23.5),
  leftRoom("bika", 31),
  rightRoom("blazerent", 1),
  rightRoom("brain", 8.5),
  rightRoom("finly", 16),
  rightRoom("rnd", 23.5),
];

/** Not a department — the Server Room (project knowledge base) sits opposite Bika, filling
 *  the space the taller left column leaves on the right. Rendered specially in OfficeMap. */
export const SERVER_ROOM = { x: 35, y: 31, w: 10, h: 6 };

export function roomOf(dept: DeptKey): Room {
  return rooms.find((r) => r.dept === dept)!;
}

export function roomAt(x: number, y: number): Room | null {
  return (
    rooms.find((r) => x >= r.x - 0.5 && x <= r.x + r.w + 0.5 && y >= r.y - 0.5 && y <= r.y + r.h + 0.5) ?? null
  );
}

/** hangout spots in the commons (couch seats, coffee, collab chairs, games…) */
export const HANGOUTS: { x: number; y: number; vibe: "coffee" | "couch" | "collab" | "game" | "walk" }[] = [
  { x: 19.5, y: 3.6, vibe: "coffee" },
  { x: 22.5, y: 3.6, vibe: "coffee" },
  { x: 15.2, y: 5.2, vibe: "couch" },
  { x: 16.8, y: 5.2, vibe: "couch" },
  { x: 28.2, y: 5.2, vibe: "couch" },
  { x: 29.8, y: 5.2, vibe: "couch" },
  { x: 18.5, y: 13.2, vibe: "collab" },
  { x: 21.5, y: 13.2, vibe: "collab" },
  { x: 24.5, y: 13.2, vibe: "collab" },
  { x: 18.5, y: 17.0, vibe: "collab" },
  { x: 21.5, y: 17.0, vibe: "collab" },
  { x: 24.5, y: 17.0, vibe: "collab" },
  { x: 16.0, y: 24.6, vibe: "game" },
  { x: 21.6, y: 24.6, vibe: "game" },
  { x: 29.5, y: 23.6, vibe: "walk" },
  { x: 32.6, y: 24.4, vibe: "walk" },
  { x: 14.0, y: 10.0, vibe: "walk" },
  { x: 30.0, y: 10.0, vibe: "walk" },
  { x: 14.5, y: 20.5, vibe: "walk" },
  { x: 30.5, y: 20.5, vibe: "walk" },
];
