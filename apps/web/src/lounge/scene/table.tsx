import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useFrame } from "@react-three/fiber"
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Euler,
  FrontSide,
  Quaternion,
  Vector3,
} from "three"

import { TABLE, seatPosition, towardSeat } from "../layout"
import { cardColorHex, cardGlowTexture, labelTexture } from "../textures"
import {
  FLIGHT_MS,
  claimLaunch,
  claimStageLaunch,
  flightPose,
  launchStore,
  registerHeld,
  restingQuaternion,
} from "../flights"
import { hashString } from "../beat"
import { useCardTexture } from "../real-cards"
import { useBeat } from "./beat-context"
import type { Card, Player, RoomSnapshot } from "@workspace/game"
import type {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Side,
  SpriteMaterial,
} from "three"

// Bigger than life so they read from across the table.
export const CARD_W = 0.21
export const CARD_H = CARD_W * (318 / 224)
const TOP = TABLE.height

/** Players in seat order; their index is their chair around the table. */
export function seatedPlayers(room: RoomSnapshot): Array<Player> {
  return [...room.players].sort((a, b) => a.seat - b.seat)
}

export function seatFor(room: RoomSnapshot, playerId: string) {
  const players = seatedPlayers(room)
  const index = players.findIndex((player) => player.id === playerId)
  if (index < 0) return null
  return { index, ...seatPosition(index, players.length) }
}

export type TableControls = {
  canDraw: boolean
  canPlay: boolean
  onDraw: () => void
  onPlay: () => void
}

type Props = {
  room: RoomSnapshot
  selfId: string
  hand: Array<Card> | null
  /** This player's cards are in the first-person hand, not on the table. */
  heldBy?: string | null
  /** Your picked cards and how to take one back, while you're staging. */
  localStage?: LocalStage | null
  /** The floating status sign; the first-person overlay says it instead. */
  showSign?: boolean
  controls?: TableControls | null
}

export function GameTable3D({
  room,
  selfId,
  hand,
  heldBy = null,
  localStage = null,
  showSign = true,
  controls = null,
}: Props) {
  const players = seatedPlayers(room)
  const game = room.game
  return (
    <group>
      <TableBody />
      {players.map((player, index) => (
        <Chair
          key={player.id}
          index={index}
          total={players.length}
          isTurn={game?.turnPlayerId === player.id}
          color={game?.currentColor ?? null}
        />
      ))}
      {game && room.status !== "lobby" && (
        <>
          <ColorRing color={game.currentColor} direction={game.direction} />
          <DrawPile count={game.drawPileCount} controls={controls} />
          <DiscardPile room={room} />
          <StagingTray room={room} selfId={selfId} local={localStage} />
          {controls && <PlayTarget controls={controls} />}
          <DrawFlights room={room} />
          {players.map((player, index) => {
            const state = game.players.find((p) => p.playerId === player.id)
            if (!state || state.handCount === 0) return null
            const isSelf = player.id === selfId
            if (player.id === heldBy) return null
            return (
              <HandFan
                key={player.id}
                index={index}
                total={players.length}
                count={state.handCount}
                cards={isSelf ? hand : null}
              />
            )
          })}
          <TurnSpot room={room} />
        </>
      )}
      {showSign && <TableSign room={room} selfId={selfId} />}
    </group>
  )
}

function TableBody() {
  return (
    <group position={[TABLE.x, 0, TABLE.z]}>
      <mesh position-y={TOP - 0.035}>
        <cylinderGeometry args={[TABLE.radius, TABLE.radius, 0.07, 64]} />
        <meshStandardMaterial
          color="#5a341d"
          roughness={0.45}
          metalness={0.1}
        />
      </mesh>
      {/* Felt inlay */}
      <mesh position-y={TOP + 0.002} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[TABLE.radius - 0.12, 64]} />
        <meshStandardMaterial color="#123a33" roughness={0.95} />
      </mesh>
      <mesh position-y={TOP - 0.01} rotation-x={Math.PI / 2}>
        <torusGeometry args={[TABLE.radius, 0.045, 12, 64]} />
        <meshStandardMaterial
          color="#3d2212"
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>
      <mesh position-y={TOP / 2}>
        <cylinderGeometry args={[0.12, 0.18, TOP, 16]} />
        <meshStandardMaterial color="#1c1410" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position-y={0.03}>
        <cylinderGeometry args={[0.6, 0.65, 0.06, 32]} />
        <meshStandardMaterial color="#1c1410" roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  )
}

function Chair({
  index,
  total,
  isTurn,
  color,
}: {
  index: number
  total: number
  isTurn: boolean
  color: string | null
}) {
  const seat = seatPosition(index, total)
  const glow = useRef<MeshBasicMaterial>(null)
  const tint = useMemo(
    () => new Color(color ? cardColorHex(color as Card["color"]) : "#ffffff"),
    [color]
  )
  useFrame(({ clock }) => {
    if (!glow.current) return
    glow.current.opacity = isTurn
      ? 0.55 + Math.sin(clock.elapsedTime * 4) * 0.25
      : 0
    glow.current.color.copy(tint).multiplyScalar(2)
  })
  // Chairs sit a little behind where the avatar's hips go.
  const back = {
    x: Math.sin(seat.heading) * -0.22,
    z: Math.cos(seat.heading) * -0.22,
  }
  return (
    <group position={[seat.x, 0, seat.z]} rotation-y={seat.heading}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <ringGeometry args={[0.45, 0.62, 40]} />
        <meshBasicMaterial
          ref={glow}
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <group position={[back.x * 0, 0, -0.08]}>
        <mesh position-y={0.44}>
          <boxGeometry args={[0.52, 0.07, 0.5]} />
          <meshStandardMaterial color="#6b2a3c" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.82, -0.24]}>
          <boxGeometry args={[0.52, 0.7, 0.07]} />
          <meshStandardMaterial color="#6b2a3c" roughness={0.7} />
        </mesh>
        {[
          [-0.22, -0.2],
          [0.22, -0.2],
          [-0.22, 0.2],
          [0.22, 0.2],
        ].map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.2, z]}>
            <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
            <meshStandardMaterial
              color="#222"
              metalness={0.8}
              roughness={0.3}
            />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function ColorRing({ color, direction }: { color: string; direction: 1 | -1 }) {
  const ring = useRef<MeshStandardMaterial>(null)
  const arrows = useRef<Group>(null)
  const beat = useBeat()
  const tint = useMemo(
    () => new Color(cardColorHex(color as Card["color"])),
    [color]
  )
  useFrame((_, dt) => {
    if (ring.current) {
      ring.current.emissive.lerp(tint, Math.min(1, dt * 6))
      ring.current.emissiveIntensity = 1.6 + beat.pulse * 0.8 * beat.energy
    }
    // Arrows circle the way play goes: clockwise from above for 1.
    if (arrows.current) arrows.current.rotation.y -= dt * 0.5 * direction
  })
  return (
    <group position={[TABLE.x, TOP + 0.01, TABLE.z]}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.62, 0.66, 64]} />
        <meshStandardMaterial
          ref={ring}
          color="#000"
          emissive={tint}
          toneMapped={false}
        />
      </mesh>
      <group ref={arrows}>
        {Array.from({ length: 6 }, (_, index) => {
          const angle = (index / 6) * Math.PI * 2
          return (
            <mesh
              key={index}
              position={[Math.cos(angle) * 0.82, 0.01, Math.sin(angle) * 0.82]}
              rotation={[
                -Math.PI / 2,
                0,
                -angle + (direction === 1 ? Math.PI : 0),
              ]}
            >
              <coneGeometry args={[0.04, 0.1, 3]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}

function DrawPile({
  count,
  controls,
}: {
  count: number
  controls: TableControls | null
}) {
  const height = Math.max(0.01, Math.min(count, 80) * 0.0016)
  const glow = useRef<MeshBasicMaterial>(null)
  const top = useRef<Group>(null)
  const [hover, setHover] = useState(false)
  const canDraw = Boolean(controls?.canDraw)
  useFrame(({ clock }) => {
    if (glow.current)
      glow.current.opacity = canDraw
        ? (hover ? 0.9 : 0.45) + Math.sin(clock.elapsedTime * 4) * 0.12
        : 0
    if (top.current)
      top.current.position.y +=
        ((hover && canDraw ? 0.03 : 0) - top.current.position.y) * 0.2
  })
  return (
    <group
      position={[TABLE.x - 0.3, TOP, TABLE.z - 0.05]}
      rotation-y={0.08}
      onPointerOver={(event) => {
        if (!controls) return
        event.stopPropagation()
        setHover(true)
        document.body.style.cursor = canDraw ? "pointer" : ""
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ""
      }}
      onClick={(event) => {
        if (!controls?.canDraw) return
        event.stopPropagation()
        controls.onDraw()
      }}
    >
      <mesh position-y={0.002} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[CARD_W * 1.6, CARD_H * 1.45]} />
        <meshBasicMaterial
          ref={glow}
          map={cardGlowTexture()}
          color="#ffe9a8"
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh position-y={height / 2}>
        <boxGeometry args={[CARD_W, height, CARD_H]} />
        <meshStandardMaterial color="#0d0d0d" roughness={0.8} />
      </mesh>
      <group ref={top}>
        <mesh position-y={height + 0.001} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <CardMaterial card={null} side={FrontSide} />
        </mesh>
      </group>
    </group>
  )
}

/** The discard pile as a drop target: glows when your selection can go. */
function PlayTarget({ controls }: { controls: TableControls }) {
  const glow = useRef<MeshBasicMaterial>(null)
  const [hover, setHover] = useState(false)
  useFrame(({ clock }) => {
    if (glow.current)
      glow.current.opacity = controls.canPlay
        ? (hover ? 0.85 : 0.4) + Math.sin(clock.elapsedTime * 5) * 0.12
        : 0
  })
  return (
    <mesh
      position={[DISCARD_X, TOP + 0.002, DISCARD_Z]}
      rotation-x={-Math.PI / 2}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHover(true)
        document.body.style.cursor = controls.canPlay ? "pointer" : ""
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ""
      }}
      onClick={(event) => {
        if (!controls.canPlay) return
        event.stopPropagation()
        controls.onPlay()
      }}
    >
      <circleGeometry args={[0.24, 40]} />
      <meshBasicMaterial
        ref={glow}
        color="#ffffff"
        transparent
        opacity={0}
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  )
}

type Discard = {
  key: string
  card: Card
  from: { position: Vector3; quaternion: Quaternion; width: number }
  spin: number
  offset: [number, number]
  born: number
}

const DISCARD_X = TABLE.x + 0.28
const DISCARD_Z = TABLE.z + 0.02

/** Same scatter for a card wherever it's drawn, so hand-offs never jump. */
function scatter(cardId: string) {
  const value = Math.sin(hashString(cardId) * 0.0001) * 43758.5453
  const random = value - Math.floor(value)
  return {
    spin: (random - 0.5) * 0.9,
    offset: [(random - 0.5) * 0.05, (((random * 7) % 1) - 0.5) * 0.05] as [
      number,
      number,
    ],
  }
}

/** Where a player's cards leave from: their fan at the table edge. */
function fanLaunch(angle: number, heading: number) {
  const spot = towardSeat(angle, TABLE.radius - 0.28)
  return {
    position: new Vector3(spot.x, TOP + 0.12, spot.z),
    quaternion: new Quaternion().setFromEuler(
      new Euler(-0.35, heading + Math.PI, 0, "YXZ")
    ),
    width: CARD_W * 0.85,
  }
}

/**
 * The last few cards on the pile. Every card of a play lands, not just the
 * top one; your own throws carry on from where they left your hand, and
 * other players' cards lift off their fan.
 */
function DiscardPile({ room }: { room: RoomSnapshot }) {
  const game = room.game!
  const top = game.topDiscard
  const [pile, setPile] = useState<Array<Discard>>([])
  const counter = useRef(0)
  const lastEventId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const events = game.events
    const newestId = events[events.length - 1]?.id ?? null
    const firstRun = lastEventId.current === undefined
    const start = firstRun
      ? events.length
      : events.findIndex((event) => event.id === lastEventId.current) + 1
    lastEventId.current = newestId

    // Cards played since we last looked, oldest first, top card last.
    const arriving: Array<{ card: Card; playerId: string | null }> = []
    if (start > 0)
      for (const event of events.slice(start)) {
        if (event.type !== "card-played") continue
        for (const card of event.cards ?? [])
          arriving.push({ card, playerId: event.playerId ?? null })
      }
    if (top) {
      const index = arriving.findIndex((entry) => entry.card.id === top.id)
      const [topEntry] =
        index >= 0
          ? arriving.splice(index, 1)
          : [{ card: top, playerId: null as string | null }]
      arriving.push(topEntry)
    }

    setPile((current) => {
      const shown = new Set(current.map((discard) => discard.card.id))
      const next = [...current]
      arriving.forEach(({ card, playerId }, order) => {
        if (shown.has(card.id)) return
        counter.current += 1
        const { spin, offset } = scatter(card.id)
        const launch = claimLaunch(card.id)
        const seat = playerId ? seatFor(room, playerId) : null
        const resting = {
          position: new Vector3(DISCARD_X, TOP, DISCARD_Z),
          quaternion: restingQuaternion(0),
          width: CARD_W,
        }
        next.push({
          key: `${card.id}:${counter.current}`,
          card,
          from: launch
            ? launch
            : firstRun || !seat
              ? resting
              : fanLaunch(seat.angle, seat.heading),
          spin,
          offset,
          // Group plays land one after another.
          born: launch ? launch.at : performance.now() + order * 90,
        })
      })
      return next.length === current.length ? current : next.slice(-9)
    })
  }, [game.events, top?.id])

  return (
    <group>
      {pile.map((discard, index) => (
        <FlyingDiscard
          key={discard.key}
          discard={discard}
          height={index * 0.0015}
        />
      ))}
      <PendingThrows />
    </group>
  )
}

const pose = { position: new Vector3(), quaternion: new Quaternion() }
const target = new Vector3()

function FlyingDiscard({
  discard,
  height,
}: {
  discard: Discard
  height: number
}) {
  const ref = useRef<Mesh>(null)
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const elapsed = performance.now() - discard.born
    mesh.visible = elapsed >= 0
    target.set(
      DISCARD_X + discard.offset[0],
      TOP + 0.004 + height,
      DISCARD_Z + discard.offset[1]
    )
    flightPose(
      discard.from,
      target,
      discard.spin,
      elapsed,
      pose.position,
      pose.quaternion
    )
    mesh.position.copy(pose.position)
    mesh.quaternion.copy(pose.quaternion)
    const t = Math.min(1, Math.max(0, elapsed / FLIGHT_MS))
    const startScale = discard.from.width / CARD_W
    const scale = startScale + (1 - startScale) * (1 - Math.pow(1 - t, 3))
    mesh.scale.set(scale, scale, 1)
  })
  return (
    <mesh ref={ref} renderOrder={1} visible={false}>
      <planeGeometry args={[CARD_W, CARD_H]} />
      <CardMaterial card={discard.card} />
    </mesh>
  )
}

/**
 * Your throws, flying before the server has confirmed them. The pile takes
 * each one over (same path, same clock) as soon as the play comes back.
 */
function PendingThrows() {
  const launches = useSyncExternalStore(
    launchStore.subscribe,
    launchStore.get,
    launchStore.get
  )
  return (
    <group>
      {launches.map((launch) => (
        <FlyingDiscard
          key={`pending:${launch.card.id}`}
          discard={{
            key: launch.card.id,
            card: launch.card,
            from: launch,
            ...scatter(launch.card.id),
            born: launch.at,
          }}
          height={0.012}
        />
      ))}
    </group>
  )
}

export type LocalStage = {
  /** Your picked cards, in the order picked. */
  cards: Array<Card>
  choices: {
    chosenColor: string | null
    declaredUno: boolean
    swapWithPlayerId: string | null
    rotateHands: boolean
  }
  canEdit: boolean
  onCardClick: (card: Card) => void
}

/**
 * The staging tray, as on the classic table: the cards a player is lining
 * up (yours lift out of your hand into it; tap one to take it back), or the
 * cards a colour roulette is turning over. It sits between the deck and the
 * pile, nudged toward whoever is staging, and turns to face you.
 */
function StagingTray({
  room,
  selfId,
  local,
}: {
  room: RoomSnapshot
  selfId: string
  local: LocalStage | null
}) {
  const game = room.game!
  const roulette =
    game.pendingChoice?.type === "roulette-draw" ? game.pendingChoice : null
  const staged = game.stagedPlay
  const localActive = Boolean(local && local.cards.length > 0)
  const cards = localActive
    ? local!.cards
    : roulette
      ? roulette.drawnCards
      : (staged?.cards ?? [])
  const playerId = localActive
    ? selfId
    : roulette
      ? roulette.playerId
      : (staged?.playerId ?? null)
  const mode: "stage" | "roulette" =
    !localActive && (roulette || staged?.kind === "roulette")
      ? "roulette"
      : "stage"
  const nameOf = (id: string | null | undefined) =>
    id === selfId
      ? "You"
      : (room.players.find((player) => player.id === id)?.name ?? "Someone")

  // What the play will do, so everyone can read it before it lands.
  const choices = localActive
    ? local!.choices
    : {
        chosenColor: staged?.chosenColor ?? null,
        declaredUno: Boolean(staged?.declaredUno),
        swapWithPlayerId: staged?.swapWithPlayerId ?? null,
        rotateHands: Boolean(staged?.rotateHands),
      }
  const extras = [
    choices.chosenColor,
    choices.declaredUno ? "UNO!" : null,
    choices.swapWithPlayerId
      ? `swap with ${nameOf(choices.swapWithPlayerId)}`
      : null,
    choices.rotateHands ? "rotate hands" : null,
  ].filter(Boolean)
  const count = cards.length
  const title =
    mode === "roulette"
      ? `${nameOf(playerId)} picking up ${count} card${count === 1 ? "" : "s"}${
          roulette ? ` until ${roulette.color}` : ""
        }`
      : `${nameOf(playerId)} staged ${count} card${count === 1 ? "" : "s"}${
          extras.length ? ` · ${extras.join(" · ")}` : ""
        }`
  const label = useMemo(
    () =>
      labelTexture(title, {
        size: 38,
        background:
          mode === "roulette" ? "rgba(120,80,10,0.85)" : "rgba(10,9,8,0.8)",
      }),
    [title, mode]
  )

  const seat = playerId ? seatFor(room, playerId) : null
  const center = seat
    ? towardSeat(seat.angle, 0.46)
    : { x: TABLE.x, z: TABLE.z + 0.3 }
  const group = useRef<Group>(null)
  useFrame(({ camera }) => {
    if (!group.current) return
    // Turn the tray to whoever is looking, so the cards read upright.
    group.current.rotation.y = Math.atan2(
      camera.position.x - group.current.position.x,
      camera.position.z - group.current.position.z
    )
  })
  if (count === 0) return null

  const cardW = CARD_W * 0.78
  const shown = cards.slice(-12)
  const step = Math.min(cardW * 0.72, 0.85 / shown.length)
  const trayW = Math.max(cardW * 1.6, cardW + (shown.length - 1) * step + 0.1)
  const editable = Boolean(localActive && local!.canEdit)
  return (
    <group ref={group} position={[center.x, TOP, center.z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.003}>
        <planeGeometry args={[trayW, CARD_H * 0.95]} />
        <meshBasicMaterial
          color={mode === "roulette" ? "#3a2a08" : "#08100e"}
          transparent
          opacity={0.7}
          depthWrite={false}
        />
      </mesh>
      {shown.map((card, index) => (
        <TrayCard
          key={card.id}
          card={card}
          x={(index - (shown.length - 1) / 2) * step}
          order={index}
          width={cardW}
          editable={editable}
          own={localActive}
          onClick={() => local?.onCardClick(card)}
        />
      ))}
      <sprite
        position={[0, CARD_H * 0.95, -0.04]}
        scale={[0.075 * label.aspect, 0.075, 1]}
        renderOrder={6}
      >
        <spriteMaterial
          map={label.texture}
          transparent
          depthWrite={false}
          depthTest={false}
        />
      </sprite>
    </group>
  )
}

const trayFrom = { position: new Vector3(), quaternion: new Quaternion() }
const trayInverse = new Quaternion()

function TrayCard({
  card,
  x,
  order,
  width,
  editable,
  own,
  onClick,
}: {
  card: Card
  x: number
  order: number
  width: number
  editable: boolean
  own: boolean
  onClick: () => void
}) {
  const ref = useRef<Mesh>(null)
  const start = useRef<{
    position: Vector3
    quaternion: Quaternion
    scale: number
    at: number
  } | null>(null)
  const [hover, setHover] = useState(false)
  const height = width * (CARD_H / CARD_W)
  // Propped up toward the viewer so faces read from a chair.
  const rest = useMemo(
    () =>
      new Quaternion().setFromEuler(
        new Euler(-Math.PI / 2 + 0.95, 0, -x * 0.5)
      ),
    [x]
  )

  useFrame(() => {
    const mesh = ref.current
    if (!mesh?.parent) return
    if (!start.current) {
      // Fly in from where it left your hand, or rise from the felt.
      const launch = own ? claimStageLaunch(card.id) : null
      mesh.parent.updateWorldMatrix(true, false)
      if (launch) {
        trayFrom.position.copy(launch.position)
        mesh.parent.worldToLocal(trayFrom.position)
        mesh.parent.getWorldQuaternion(trayInverse).invert()
        start.current = {
          position: trayFrom.position.clone(),
          quaternion: trayInverse.clone().multiply(launch.quaternion),
          scale: launch.width / width,
          at: performance.now(),
        }
      } else {
        start.current = {
          position: new Vector3(x, -0.05, 0),
          quaternion: rest.clone(),
          scale: 0.6,
          at: performance.now(),
        }
      }
    }
    const from = start.current
    const t = Math.min(1, (performance.now() - from.at) / 340)
    const ease = 1 - Math.pow(1 - t, 3)
    const lift = hover && editable ? 0.03 : 0
    mesh.position.set(
      from.position.x + (x - from.position.x) * ease,
      from.position.y +
        (height * 0.42 + lift + order * 0.0015 - from.position.y) * ease,
      from.position.z + (order * 0.002 - from.position.z) * ease
    )
    mesh.quaternion.slerpQuaternions(from.quaternion, rest, ease)
    const scale = from.scale + (1 - from.scale) * ease
    mesh.scale.set(scale, scale, 1)
  })

  return (
    <mesh
      ref={(object) => {
        ref.current = object
        // Your staged cards fly to the pile from here when played.
        if (own) registerHeld(card.id, object)
        if (object) object.userData.cardWidth = width
      }}
      renderOrder={4 + order}
      onPointerOver={(event) => {
        if (!editable) return
        event.stopPropagation()
        setHover(true)
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ""
      }}
      onClick={(event) => {
        if (!editable) return
        event.stopPropagation()
        onClick()
      }}
    >
      <planeGeometry args={[width, height]} />
      <CardMaterial card={card} brightness={hover && editable ? 0.95 : 0.88} />
    </mesh>
  )
}

/** Card backs flying from the draw pile to whoever drew. */
function DrawFlights({ room }: { room: RoomSnapshot }) {
  const game = room.game!
  const seen = useRef<string | null>(null)
  const [flights, setFlights] = useState<
    Array<{ key: string; to: { x: number; z: number }; born: number }>
  >([])

  useEffect(() => {
    const events = game.events
    const lastId = events[events.length - 1]?.id ?? null
    if (seen.current === null) {
      seen.current = lastId
      return
    }
    const start = events.findIndex((event) => event.id === seen.current) + 1
    seen.current = lastId
    if (start <= 0) return
    const next: Array<{
      key: string
      to: { x: number; z: number }
      born: number
    }> = []
    for (const event of events.slice(start)) {
      if (event.type !== "card-drawn" && event.type !== "draw-penalty") continue
      if (!event.playerId) continue
      const seat = seatFor(room, event.playerId)
      if (!seat) continue
      const count = Math.min(event.cardCount ?? 1, 5)
      for (let index = 0; index < count; index++)
        next.push({
          key: `${event.id}:${index}`,
          to: towardSeat(seat.angle, 1.2),
          born: performance.now() + index * 90,
        })
    }
    if (next.length) setFlights((current) => [...current, ...next].slice(-16))
  }, [game.events])

  useEffect(() => {
    if (flights.length === 0) return
    const timer = window.setTimeout(
      () =>
        setFlights((current) =>
          current.filter((flight) => performance.now() - flight.born < 700)
        ),
      900
    )
    return () => window.clearTimeout(timer)
  }, [flights])

  return (
    <group>
      {flights.map((flight) => (
        <DrawFlight key={flight.key} to={flight.to} born={flight.born} />
      ))}
    </group>
  )
}

function DrawFlight({
  to,
  born,
}: {
  to: { x: number; z: number }
  born: number
}) {
  const ref = useRef<Mesh>(null)
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const t = Math.max(0, Math.min(1, (performance.now() - born) / 520))
    mesh.visible = t > 0 && t < 1
    const ease = 1 - Math.pow(1 - t, 2)
    const fromX = TABLE.x - 0.3
    const fromZ = TABLE.z - 0.05
    mesh.position.set(
      fromX + (to.x - fromX) * ease,
      TOP + 0.15 + Math.sin(t * Math.PI) * 0.4,
      fromZ + (to.z - fromZ) * ease
    )
    mesh.rotation.set(-Math.PI / 2 + t * 0.6, 0, t * 4)
  })
  return (
    <mesh ref={ref} visible={false}>
      <planeGeometry args={[CARD_W, CARD_H]} />
      <CardMaterial card={null} />
    </mesh>
  )
}

/**
 * A player's cards, fanned at the table edge in front of their chair. Your
 * own fan shows your real cards; everyone else's shows backs.
 */
function HandFan({
  index,
  total,
  count,
  cards,
}: {
  index: number
  total: number
  count: number
  cards: Array<Card> | null
}) {
  const seat = seatPosition(index, total)
  const spot = towardSeat(seat.angle, TABLE.radius - 0.28)
  const shown = Math.min(count, 14)
  const spread = Math.min(0.13, 1.1 / Math.max(shown, 1))
  const countLabel = useMemo(
    () =>
      count > shown || count >= 8
        ? labelTexture(String(count), { size: 40 })
        : null,
    [count, shown]
  )
  return (
    <group
      position={[spot.x, TOP + 0.1, spot.z]}
      rotation-y={seat.heading + Math.PI}
    >
      {Array.from({ length: shown }, (_, cardIndex) => {
        const offset = cardIndex - (shown - 1) / 2
        const card = cards?.[cardIndex]
        return (
          <mesh
            key={cardIndex}
            position={[
              offset * spread * 0.9,
              Math.abs(offset) * -0.006,
              -Math.abs(offset) * 0.004,
            ]}
            rotation={[-0.35, 0, -offset * 0.08]}
          >
            <planeGeometry args={[CARD_W * 0.85, CARD_H * 0.85]} />
            <CardMaterial card={card ?? null} />
          </mesh>
        )
      })}
      {countLabel && (
        <sprite
          position={[0, 0.2, 0]}
          scale={[0.12 * countLabel.aspect, 0.12, 1]}
        >
          <spriteMaterial
            map={countLabel.texture}
            transparent
            depthWrite={false}
          />
        </sprite>
      )}
    </group>
  )
}

/** A soft pool of light from the ceiling on whoever's turn it is. */
function TurnSpot({ room }: { room: RoomSnapshot }) {
  const turnId = room.game?.turnPlayerId ?? null
  const seat = turnId ? seatFor(room, turnId) : null
  const group = useRef<Group>(null)
  const cone = useRef<MeshBasicMaterial>(null)
  const tint = useMemo(
    () =>
      new Color(
        cardColorHex((room.game?.currentColor ?? "yellow") as Card["color"])
      ),
    [room.game?.currentColor]
  )
  useFrame(({ clock, camera }, dt) => {
    if (!group.current || !seat) return
    const k = 1 - Math.exp(-dt * 6)
    group.current.position.x += (seat.x - group.current.position.x) * k
    group.current.position.z += (seat.z - group.current.position.z) * k
    if (cone.current) {
      // Soft from across the room; gone when the camera is right inside it.
      const dx = camera.position.x - group.current.position.x
      const dz = camera.position.z - group.current.position.z
      const near = Math.min(1, Math.max(0, (Math.hypot(dx, dz) - 1) / 2))
      cone.current.opacity =
        (0.028 + Math.sin(clock.elapsedTime * 3) * 0.008) * near
      cone.current.color.copy(tint).lerp(new Color("#ffffff"), 0.5)
    }
  })
  if (!seat) return null
  return (
    <group ref={group} position={[seat.x, 0, seat.z]}>
      <mesh position-y={3.2}>
        <cylinderGeometry args={[0.08, 0.75, 6.4, 32, 1, true]} />
        <meshBasicMaterial
          ref={cone}
          transparent
          opacity={0.08}
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/** Floating status over the table: whose turn, who won, who's ready. */
function TableSign({ room, selfId }: { room: RoomSnapshot; selfId: string }) {
  const game = room.game
  const nameOf = (id: string | null | undefined) =>
    room.players.find((player) => player.id === id)?.name ?? "Someone"
  let text: string
  let background = "rgba(10,9,8,0.78)"
  let color = "#ffffff"
  if (room.status === "lobby" || !game) {
    const ready = room.players.filter((player) => player.ready).length
    text = `Lobby · ${ready}/${room.players.length} ready`
  } else if (room.status === "finished") {
    const winner = game.winnerPlacements[0]?.playerId ?? game.winnerPlayerId
    text = `🏆 ${winner === selfId ? "You win!" : `${nameOf(winner)} wins`}`
    background = "#ffd23d"
    color = "#1a1200"
  } else if (game.turnPlayerId === selfId) {
    text = "Your turn"
    background = "#ffffff"
    color = "#111111"
  } else {
    text = `${nameOf(game.turnPlayerId)}'s turn`
  }
  const label = useMemo(
    () => labelTexture(text, { background, color, size: 48 }),
    [text, background, color]
  )
  const ref = useRef<Group>(null)
  const material = useRef<SpriteMaterial>(null)
  useFrame(({ clock, camera }) => {
    if (!ref.current) return
    ref.current.position.y =
      TOP + 1.25 + Math.sin(clock.elapsedTime * 1.5) * 0.04
    // Fade out when the camera passes close, so it never fills the screen.
    const distance = camera.position.distanceTo(ref.current.position)
    if (material.current)
      material.current.opacity = Math.min(1, Math.max(0, (distance - 2) / 1.5))
  })
  return (
    <group ref={ref} position={[TABLE.x, TOP + 1.25, TABLE.z]}>
      <sprite scale={[0.3 * label.aspect, 0.3, 1]}>
        <spriteMaterial
          ref={material}
          map={label.texture}
          transparent
          depthWrite={false}
        />
      </sprite>
    </group>
  )
}

/**
 * A card's face (or back, for null) as the real <UnoCard> looks, unlit so it
 * reads the same in the dark room as it does on the classic table.
 */
function CardMaterial({
  card,
  side = DoubleSide,
  brightness = 0.86,
}: {
  card: Card | null
  side?: Side
  brightness?: number
}) {
  const texture = useCardTexture(card)
  return (
    <meshBasicMaterial
      map={texture}
      transparent
      side={side}
      color={[brightness, brightness, brightness]}
      toneMapped={false}
    />
  )
}
