import { BOXES, CIRCLES, ROOM } from "./layout"
import type { Box, Circle } from "./layout"

export const PLAYER_RADIUS = 0.34
/** Ledges up to this tall are stepped onto without jumping. */
export const STEP_HEIGHT = 0.38
export const GRAVITY = 15
export const JUMP_SPEED = 5.6
export const WALK_SPEED = 3.3
export const RUN_SPEED = 6.2

export type Body = {
  x: number
  y: number
  z: number
  vy: number
  grounded: boolean
}

export type Colliders = { boxes: Array<Box>; circles: Array<Circle> }

const WORLD: Colliders = { boxes: BOXES, circles: CIRCLES }

/**
 * Moves a body by a horizontal step plus gravity, sliding along anything it
 * can't climb. Anything with its top below the feet plus a step is floor.
 */
export function stepBody(
  body: Body,
  moveX: number,
  moveZ: number,
  dt: number,
  colliders: Colliders = WORLD
): Body {
  let { x, z, y, vy } = body
  x += moveX
  z += moveZ

  // Push out of anything too tall to stand on, a few passes for corners.
  for (let pass = 0; pass < 3; pass++) {
    for (const box of colliders.boxes) {
      if (box.top <= y + STEP_HEIGHT) continue
      const pushed = pushOutOfBox(x, z, box)
      if (pushed) {
        x = pushed.x
        z = pushed.z
      }
    }
    for (const circle of colliders.circles) {
      if (circle.top <= y + STEP_HEIGHT) continue
      const dx = x - circle.x
      const dz = z - circle.z
      const distance = Math.hypot(dx, dz)
      const min = circle.radius + PLAYER_RADIUS
      if (distance < min) {
        const nx = distance > 1e-4 ? dx / distance : 0
        const nz = distance > 1e-4 ? dz / distance : 1
        x = circle.x + nx * min
        z = circle.z + nz * min
      }
    }
  }

  const limitX = ROOM.halfWidth - PLAYER_RADIUS
  const limitZ = ROOM.halfDepth - PLAYER_RADIUS
  x = Math.min(limitX, Math.max(-limitX, x))
  z = Math.min(limitZ, Math.max(-limitZ, z))

  const ground = groundHeight(x, z, y, colliders)
  vy -= GRAVITY * dt
  y += vy * dt
  let grounded = false
  if (y <= ground) {
    // Snap up small steps; fall onto anything below.
    y = ground
    vy = 0
    grounded = true
  } else if (body.grounded && vy <= 0 && y - ground < STEP_HEIGHT * 0.6) {
    // Walking off a low ledge (stage step): stick to the floor below.
    y = ground
    vy = 0
    grounded = true
  }
  return { x, y, z, vy, grounded }
}

export function groundHeight(
  x: number,
  z: number,
  feet: number,
  colliders: Colliders = WORLD
) {
  let ground = 0
  for (const box of colliders.boxes) {
    if (box.top > feet + STEP_HEIGHT) continue
    if (box.top <= ground) continue
    if (circleOverlapsBox(x, z, PLAYER_RADIUS * 0.6, box)) ground = box.top
  }
  for (const circle of colliders.circles) {
    if (circle.top > feet + STEP_HEIGHT || circle.top <= ground) continue
    if (Math.hypot(x - circle.x, z - circle.z) < circle.radius)
      ground = circle.top
  }
  return ground
}

function circleOverlapsBox(x: number, z: number, radius: number, box: Box) {
  const cx = Math.min(box.maxX, Math.max(box.minX, x))
  const cz = Math.min(box.maxZ, Math.max(box.minZ, z))
  return (x - cx) ** 2 + (z - cz) ** 2 < radius * radius
}

function pushOutOfBox(x: number, z: number, box: Box) {
  const cx = Math.min(box.maxX, Math.max(box.minX, x))
  const cz = Math.min(box.maxZ, Math.max(box.minZ, z))
  const dx = x - cx
  const dz = z - cz
  const distanceSq = dx * dx + dz * dz
  if (distanceSq >= PLAYER_RADIUS * PLAYER_RADIUS) return null
  if (distanceSq > 1e-8) {
    const distance = Math.sqrt(distanceSq)
    return {
      x: cx + (dx / distance) * PLAYER_RADIUS,
      z: cz + (dz / distance) * PLAYER_RADIUS,
    }
  }
  // Centre is inside the box: leave by the nearest face.
  const exits = [
    { d: x - box.minX, x: box.minX - PLAYER_RADIUS, z },
    { d: box.maxX - x, x: box.maxX + PLAYER_RADIUS, z },
    { d: z - box.minZ, x, z: box.minZ - PLAYER_RADIUS },
    { d: box.maxZ - z, x, z: box.maxZ + PLAYER_RADIUS },
  ]
  exits.sort((a, b) => a.d - b.d)
  return { x: exits[0].x, z: exits[0].z }
}
