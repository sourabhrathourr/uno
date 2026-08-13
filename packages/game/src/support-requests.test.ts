import { describe, expect, it } from "vitest"

import {
  createGame,
  incomingSupportRequests,
  kickSupporter,
  outgoingSupportRequest,
  releaseInactiveSupportLinks,
  requestSupport,
  respondToSupportRequest,
  supportPlayer,
  type GameContext,
  type GameState,
} from "./index"

const context: GameContext = {
  players: [
    player("a", "A", 1),
    player("b", "B", 2),
    player("c", "C", 3),
    player("d", "D", 4),
  ],
  houseRules: {
    maxPlayers: 8,
    startingHandSize: 7,
    mercyHandLimit: 25,
    stackingDrawCards: true,
    allowDrawUntilPlayable: false,
    forcePlayDrawnCard: false,
    sevenSwap: true,
    zeroRotate: true,
    callUno: true,
  },
}

describe("second-chance support requests", () => {
  it("turns a blocked re-pick into a request the supported player answers", () => {
    const game = kickedGame()

    // The direct route stays closed after a kick.
    expect(supportPlayer(game, context, "a", "b")).toMatchObject({
      ok: false,
      error: { code: "support-blocked" },
    })

    expect(requestSupport(game, context, "a", "b").ok).toBe(true)
    expect(outgoingSupportRequest(game, "a")).toMatchObject({
      supporterPlayerId: "a",
      supportedPlayerId: "b",
    })
    expect(incomingSupportRequests(game, "b")).toHaveLength(1)
    // The request alone does not grant access.
    expect(game.supportLinks).toEqual([])

    expect(respondToSupportRequest(game, context, "b", "a", true).ok).toBe(true)
    expect(game.supportLinks).toMatchObject([
      { supporterPlayerId: "a", supportedPlayerId: "b" },
    ])
    expect(outgoingSupportRequest(game, "a")).toBeNull()
    expect(incomingSupportRequests(game, "b")).toEqual([])
  })

  it("keeps the block in place when the request is declined", () => {
    const game = kickedGame()
    expect(requestSupport(game, context, "a", "b").ok).toBe(true)

    expect(respondToSupportRequest(game, context, "b", "a", false).ok).toBe(
      true
    )

    expect(game.supportLinks).toEqual([])
    expect(incomingSupportRequests(game, "b")).toEqual([])
    expect(supportPlayer(game, context, "a", "b")).toMatchObject({
      ok: false,
      error: { code: "support-blocked" },
    })
    // Declining is not permanent — they can ask again.
    expect(requestSupport(game, context, "a", "b").ok).toBe(true)
  })

  it("does not ask permission the first time, only after a kick", () => {
    const game = inactiveGame("a")

    expect(requestSupport(game, context, "a", "b")).toMatchObject({
      ok: false,
      error: { code: "support-request-not-needed" },
    })
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)
  })

  it("holds one outstanding ask at a time and replaces it on a new target", () => {
    const game = kickedGame()
    kickFrom(game, "c", "a")

    expect(requestSupport(game, context, "a", "b").ok).toBe(true)
    expect(requestSupport(game, context, "a", "b")).toMatchObject({
      ok: false,
      error: { code: "support-request-pending" },
    })

    expect(requestSupport(game, context, "a", "c").ok).toBe(true)
    expect(incomingSupportRequests(game, "b")).toEqual([])
    expect(incomingSupportRequests(game, "c")).toHaveLength(1)
  })

  it("drops a pending ask once the target leaves the match", () => {
    const game = kickedGame()
    expect(requestSupport(game, context, "a", "b").ok).toBe(true)

    game.eliminatedPlayerIds.push("b")
    game.handsByPlayerId.b = []
    releaseInactiveSupportLinks(game, context)

    expect(incomingSupportRequests(game, "b")).toEqual([])
    expect(outgoingSupportRequest(game, "a")).toBeNull()
  })

  it("clears a pending ask when the supporter backs someone else instead", () => {
    const game = kickedGame()
    expect(requestSupport(game, context, "a", "b").ok).toBe(true)

    expect(supportPlayer(game, context, "a", "c").ok).toBe(true)

    expect(outgoingSupportRequest(game, "a")).toBeNull()
    expect(incomingSupportRequests(game, "b")).toEqual([])
  })

  it("refuses to answer a request that was never made", () => {
    const game = kickedGame()

    expect(
      respondToSupportRequest(game, context, "b", "a", true)
    ).toMatchObject({ ok: false, error: { code: "support-request-not-found" } })
  })

  it("refuses requests from players who are still in the match", () => {
    const game = createGame(context)

    expect(requestSupport(game, context, "a", "b")).toMatchObject({
      ok: false,
      error: { code: "player-active" },
    })
  })
})

function inactiveGame(playerId: string): GameState {
  const game = createGame(context)
  game.eliminatedPlayerIds = [playerId]
  game.handsByPlayerId[playerId] = []
  return game
}

/** `a` supported `b`, then `b` kicked them out of the squad. */
function kickedGame(): GameState {
  const game = inactiveGame("a")
  if (!supportPlayer(game, context, "a", "b").ok) {
    throw new Error("Expected the first support pick to succeed")
  }
  kickFrom(game, "b", "a")
  return game
}

function kickFrom(
  game: GameState,
  supportedPlayerId: string,
  supporterPlayerId: string
) {
  const linked = game.supportLinks.some(
    (link) =>
      link.supporterPlayerId === supporterPlayerId &&
      link.supportedPlayerId === supportedPlayerId
  )
  if (!linked) {
    if (
      !supportPlayer(game, context, supporterPlayerId, supportedPlayerId).ok
    ) {
      throw new Error("Expected the support link to be created")
    }
  }
  if (!kickSupporter(game, context, supportedPlayerId, supporterPlayerId).ok) {
    throw new Error("Expected the kick to succeed")
  }
}

function player(id: string, name: string, seat: number) {
  const now = "2026-07-10T00:00:00.000Z"
  return {
    id,
    name,
    seat,
    ready: true,
    connected: true,
    joinedAt: now,
    lastSeenAt: now,
  }
}
