import { describe, expect, it } from "vitest"

import {
  catchUno,
  createGame,
  kickSupporter,
  projectPublicGame,
  projectSupportView,
  releaseInactiveSupportLinks,
  sendAvatarEmojiReaction,
  stageCards,
  supportPlayer,
  supportSquadMemberIds,
  supportSquadPlayerIdFor,
  type AvatarReactionEmoji,
  type GameContext,
  type GameState,
} from "./index"

const context: GameContext = {
  players: [player("a", "A", 1), player("b", "B", 2), player("c", "C", 3)],
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

describe("support links", () => {
  it("lets an inactive player lock onto one active player and see their live hand", () => {
    const game = inactiveGame("a")

    const result = supportPlayer(game, context, "a", "b")

    expect(result.ok).toBe(true)
    expect(game.supportLinks).toMatchObject([
      { supporterPlayerId: "a", supportedPlayerId: "b" },
    ])
    expect(projectSupportView(game, context, "a")?.hand).toEqual(
      game.handsByPlayerId.b
    )
    expect(projectSupportView(game, context, "a")?.playableCardIds).toEqual(
      expect.any(Array)
    )
  })

  it("does not let a supporter switch while their supported player is active", () => {
    const game = inactiveGame("a")
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)

    const result = supportPlayer(game, context, "a", "c")

    expect(result).toMatchObject({
      ok: false,
      error: { code: "support-locked" },
    })
  })

  it("allows multiple supporters and releases them when their player becomes inactive", () => {
    const game = createGame(context)
    game.eliminatedPlayerIds = ["a", "c"]
    game.handsByPlayerId.a = []
    game.handsByPlayerId.c = []
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)
    expect(supportPlayer(game, context, "c", "b").ok).toBe(true)
    expect(game.supportLinks).toHaveLength(2)

    game.winnerPlacements.push({
      playerId: "b",
      position: 1,
      createdAt: "2026-07-10T00:01:00.000Z",
    })
    releaseInactiveSupportLinks(game, context)

    expect(game.supportLinks).toEqual([])
  })

  it("lets a winner support an active player", () => {
    const game = createGame(context)
    game.winnerPlacements.push({
      playerId: "a",
      position: 1,
      createdAt: "2026-07-10T00:01:00.000Z",
    })
    game.handsByPlayerId.a = []

    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)
  })

  it("lets the supported player kick a supporter and blocks that pair for the match", () => {
    const game = inactiveGame("a")
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)

    expect(kickSupporter(game, context, "b", "a").ok).toBe(true)
    expect(game.supportLinks).toEqual([])
    expect(projectSupportView(game, context, "a")).toBeNull()
    expect(supportPlayer(game, context, "a", "b")).toMatchObject({
      ok: false,
      error: { code: "support-blocked" },
    })
    expect(supportPlayer(game, context, "a", "c").ok).toBe(true)
  })

  it("projects current squad membership from the support lifecycle", () => {
    const game = inactiveGame("a")
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)

    expect(supportSquadPlayerIdFor(game, "a")).toBe("b")
    expect(supportSquadPlayerIdFor(game, "b")).toBe("b")
    expect(supportSquadMemberIds(game, "b")).toEqual(["b", "a"])

    expect(kickSupporter(game, context, "b", "a").ok).toBe(true)
    expect(supportSquadPlayerIdFor(game, "a")).toBeNull()
    expect(supportSquadPlayerIdFor(game, "b")).toBe("b")
    expect(supportSquadMemberIds(game, "b")).toEqual(["b"])
  })

  it("prevents inactive players from calling UNO", () => {
    const game = inactiveGame("a")
    game.unoVulnerablePlayerIds = ["b"]

    const result = catchUno(game, context, "a", { targetPlayerId: "b" })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "player-inactive" },
    })
  })
})

describe("avatar reactions and support recap", () => {
  it("lets every player react and directs supporter emoji to their player", () => {
    const game = inactiveGame("a")
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)

    expect(sendAvatarEmojiReaction(game, context, "a", { body: "🔥" }).ok).toBe(
      true
    )
    expect(sendAvatarEmojiReaction(game, context, "c", { body: "👀" }).ok).toBe(
      true
    )

    expect(game.avatarEmojiReactions).toMatchObject([
      { playerId: "a", supportedPlayerId: "b", body: "🔥" },
      { playerId: "c", supportedPlayerId: null, body: "👀" },
    ])
  })

  it("rejects the removed quick-taunt phrases", () => {
    const game = inactiveGame("a")

    const result = sendAvatarEmojiReaction(game, context, "c", {
      body: "BIG MOVE" as AvatarReactionEmoji,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-avatar-emoji-reaction" },
    })
  })

  it("publishes the support journey and cosmetic titles when the match finishes", () => {
    const game = inactiveGame("a")
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)

    game.winnerPlacements = [
      { playerId: "b", position: 1, createdAt: "2026-07-10T00:01:00.000Z" },
      { playerId: "c", position: 2, createdAt: "2026-07-10T00:02:00.000Z" },
    ]
    game.turnPlayerId = null
    releaseInactiveSupportLinks(game, context)

    const recap = projectPublicGame(game, context).supportRecap
    expect(recap?.journey).toMatchObject([
      { supporterPlayerId: "a", supportedPlayerId: "b" },
    ])
    expect(recap?.titles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Early Believer", playerId: "a" }),
        expect.objectContaining({ label: "Crowd Favorite", playerId: "b" }),
      ])
    )
  })
})

describe("live support decision state", () => {
  it("projects the active player's staged choices with their cards", () => {
    const game = createGame(context)
    const card = game.handsByPlayerId.a?.[0]
    if (!card) throw new Error("Expected a starting card")
    game.discardPile = [{ ...card, id: "matching-discard" }]
    game.currentColor = card.color === "wild" ? "red" : card.color

    const result = stageCards(game, context, "a", {
      cardIds: [card.id],
      chosenColor: "blue",
      declaredUno: true,
      rotateHands: true,
      swapWithPlayerId: "b",
    })

    expect(result.ok).toBe(true)
    expect(projectPublicGame(game, context).stagedPlay).toMatchObject({
      chosenColor: "blue",
      declaredUno: true,
      rotateHands: true,
      swapWithPlayerId: "b",
    })
  })
})

function inactiveGame(playerId: string): GameState {
  const game = createGame(context)
  game.eliminatedPlayerIds = [playerId]
  game.handsByPlayerId[playerId] = []
  return game
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
