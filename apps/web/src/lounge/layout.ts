/**
 * Where everything sits in the lounge, in metres. +z points from the stage
 * toward the entrance; the stage is at the far (-z) end.
 */

export type Box = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** Height of the top surface. Low boxes can be walked or jumped onto. */
  top: number
}

export type Circle = { x: number; z: number; radius: number; top: number }

export const ROOM = { halfWidth: 14, halfDepth: 14, height: 6.5 }

export const STAGE: Box = {
  minX: -6.5,
  maxX: 6.5,
  minZ: -14,
  maxZ: -9,
  top: 0.7,
}
export const STAGE_STEP: Box = {
  minX: -1.6,
  maxX: 1.6,
  minZ: -9,
  maxZ: -8.4,
  top: 0.35,
}
export const DJ_BOOTH: Box = {
  minX: -2.1,
  maxX: 2.1,
  minZ: -11.9,
  maxZ: -10.9,
  top: 1.75,
}
export const DJ_SPOT = { x: 0, z: -12.4 }
export const SPEAKERS: Array<Box> = [
  { minX: -6.4, maxX: -5.2, minZ: -13.6, maxZ: -12.4, top: 3.2 },
  { minX: 5.2, maxX: 6.4, minZ: -13.6, maxZ: -12.4, top: 3.2 },
]
export const DANCE_FLOOR = { minX: -6, maxX: 6, minZ: -8.2, maxZ: -2.4 }

export const TABLE = { x: 0, z: 4.2, radius: 1.55, height: 0.78 }
export const SEAT_RADIUS = 2.3

export const BAR: Box = { minX: 11, maxX: 12.2, minZ: -5, maxZ: 6, top: 1.1 }
export const BAR_BACK: Box = {
  minX: 13.3,
  maxX: 14,
  minZ: -6,
  maxZ: 7,
  top: 2.4,
}

export const COUCHES: Array<Box> = [
  { minX: -13.6, maxX: -12.5, minZ: -3, maxZ: 5, top: 0.48 },
  { minX: -12.5, maxX: -9.6, minZ: 5, maxZ: 6.1, top: 0.48 },
  { minX: -12.5, maxX: -9.6, minZ: -4.1, maxZ: -3, top: 0.48 },
]
export const COFFEE_TABLE: Box = {
  minX: -11.4,
  maxX: -10,
  minZ: -0.2,
  maxZ: 2.2,
  top: 0.42,
}

export const SPAWN = { x: 0, z: 8.4, heading: Math.PI }

export const BOXES: Array<Box> = [
  STAGE,
  STAGE_STEP,
  DJ_BOOTH,
  ...SPEAKERS,
  BAR,
  BAR_BACK,
  ...COUCHES,
  COFFEE_TABLE,
]

export const CIRCLES: Array<Circle> = [
  { x: TABLE.x, z: TABLE.z, radius: TABLE.radius, top: TABLE.height },
]

/**
 * Seat `index` of `total` around the game table. Seat 0 faces the stage from
 * the entrance side, and seats run clockwise seen from above, matching the
 * classic table's turn order.
 */
export function seatPosition(index: number, total: number) {
  const count = Math.max(total, 2)
  const angle = Math.PI / 2 + (index / count) * Math.PI * 2
  const x = TABLE.x + Math.cos(angle) * SEAT_RADIUS
  const z = TABLE.z + Math.sin(angle) * SEAT_RADIUS
  // Facing the table centre.
  const heading = Math.atan2(TABLE.x - x, TABLE.z - z)
  return { x, z, heading, angle }
}

/** A point at `distance` from the table centre toward seat `angle`. */
export function towardSeat(angle: number, distance: number) {
  return {
    x: TABLE.x + Math.cos(angle) * distance,
    z: TABLE.z + Math.sin(angle) * distance,
  }
}
