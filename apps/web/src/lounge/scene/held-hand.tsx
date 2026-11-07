import { useEffect, useRef, useState } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { Color } from "three"
import { registerHeld } from "../flights"
import { useCardTexture } from "../real-cards"
import { cardGlowTexture } from "../textures"
import type { Group, Mesh, MeshBasicMaterial } from "three"
import type { ThreeEvent } from "@react-three/fiber"
import type { Card } from "@workspace/game"

export type HandView = {
  cards: Array<Card>
  isSelected: (cardId: string) => boolean
  /** Can join the play right now (drawn bright on this hand's turn). */
  isPlayable: (card: Card) => boolean
  /** It's this hand's turn: cards that can't go are dimmed. */
  turn: boolean
  /** Null when only watching (spectating someone's hand). */
  onToggle: ((card: Card) => boolean) | null
  onThrow: ((card: Card) => "played" | "needs-choice" | "rejected") | null
}

/** Lens while seated: wider on a tall phone so the table still fits. */
export function seatedFov(width: number, height: number) {
  return width < height ? 78 : 60
}

/** Distance in front of the eye that the hand is held at. */
const DEPTH = 0.62
/** Upward drag, in pixels, that counts as throwing a card on the table. */
const THROW_PX = 70

type Drag = {
  cardId: string
  pointerId: number
  startX: number
  startY: number
  dx: number
  dy: number
  moved: boolean
}

/**
 * Cards held in a fan at the bottom of your view while you sit at the table:
 * your own to play, or, when spectating, the hand you're watching. The fan
 * follows the camera every frame, so it always stays in hand.
 */
export function HeldHand({ hand }: { hand: HandView }) {
  const { camera, size, gl } = useThree()
  const group = useRef<Group>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [rejected, setRejected] = useState<{ id: string; at: number } | null>(
    null
  )

  const cards = hand.cards
  // Cards shift when the hand changes; a hover from before no longer applies.
  const handKey = cards.map((card) => card.id).join(":")
  useEffect(() => setHovered(null), [handKey])

  // Window-level drag tracking: the pointer leaves the card while throwing.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      current.dx = event.clientX - current.startX
      current.dy = event.clientY - current.startY
      if (Math.hypot(current.dx, current.dy) > 8 && !current.moved) {
        current.moved = true
        setDragging(current.cardId)
      }
    }
    const up = (event: PointerEvent) => {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      drag.current = null
      setDragging(null)
      const card = cards.find((candidate) => candidate.id === current.cardId)
      if (!card) return
      if (current.moved && current.dy < -THROW_PX && hand.onThrow) {
        const result = hand.onThrow(card)
        if (result === "rejected")
          setRejected({ id: card.id, at: performance.now() })
      } else if (!current.moved && hand.onToggle) {
        if (!hand.onToggle(card))
          setRejected({ id: card.id, at: performance.now() })
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  }, [cards, hand])

  useEffect(() => {
    gl.domElement.style.cursor = hovered ? (dragging ? "grabbing" : "grab") : ""
  }, [hovered, dragging, gl])
  useEffect(() => () => void (gl.domElement.style.cursor = ""), [gl])

  // How wide the view is at the hand's depth, to size the fan to the screen.
  // Use the seated lens directly: the camera may not have switched to it yet.
  const fov = seatedFov(size.width, size.height)
  const halfHeight = Math.tan((fov * Math.PI) / 360) * DEPTH
  const halfWidth = halfHeight * (size.width / Math.max(size.height, 1))
  const portrait = size.width < size.height
  const cardW = portrait
    ? Math.min(halfWidth * 0.4, halfHeight * 0.2)
    : Math.min(halfHeight * 0.25, halfWidth * 0.2)
  const cardH = cardW * 1.414
  const layout = layoutHand(cards.length, {
    halfWidth,
    halfHeight,
    cardW,
    cardH,
    maxRows: portrait ? 3 : 2,
    idealStep: cardW * (portrait ? 0.62 : 0.78),
  })
  const pxToWorld = (halfHeight * 2) / Math.max(size.height, 1)

  useFrame(() => {
    if (!group.current) return
    group.current.position.copy(camera.position)
    group.current.quaternion.copy(camera.quaternion)
  })

  return (
    <group ref={group}>
      {cards.map((card, index) => {
        const slot = layout[index]
        return (
          <HeldCard
            key={card.id}
            card={card}
            x={slot.x}
            y={slot.y}
            z={slot.z}
            order={slot.order}
            tilt={slot.tilt}
            width={cardW}
            height={cardH}
            selected={hand.isSelected(card.id)}
            playable={hand.turn && hand.isPlayable(card)}
            myTurn={hand.turn}
            hovered={hovered === card.id}
            drag={dragging === card.id ? drag : null}
            pxToWorld={pxToWorld}
            rejectedAt={rejected?.id === card.id ? rejected.at : null}
            onOver={() => setHovered(card.id)}
            onOut={() =>
              setHovered((current) => (current === card.id ? null : current))
            }
            onDown={(event) => {
              event.stopPropagation()
              if (!hand.onToggle) return
              drag.current = {
                cardId: card.id,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                dx: 0,
                dy: 0,
                moved: false,
              }
            }}
          />
        )
      })}
    </group>
  )
}

// Linear values: 0.16 reads as roughly 45% brightness on screen.
const DIM = new Color(0.16, 0.16, 0.18)
// Just under the bloom threshold, so faces stay crisp instead of glowing.
const FULL = new Color(0.86, 0.86, 0.86)

function HeldCard({
  card,
  x,
  y,
  z,
  order,
  tilt,
  width,
  height,
  selected,
  playable,
  myTurn,
  hovered,
  drag,
  pxToWorld,
  rejectedAt,
  onOver,
  onOut,
  onDown,
}: {
  card: Card
  x: number
  y: number
  /** Depth: nearer cards (front row, right-hand side) win the pointer. */
  z: number
  /** Draw order, so overlapping cards stack the way they're held. */
  order: number
  tilt: number
  width: number
  height: number
  selected: boolean
  playable: boolean
  myTurn: boolean
  hovered: boolean
  drag: { current: Drag | null } | null
  pxToWorld: number
  rejectedAt: number | null
  onOver: () => void
  onOut: () => void
  onDown: (event: ThreeEvent<PointerEvent>) => void
}) {
  const mesh = useRef<Mesh>(null)
  const glow = useRef<Mesh>(null)
  const material = useRef<MeshBasicMaterial>(null)
  const texture = useCardTexture(card)
  // New cards slide up from below the view.
  const born = useRef(performance.now())

  useFrame((_, dt) => {
    const target = mesh.current
    if (!target) return
    const k = 1 - Math.exp(-dt * 16)
    let tx = x
    let ty = y
    let tz = z
    let rz = tilt
    let scale = 1
    const dimmed = myTurn && !playable && !selected
    if (selected) ty += height * 0.42
    else if (hovered) ty += height * 0.22
    if (hovered || selected) {
      rz *= 0.4
      scale = 1.08
      // Pull it forward so it draws over, and keeps, the pointer.
      tz += 0.03
    }
    const current = drag?.current
    if (current?.moved) {
      tx += current.dx * pxToWorld
      ty -= current.dy * pxToWorld
      tz += 0.05
      rz = 0
      scale = 1.12
    }
    const age = (performance.now() - born.current) / 1000
    if (age < 0.4) ty -= (1 - age / 0.4) ** 2 * height * 1.5
    if (rejectedAt !== null) {
      const since = (performance.now() - rejectedAt) / 1000
      if (since < 0.35) tx += Math.sin(since * 60) * 0.006 * (1 - since / 0.35)
    }
    target.position.x += (tx - target.position.x) * k
    target.position.y += (ty - target.position.y) * k
    target.position.z = tz
    target.rotation.z += (rz - target.rotation.z) * k
    const s = target.scale.x + (scale - target.scale.x) * k
    target.scale.set(s, s, 1)
    const top = hovered || selected || Boolean(current?.moved)
    target.renderOrder = top ? 3000 + order : 1000 + order
    if (glow.current) {
      glow.current.renderOrder = target.renderOrder - 1
      glow.current.visible = selected || (hovered && playable)
      glow.current.position.copy(target.position)
      glow.current.position.z -= 0.0003
      glow.current.rotation.z = target.rotation.z
      glow.current.scale.set(s, s, 1)
    }
    if (material.current) {
      // Cards you can't play now sit back a little on your turn.
      material.current.color.lerp(dimmed ? DIM : FULL, k)
    }
  })

  return (
    <>
      <mesh ref={glow} renderOrder={999 + order} visible={false}>
        {/* The halo texture has a margin, so the plane is drawn larger. */}
        <planeGeometry args={[width * 1.48, height * 1.33]} />
        <meshBasicMaterial
          map={cardGlowTexture()}
          color={selected ? "#ffffff" : "#ffe9a8"}
          transparent
          opacity={selected ? 0.95 : 0.55}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        ref={(object) => {
          mesh.current = object
          registerHeld(card.id, object)
          if (object) object.userData.cardWidth = width
        }}
        position={[x, y - height, -DEPTH]}
        renderOrder={1000 + order}
        onPointerOver={(event) => {
          event.stopPropagation()
          onOver()
        }}
        onPointerOut={onOut}
        onPointerDown={onDown}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          ref={material}
          map={texture}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  )
}

export type HandSlot = {
  x: number
  y: number
  z: number
  tilt: number
  order: number
}

/**
 * Where each held card goes, for any number of cards. Every card stays fully
 * on screen. When one row would squeeze cards past the point where their
 * corner index shows, the hand splits into rows: the earlier cards in a row
 * held behind and above, like a real hand of 25. The curve and tilt are
 * capped so the ends never dip out of view.
 */
export function layoutHand(
  count: number,
  {
    halfWidth,
    halfHeight,
    cardW,
    cardH,
    maxRows,
    idealStep,
  }: {
    halfWidth: number
    halfHeight: number
    cardW: number
    cardH: number
    maxRows: number
    idealStep: number
  }
): Array<HandSlot> {
  if (count === 0) return []
  // Room for card centres, leaving a margin at both screen edges.
  const span = Math.max(0, halfWidth * 2 * 0.92 - cardW * 1.1)
  // The corner index needs about a third of a card showing.
  const minStep = cardW * 0.34
  let rows = 1
  while (rows < maxRows && (Math.ceil(count / rows) - 1) * minStep > span)
    rows += 1
  const perRow = Math.ceil(count / rows)
  const step = perRow > 1 ? Math.min(idealStep, span / (perRow - 1)) : 0
  const halfSpan = ((perRow - 1) * step) / 2
  // A gentle curve: the ends drop at most a tenth of a card.
  const maxDrop = cardH * 0.1
  const curve = halfSpan > 0 ? maxDrop / (halfSpan * halfSpan) : 0
  const maxTilt = 0.16
  // Front row sits fully on screen with a small margin below it.
  // The tilted ends dip a little lower than their centres, so add that too.
  const frontY =
    -halfHeight +
    cardH * 0.5 +
    maxDrop +
    cardW * 0.5 * Math.sin(maxTilt) +
    halfHeight * 0.04
  const rowGap = cardH * 0.4

  const slots: Array<HandSlot> = []
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / perRow)
    // Row 0 is the back row; the last row is in front.
    const fromFront = rows - 1 - row
    const inRow = Math.min(perRow, count - row * perRow)
    const column = index - row * perRow
    const offset = column - (inRow - 1) / 2
    const x = offset * step
    slots.push({
      x,
      y: frontY + fromFront * rowGap - curve * x * x,
      z: -DEPTH - fromFront * 0.02 + column * 0.0006,
      tilt: halfSpan > 0 ? -(x / halfSpan) * maxTilt : 0,
      order: row * 100 + column,
    })
  }
  return slots
}
