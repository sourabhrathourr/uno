import { Euler, Quaternion, Vector3 } from "three"
import type { Object3D } from "three"
import type { Card } from "@workspace/game"

/**
 * Cards in the air between your hand and the pile. A throw starts the
 * moment you let go, before the server answers; when the play comes back
 * the pile picks the same flight up where it is, so the card never blinks.
 */

export type Launch = {
  card: Card
  position: Vector3
  quaternion: Quaternion
  /** World width of the card when it left the hand. */
  width: number
  /** performance.now() at release; the flight's clock starts here. */
  at: number
}

export const FLIGHT_MS = 520
/** A throw the server never confirms is dropped after this long. */
const LAUNCH_TTL_MS = 2_500

const held = new Map<string, Object3D>()
const launches = new Map<string, Launch>()
const listeners = new Set<() => void>()
let snapshot: Array<Launch> = []

function emit() {
  snapshot = [...launches.values()]
  for (const listener of listeners) listener()
}

/** Held cards register their mesh so a throw knows where they were. */
export function registerHeld(cardId: string, object: Object3D | null) {
  if (object) held.set(cardId, object)
  else held.delete(cardId)
}

export function launchCards(cards: Array<Card>) {
  const now = performance.now()
  for (const card of cards) {
    const object = held.get(card.id)
    if (!object) continue
    object.updateWorldMatrix(true, false)
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    object.matrixWorld.decompose(position, quaternion, scale)
    const width =
      ((object.userData.cardWidth as number | undefined) ?? 0.17) * scale.x
    launches.set(card.id, { card, position, quaternion, width, at: now })
  }
  emit()
  window.setTimeout(() => {
    let changed = false
    for (const [id, launch] of launches)
      if (performance.now() - launch.at > LAUNCH_TTL_MS) {
        launches.delete(id)
        changed = true
      }
    if (changed) emit()
  }, LAUNCH_TTL_MS + 50)
}

/** A throw the server turned down: the card goes back to the hand. */
export function cancelLaunches(cardIds: Array<string>) {
  let changed = false
  for (const id of cardIds) changed = launches.delete(id) || changed
  if (changed) emit()
}

/** The pile takes over a confirmed throw; returns it if there was one. */
export function claimLaunch(cardId: string): Launch | null {
  const launch = launches.get(cardId) ?? null
  if (launch) {
    launches.delete(cardId)
    emit()
  }
  return launch
}

export const launchStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => snapshot,
}

const up = new Vector3(0, 1, 0)
const flat = new Quaternion()
const scratchEuler = new Euler()

/** Face up on the table, turned by `spin` around the vertical. */
export function restingQuaternion(spin: number, out = new Quaternion()) {
  scratchEuler.set(-Math.PI / 2, 0, spin)
  return out.setFromEuler(scratchEuler)
}

/**
 * Where a card is `elapsed` ms into a flight: an eased arc from `from` to
 * `to`, turning from how it was held to lying flat.
 */
export function flightPose(
  from: { position: Vector3; quaternion: Quaternion },
  to: Vector3,
  spin: number,
  elapsed: number,
  outPosition: Vector3,
  outQuaternion: Quaternion
) {
  const t = Math.min(1, Math.max(0, elapsed / FLIGHT_MS))
  const ease = 1 - Math.pow(1 - t, 3)
  outPosition.lerpVectors(from.position, to, ease)
  outPosition.addScaledVector(up, Math.sin(t * Math.PI) * 0.22)
  restingQuaternion(spin, flat)
  outQuaternion.slerpQuaternions(
    from.quaternion,
    flat,
    Math.min(1, ease * 1.15)
  )
  return t >= 1
}

/**
 * Cards moving from your hand into the staging tray. Kept apart from throws
 * so a card staged now and played later flies from the tray, not the hand.
 */
const staged = new Map<string, Launch>()

export function launchToStage(cards: Array<Card>) {
  const now = performance.now()
  for (const card of cards) {
    const object = held.get(card.id)
    if (!object) continue
    object.updateWorldMatrix(true, false)
    const position = new Vector3()
    const quaternion = new Quaternion()
    const scale = new Vector3()
    object.matrixWorld.decompose(position, quaternion, scale)
    const width =
      ((object.userData.cardWidth as number | undefined) ?? 0.17) * scale.x
    staged.set(card.id, { card, position, quaternion, width, at: now })
  }
}

export function claimStageLaunch(cardId: string): Launch | null {
  const launch = staged.get(cardId) ?? null
  staged.delete(cardId)
  return launch
}
