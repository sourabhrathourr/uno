import { describe, expect, it } from "vitest"

import {
  createDefaultHouseRules,
  createGame,
  drawRouletteCard,
  type Card,
  type GameContext,
} from "./index"

function setup(handSize: number, colors: Card["color"][], mercyHandLimit = 25) {
  const context: GameContext = {
    players: ["a", "b", "c"].map((id, seat) => ({
      id,
      name: id.toUpperCase(),
      seat,
      ready: true,
      connected: true,
      joinedAt: "2026-10-03T00:00:00.000Z",
      lastSeenAt: "2026-10-03T00:00:00.000Z",
    })),
    houseRules: {
      ...createDefaultHouseRules(),
      startingHandSize: Math.min(7, mercyHandLimit),
      mercyHandLimit,
    },
  }
  const game = createGame(context)
  const hand = Array.from({ length: handSize }, (_, index) =>
    card(`hand-${index}`, "blue")
  )
  game.handsByPlayerId.b = hand
  game.drawPile = colors.map((color, index) => card(`draw-${index}`, color))
  game.discardPile = [
    { id: "roulette", color: "wild", face: { kind: "wild-color-roulette" } },
  ]
  game.knockedOutCards = []
  game.turnPlayerId = "b"
  game.pendingChoice = {
    type: "roulette-draw",
    playerId: "b",
    color: "red",
    drawnCards: [],
  }
  return { context, game, originalHand: [...hand] }
}

function card(id: string, color: Card["color"]): Card {
  return { id, color, face: { kind: "number", value: 1 } }
}

describe("roulette mercy limit", () => {
  it("stops at 26 including pending draws, before the requested color appears", () => {
    const { context, game, originalHand } = setup(23, [
      "blue",
      "yellow",
      "green",
      "blue",
      "red",
    ])
    const deck = [...game.drawPile]

    for (let index = 0; index < 2; index += 1) {
      expect(drawRouletteCard(game, context, "b").ok).toBe(true)
      expect(game.pendingChoice?.drawnCards).toHaveLength(index + 1)
      expect(game.eliminatedPlayerIds).not.toContain("b")
    }

    expect(drawRouletteCard(game, context, "b").ok).toBe(true)
    expect(game.pendingChoice).toBeNull()
    expect(game.eliminatedPlayerIds).toEqual(["b"])
    expect(game.lastGifts[0]?.cards).toEqual([
      ...originalHand,
      ...deck.slice(0, 3),
    ])
    expect(game.drawPile).toEqual(deck.slice(3))
    expect(game.handsByPlayerId.b).toEqual([])
    expect(game.turnPlayerId).toBe("c")
    expect(game.stagedPlay).toBeNull()
    expect(game.statsByPlayerId.b?.cardsDrawn).toBe(3)
    expect(game.statsByPlayerId.b?.peakHandSize).toBe(26)
    expect(
      game.events.find((event) => event.drawKind === "roulette-complete")
    ).toMatchObject({ cardCount: 3, cards: deck.slice(0, 3) })
    expect(
      game.events.find((event) => event.drawKind === "roulette-complete")
        ?.message
    ).not.toContain("found red")

    const stoppedGame = structuredClone(game)
    expect(drawRouletteCard(game, context, "b")).toMatchObject({
      ok: false,
      error: { code: "last-gift-pending" },
    })
    expect(game).toEqual(stoppedGame)
  })

  it.each(["blue", "red"] as const)(
    "eliminates immediately when the 26th card is %s",
    (color) => {
      const { context, game } = setup(25, [color, "red"])

      expect(drawRouletteCard(game, context, "b").ok).toBe(true)

      expect(game.eliminatedPlayerIds).toEqual(["b"])
      expect(game.pendingChoice).toBeNull()
      expect(game.lastGifts[0]?.cards).toHaveLength(26)
      expect(game.drawPile.map((card) => card.id)).toEqual(["draw-1"])
    }
  )

  it("keeps drawing at exactly 25 when the color has not appeared", () => {
    const { context, game } = setup(24, ["blue", "red"])

    expect(drawRouletteCard(game, context, "b").ok).toBe(true)

    expect(game.pendingChoice?.drawnCards).toHaveLength(1)
    expect(game.eliminatedPlayerIds).toEqual([])
    expect(game.turnPlayerId).toBe("b")
  })

  it("finishes normally when the requested color brings the hand to exactly 25", () => {
    const { context, game } = setup(24, ["red", "blue"])

    expect(drawRouletteCard(game, context, "b").ok).toBe(true)

    expect(game.pendingChoice).toBeNull()
    expect(game.eliminatedPlayerIds).toEqual([])
    expect(game.handsByPlayerId.b).toHaveLength(25)
    expect(game.turnPlayerId).toBe("c")
    expect(game.stagedPlay).toMatchObject({
      kind: "roulette",
      cardIds: ["draw-0"],
    })
    expect(
      game.events.find((event) => event.drawKind === "roulette-complete")
        ?.message
    ).toContain("found red after drawing 1 card")
  })

  it("uses the room's mercy limit", () => {
    const { context, game } = setup(4, ["blue", "yellow", "red"], 5)

    expect(drawRouletteCard(game, context, "b").ok).toBe(true)
    expect(game.eliminatedPlayerIds).toEqual([])
    expect(drawRouletteCard(game, context, "b").ok).toBe(true)

    expect(game.eliminatedPlayerIds).toEqual(["b"])
    expect(game.knockedOutCards).toHaveLength(6)
    expect(game.drawPile.map((card) => card.id)).toEqual(["draw-2"])
  })

  it("ends the match when the knockout leaves only one player", () => {
    const { context, game } = setup(25, ["blue", "red"])
    game.playerOrder = ["a", "b"]
    delete game.handsByPlayerId.c

    expect(drawRouletteCard(game, context, "b").ok).toBe(true)

    expect(game.eliminatedPlayerIds).toEqual(["b"])
    expect(game.winnerPlayerId).toBe("a")
    expect(game.finishedAt).not.toBeNull()
    expect(game.turnPlayerId).toBeNull()
    expect(game.pendingChoice).toBeNull()
    expect(game.stagedPlay).toBeNull()
    expect(game.drawPile.map((card) => card.id)).toEqual(["draw-1"])
  })

  it("can still finish if the deck runs out before the requested color", () => {
    const { context, game } = setup(7, ["blue"])

    expect(drawRouletteCard(game, context, "b").ok).toBe(true)
    expect(drawRouletteCard(game, context, "b").ok).toBe(true)

    expect(game.pendingChoice).toBeNull()
    expect(game.handsByPlayerId.b).toHaveLength(8)
    expect(game.eliminatedPlayerIds).toEqual([])
    expect(game.turnPlayerId).toBe("c")
    expect(
      game.events.find((event) => event.drawKind === "roulette-complete")
        ?.message
    ).not.toContain("found red")
  })
})

describe("color roulette draw", () => {
  it("eliminates a player as soon as pending pickup cards cross the mercy limit", () => {
    const { context, game } = setup(20, ["green"])
    const alreadyRevealed = Array.from({ length: 5 }, (_, index) =>
      card(`revealed-${index}`, "blue")
    )
    game.pendingChoice!.color = "yellow"
    game.pendingChoice!.drawnCards = [...alreadyRevealed]

    const result = drawRouletteCard(game, context, "b")

    expect(result.ok).toBe(true)
    expect(game.eliminatedPlayerIds).toContain("b")
    expect(game.pendingChoice).toBeNull()
    expect(game.handsByPlayerId.b).toEqual([])
    expect(game.lastGifts[0]?.cards).toHaveLength(26)
    expect(game.lastGifts[0]?.cards.slice(20, 25)).toEqual(alreadyRevealed)
    expect(game.lastGifts[0]?.cards[25]?.color).toBe("green")
  })
})
