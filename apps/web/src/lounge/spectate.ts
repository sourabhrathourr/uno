import { useEffect, useRef, useState } from "react"
import type {
  PlayerGameSnapshot,
  PlayerSocialSnapshot,
  RoomSnapshot,
} from "@workspace/game"

import type { GameSocket } from "@/lib/realtime"
import { availableSupportCandidates } from "@/components/support-experience"

export type SupportActions = {
  supportPlayer: (supportedPlayerId: string) => void
  requestSupport: (supportedPlayerId: string) => void
  respondSupportRequest: (supporterPlayerId: string, approve: boolean) => void
  kickSupporter: (supporterPlayerId: string) => void
}

/**
 * Spectating at the 3D table, the same way the classic table does it: a
 * player who's out (eliminated, finished, kicked or waiting for the next
 * match) backs someone still playing and watches their live hand. Backing
 * someone who kicked you before needs their OK first.
 */
export function useSpectate({
  socket,
  room,
  selfId,
  playerSocial,
  actions,
}: {
  socket: GameSocket | null
  room: RoomSnapshot
  selfId: string
  playerSocial: PlayerSocialSnapshot | null
  actions: SupportActions
}) {
  const game = room.game
  const selfState = game?.players.find((p) => p.playerId === selfId)
  const inactive = Boolean(
    game &&
    room.status === "playing" &&
    (selfState?.eliminated ||
      selfState?.winnerPlacement ||
      selfState?.voteKicked ||
      selfState?.waiting ||
      !selfState)
  )
  const watchingId =
    game?.supportLinks.find((link) => link.supporterPlayerId === selfId)
      ?.supportedPlayerId ?? null
  const [view, setView] = useState<PlayerGameSnapshot | null>(null)
  const requestId = useRef(0)
  const nameOf = (id: string) =>
    room.players.find((player) => player.id === id)?.name ?? "Someone"

  // The watched hand, refreshed whenever the room moves.
  useEffect(() => {
    const id = ++requestId.current
    if (!inactive || !watchingId || !socket) {
      setView(null)
      return
    }
    socket.emit("game:getSupportView", (result) => {
      if (requestId.current !== id) return
      setView(
        result.ok && result.data?.playerId === watchingId ? result.data : null
      )
    })
  }, [socket, inactive, watchingId, room.version])

  const blocked = playerSocial?.blockedSupportedPlayerIds ?? []
  const free = availableSupportCandidates(game?.players ?? [], blocked, selfId)
  const askFirst = (game?.players ?? []).filter(
    (candidate) =>
      candidate.playerId !== selfId &&
      !candidate.eliminated &&
      !candidate.winnerPlacement &&
      !candidate.waiting &&
      blocked.includes(candidate.playerId)
  )
  const outgoing = playerSocial?.outgoingSupportRequest ?? null

  return {
    inactive,
    watchingId,
    watchingName: watchingId ? nameOf(watchingId) : null,
    view: view?.playerId === watchingId ? view : null,
    candidates: [
      ...free.map((c) => ({
        id: c.playerId,
        name: nameOf(c.playerId),
        askFirst: false,
      })),
      ...askFirst.map((c) => ({
        id: c.playerId,
        name: nameOf(c.playerId),
        askFirst: true,
      })),
    ],
    waitingOn: outgoing ? nameOf(outgoing.supportedPlayerId) : null,
    /** People asking to back you, who you kicked earlier. */
    requests: (playerSocial?.incomingSupportRequests ?? []).map((request) => ({
      id: request.supporterPlayerId,
      name: nameOf(request.supporterPlayerId),
    })),
    /** People backing you right now. */
    backers: (game?.supportLinks ?? [])
      .filter((link) => link.supportedPlayerId === selfId)
      .map((link) => ({
        id: link.supporterPlayerId,
        name: nameOf(link.supporterPlayerId),
      })),
    back(candidate: { id: string; askFirst: boolean }) {
      if (watchingId || outgoing) return
      if (candidate.askFirst) actions.requestSupport(candidate.id)
      else actions.supportPlayer(candidate.id)
    },
    respond: actions.respondSupportRequest,
    kick: actions.kickSupporter,
  }
}

export type Spectate = ReturnType<typeof useSpectate>
