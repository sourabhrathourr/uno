import { useEffect, useRef, useState } from "react"
import type {
  WorldAvatarState,
  WorldLeftEvent,
  WorldMovedEvent,
} from "@workspace/game"

import type { GameSocket } from "@/lib/realtime"

export type RemoteAvatar = {
  playerId: string
  /** Latest state from the network. Rendering eases toward it. */
  target: WorldAvatarState
  receivedAt: number
}

/** Avatars that stop reporting for this long left the lounge. */
const STALE_MS = 6_000
/** Send at most this often while moving, and this often while still. */
const MOVE_INTERVAL_MS = 80
const IDLE_INTERVAL_MS = 1_500

/**
 * Shares this player's avatar and tracks everyone else's. Remote states live
 * in a ref (they change every frame); `ids` changes only when someone enters
 * or leaves, which is all React needs to re-render for.
 */
export function useWorldPresence(socket: GameSocket | null, selfId: string) {
  const remotes = useRef(new Map<string, RemoteAvatar>())
  const [ids, setIds] = useState<Array<string>>([])
  const lastSent = useRef<{ at: number; state: WorldAvatarState | null }>({
    at: 0,
    state: null,
  })

  useEffect(() => {
    if (!socket) return
    const map = remotes.current
    const syncIds = () => {
      const next = [...map.keys()].sort()
      setIds((current) =>
        current.length === next.length &&
        current.every((id, i) => id === next[i])
          ? current
          : next
      )
    }
    const onMoved = (event: WorldMovedEvent) => {
      if (event.playerId === selfId) return
      const known = map.has(event.playerId)
      const { playerId, ...target } = event
      map.set(playerId, { playerId, target, receivedAt: performance.now() })
      if (!known) syncIds()
    }
    const onLeft = (event: WorldLeftEvent) => {
      if (map.delete(event.playerId)) syncIds()
    }
    const prune = window.setInterval(() => {
      const now = performance.now()
      let changed = false
      for (const [id, avatar] of map) {
        if (now - avatar.receivedAt > STALE_MS) {
          map.delete(id)
          changed = true
        }
      }
      if (changed) syncIds()
    }, 1_000)

    socket.on("world:moved", onMoved)
    socket.on("world:left", onLeft)
    return () => {
      socket.off("world:moved", onMoved)
      socket.off("world:left", onLeft)
      window.clearInterval(prune)
      socket.emit("world:leave")
      map.clear()
      setIds([])
    }
  }, [socket, selfId])

  /** Call every frame; sends only when something changed or as a heartbeat. */
  function publish(state: WorldAvatarState) {
    if (!socket?.connected) return
    const now = performance.now()
    const previous = lastSent.current
    const elapsed = now - previous.at
    const changed =
      !previous.state ||
      previous.state.animation !== state.animation ||
      previous.state.dance !== state.dance ||
      Math.abs(previous.state.x - state.x) > 0.01 ||
      Math.abs(previous.state.y - state.y) > 0.01 ||
      Math.abs(previous.state.z - state.z) > 0.01 ||
      Math.abs(previous.state.heading - state.heading) > 0.02
    if (elapsed < (changed ? MOVE_INTERVAL_MS : IDLE_INTERVAL_MS)) return
    lastSent.current = { at: now, state }
    socket.volatile.emit("world:move", state)
  }

  return { remotes, ids, publish }
}
