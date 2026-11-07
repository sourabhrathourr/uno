import { useEffect, useMemo, useRef, useState } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { Vector3 } from "three"

import { controls, movementInput } from "../controls"
import { ROOM, SPAWN, TABLE } from "../layout"
import { lounge } from "../lounge-store"
import { JUMP_SPEED, RUN_SPEED, WALK_SPEED, stepBody } from "../physics"
import { Avatar, lookForPlayer } from "./avatar"
import { seatFor } from "./table"
import type { Body } from "../physics"
import type { RemoteAvatar } from "../presence"
import type { RoomSnapshot, WorldAvatarState } from "@workspace/game"

export type PlayerExtras = {
  bubbles: Record<string, string>
  speaking: Record<string, boolean>
}

/** How close you must be to your chair to sit with E. */
export const SIT_RANGE = 2.4

type LocalProps = {
  room: RoomSnapshot
  selfId: string
  seated: boolean
  /** Seated and playing on the 3D table: the camera becomes your eyes. */
  firstPerson: boolean
  /** Whose seat the first-person camera sits at (yours, or who you watch). */
  viewSeatId: string
  extras: PlayerExtras
  publish: (state: WorldAvatarState) => void
  /** Written every frame so the overlay can show prompts. */
  status: { current: { nearSeat: boolean; dancing: boolean } }
}

const lookTarget = new Vector3()
const desired = new Vector3()
const smoothLook = new Vector3(0, 1, 0)

export function LocalPlayer({
  room,
  selfId,
  seated,
  firstPerson,
  viewSeatId,
  extras,
  publish,
  status,
}: LocalProps) {
  const { camera } = useThree()
  const body = useRef<Body>({
    x: SPAWN.x,
    y: 0,
    z: SPAWN.z,
    vy: 0,
    grounded: true,
  })
  const state = useRef<WorldAvatarState>({
    x: SPAWN.x,
    y: 0,
    z: SPAWN.z,
    heading: SPAWN.heading,
    animation: "idle",
    dance: 0,
  })
  const view = useRef({ yaw: 0, pitch: 0.32, distance: 4.6 })
  const dancing = useRef<number | null>(null)
  const wasSeated = useRef(seated)
  const seat = seatFor(room, selfId)
  const viewSeat = seatFor(room, viewSeatId) ?? seat
  const watching = viewSeatId !== selfId

  useEffect(() => {
    camera.position.set(SPAWN.x, 2.6, SPAWN.z + 5)
  }, [camera])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = state.current
    const b = body.current
    const v = view.current

    // Look and zoom input applies whether seated or not.
    v.yaw -= controls.look.x * 0.0055
    v.pitch = Math.min(1.25, Math.max(0.05, v.pitch + controls.look.y * 0.0045))
    v.distance = Math.min(10, Math.max(2.2, v.distance + controls.zoom * 0.004))
    controls.look.x = 0
    controls.look.y = 0
    controls.zoom = 0

    if (seated && seat) {
      b.x = seat.x
      b.z = seat.z
      b.y = 0
      b.vy = 0
      s.x = seat.x
      s.y = 0
      s.z = seat.z
      s.heading = seat.heading
      s.animation = "sit"
      dancing.current = null
      wasSeated.current = true
      controls.jump = false
      controls.dance = null
      const eye = firstPerson && viewSeat ? viewSeat : seat
      const out = { x: Math.sin(eye.heading), z: Math.cos(eye.heading) }
      if (firstPerson) {
        // Your eyes, leaning in a little, glancing where the mouse is. When
        // watching someone, you look over their shoulder instead.
        const side = { x: out.z, z: -out.x }
        const glanceX = controls.pointer.x * 0.55
        const glanceY = controls.pointer.y * 0.25
        if (watching)
          desired.set(eye.x - out.x * 0.45, 1.72, eye.z - out.z * 0.45)
        else desired.set(eye.x + out.x * 0.28, 1.36, eye.z + out.z * 0.28)
        lookTarget.set(
          TABLE.x - out.x * 0.15 - side.x * glanceX,
          TABLE.height - 0.05 + glanceY,
          TABLE.z - out.z * 0.15 - side.z * glanceX
        )
      } else {
        // Over the shoulder, looking across the table.
        desired.set(eye.x - out.x * 1.35, 2.05, eye.z - out.z * 1.35)
        lookTarget.set(
          TABLE.x + out.x * 0.2,
          TABLE.height + 0.1,
          TABLE.z + out.z * 0.2
        )
      }
      camera.position.lerp(desired, 1 - Math.exp(-dt * 5))
      smoothLook.lerp(lookTarget, 1 - Math.exp(-dt * 6))
      camera.lookAt(smoothLook)
      status.current.nearSeat = true
      status.current.dancing = false
      publish({ ...s })
      return
    }

    if (wasSeated.current && seat) {
      // Stand up behind the chair, facing away from the table.
      wasSeated.current = false
      const out = { x: Math.sin(seat.heading), z: Math.cos(seat.heading) }
      b.x = seat.x - out.x * 0.75
      b.z = seat.z - out.z * 0.75
      // Still facing the table, camera behind you.
      s.heading = seat.heading
      v.yaw = seat.heading + Math.PI
    }

    const input = movementInput()
    const moving = Math.hypot(input.forward, input.right) > 0.08
    const speed = input.run ? RUN_SPEED : WALK_SPEED
    const forward = { x: -Math.sin(v.yaw), z: -Math.cos(v.yaw) }
    const right = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) }
    const mx = (forward.x * input.forward + right.x * input.right) * speed * dt
    const mz = (forward.z * input.forward + right.z * input.right) * speed * dt

    if (controls.jump) {
      controls.jump = false
      if (b.grounded) {
        b.vy = JUMP_SPEED
        b.grounded = false
      }
    }
    if (controls.dance !== null) {
      dancing.current =
        dancing.current === controls.dance ? null : controls.dance
      controls.dance = null
    }
    if (moving) dancing.current = null

    const next = stepBody(b, mx, mz, dt)
    body.current = next

    if (moving) {
      const targetHeading = Math.atan2(mx, mz)
      let delta = targetHeading - s.heading
      delta = Math.atan2(Math.sin(delta), Math.cos(delta))
      s.heading += delta * (1 - Math.exp(-dt * 14))
    }
    s.x = next.x
    s.y = next.y
    s.z = next.z
    s.animation = !next.grounded
      ? "jump"
      : moving
        ? input.run
          ? "run"
          : "walk"
        : dancing.current !== null
          ? "dance"
          : "idle"
    s.dance = dancing.current ?? 0

    const nearSeat = seat
      ? Math.hypot(seat.x - s.x, seat.z - s.z) < SIT_RANGE
      : false
    status.current.nearSeat = nearSeat
    status.current.dancing = dancing.current !== null
    if (controls.interact) {
      controls.interact = false
      if (nearSeat) lounge.sit()
    }

    // Third-person camera, kept inside the room.
    lookTarget.set(s.x, s.y + 1.35, s.z)
    const flat = Math.cos(v.pitch) * v.distance
    desired.set(
      lookTarget.x + Math.sin(v.yaw) * flat,
      lookTarget.y + Math.sin(v.pitch) * v.distance,
      lookTarget.z + Math.cos(v.yaw) * flat
    )
    const margin = 0.4
    desired.x = Math.min(
      ROOM.halfWidth - margin,
      Math.max(-ROOM.halfWidth + margin, desired.x)
    )
    desired.z = Math.min(
      ROOM.halfDepth - margin,
      Math.max(-ROOM.halfDepth + margin, desired.z)
    )
    desired.y = Math.min(ROOM.height - 0.4, Math.max(0.4, desired.y))
    camera.position.lerp(desired, 1 - Math.exp(-dt * 10))
    camera.lookAt(lookTarget)
    smoothLook.copy(lookTarget)

    publish({ ...s })
  })

  const game = room.game
  const gameState = game?.players.find((player) => player.playerId === selfId)
  // In first person at your own seat you are the camera; others still see
  // you sitting. Watching someone else, your avatar stays in your chair.
  if (firstPerson && !watching) return null
  return (
    <Avatar
      state={state}
      look={lookForPlayer(selfId)}
      name={undefined}
      speaking={extras.speaking[selfId]}
      crowned={room.crownPlayerId === selfId}
      bubble={extras.bubbles[selfId] ?? null}
      badge={badgeFor(gameState)}
    />
  )
}

function badgeFor(
  state: NonNullable<RoomSnapshot["game"]>["players"][number] | undefined
): string | null {
  if (!state) return null
  if (state.winnerPlacement)
    return state.winnerPlacement.position === 1
      ? "🏆"
      : `#${state.winnerPlacement.position}`
  if (state.declaredUno && state.handCount === 1) return "UNO!"
  return null
}

type OthersProps = {
  room: RoomSnapshot
  selfId: string
  ids: Array<string>
  remotes: { current: Map<string, RemoteAvatar> }
  extras: PlayerExtras
}

/**
 * Everyone else: lounge players where they say they are, and players still
 * in the classic view sitting in their chairs, since that's where they are.
 */
export function OtherPlayers({
  room,
  selfId,
  ids,
  remotes,
  extras,
}: OthersProps) {
  const inWorld = new Set(ids)
  return (
    <>
      {room.players.map((player) => {
        if (player.id === selfId) return null
        const gameState = room.game?.players.find(
          (p) => p.playerId === player.id
        )
        const common = {
          look: lookForPlayer(player.id),
          name: player.name,
          speaking: extras.speaking[player.id],
          crowned: room.crownPlayerId === player.id,
          bubble: extras.bubbles[player.id] ?? null,
          badge: badgeFor(gameState),
        }
        if (inWorld.has(player.id))
          return (
            <RemotePlayer
              key={player.id}
              id={player.id}
              remotes={remotes}
              {...common}
            />
          )
        if (!player.connected) return null
        const seat = seatFor(room, player.id)
        if (!seat) return null
        return <SeatedGhost key={player.id} seat={seat} {...common} />
      })}
    </>
  )
}

type AvatarCommon = Omit<Parameters<typeof Avatar>[0], "state" | "smooth">

function RemotePlayer({
  id,
  remotes,
  ...common
}: {
  id: string
  remotes: { current: Map<string, RemoteAvatar> }
} & AvatarCommon) {
  const fallback = useRef<WorldAvatarState>({
    x: SPAWN.x,
    y: 0,
    z: SPAWN.z,
    heading: 0,
    animation: "idle",
    dance: 0,
  })
  const state = useMemo(
    () => ({
      get current() {
        const target = remotes.current.get(id)?.target
        if (target) fallback.current = target
        return fallback.current
      },
    }),
    [id, remotes]
  )
  return <Avatar state={state} smooth {...common} />
}

function SeatedGhost({
  seat,
  ...common
}: { seat: { x: number; z: number; heading: number } } & AvatarCommon) {
  const state = useRef<WorldAvatarState>({
    x: seat.x,
    y: 0,
    z: seat.z,
    heading: seat.heading,
    animation: "sit",
    dance: 0,
  })
  state.current = {
    ...state.current,
    x: seat.x,
    z: seat.z,
    heading: seat.heading,
  }
  return <Avatar state={state} smooth {...common} />
}

/** Latest public chat line per player, for a few seconds after it's sent. */
export function useChatBubbles(room: RoomSnapshot) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return useMemo(() => {
    const bubbles: Record<string, string> = {}
    for (const message of room.chatMessages) {
      if (message.channel !== "public") continue
      const age = now - Date.parse(message.createdAt)
      if (age > 7_000 || age < -5_000) continue
      const text = message.kind === "gif" ? "🎞️ GIF" : message.body.trim()
      if (text) bubbles[message.playerId] = text
    }
    return bubbles
  }, [room.chatMessages, now])
}
