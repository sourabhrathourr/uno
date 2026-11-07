import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { toCanvas } from "html-to-image"
import { CanvasTexture, SRGBColorSpace } from "three"
import { UnoCard } from "@workspace/ui/components/uno-card"
import { cardBackTexture, cardFaceTexture } from "./textures"
import type { Texture } from "three"
import type { Card } from "@workspace/game"

/**
 * The 3D cards are pictures of the real <UnoCard>: the same component the
 * classic table renders, drawn by the browser off-screen and captured once
 * per face. So the lounge can never drift from the game's card design.
 * Until a face is captured, a quick canvas drawing stands in.
 */

type Request = { key: string; card: Card | null }

const textures = new Map<string, Texture>()
const queued = new Map<string, Request>()
const listeners = new Set<() => void>()
let version = 0

function keyFor(card: Card | null) {
  return card ? `${card.color}:${JSON.stringify(card.face)}` : "back"
}

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

function request(card: Card | null) {
  const key = keyFor(card)
  if (textures.has(key) || queued.has(key)) return
  queued.set(key, { key, card })
  notify()
}

const store = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => version,
}

/** The texture for a card face (or the back, for null). */
export function useCardTexture(card: Card | null): Texture {
  useSyncExternalStore(store.subscribe, store.get, store.get)
  const key = keyFor(card)
  const ready = textures.get(key)
  useEffect(() => {
    if (!ready) request(card)
  }, [key, ready])
  return ready ?? (card ? cardFaceTexture(card) : cardBackTexture())
}

/** Ask for several faces up front (a fresh hand), so they arrive together. */
export function prefetchCards(cards: Array<Card | null>) {
  for (const card of cards) request(card)
}

/**
 * Renders queued cards one at a time with the real component, off-screen,
 * and turns each into a texture. Mount once, outside the 3D canvas.
 */
export function CardSnapshotter() {
  useSyncExternalStore(store.subscribe, store.get, store.get)
  const [current, setCurrent] = useState<Request | null>(null)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (current) return
    const next = queued.values().next()
    if (!next.done) setCurrent(next.value)
  })

  useLayoutEffect(() => {
    if (!current || !host.current) return
    const node = host.current.firstElementChild as HTMLElement | null
    if (!node) return
    let cancelled = false
    const done = (texture: Texture | null) => {
      if (cancelled) return
      queued.delete(current.key)
      if (texture) textures.set(current.key, texture)
      setCurrent(null)
      notify()
    }
    // Wait for the card's web font, then capture at 2x for crisp edges.
    void document.fonts.ready
      .then(() => toCanvas(node, { pixelRatio: 2, backgroundColor: undefined }))
      .then((canvas) => {
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = 8
        done(texture)
      })
      .catch((error: unknown) => {
        // Keep the stand-in drawing for this face rather than retrying.
        console.warn("Couldn't capture card for the lounge", error)
        done(null)
      })
    return () => {
      cancelled = true
    }
  }, [current])

  return (
    <div
      ref={host}
      aria-hidden="true"
      // Off-screen but laid out, so the browser draws it for real.
      className="pointer-events-none fixed top-0 -left-[2000px]"
    >
      {current && (
        <UnoCard
          key={current.key}
          card={
            current.card ?? {
              id: "back",
              color: "wild",
              face: { kind: "wild" },
            }
          }
          faceDown={!current.card}
          size="xl"
          static
          // No drop shadow in the picture: the 3D scene lights the card.
          style={{ boxShadow: "none" }}
        />
      )}
    </div>
  )
}
