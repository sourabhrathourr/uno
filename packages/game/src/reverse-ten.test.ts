import { describe, expect, it } from "vitest"
import {
  createDefaultHouseRules,
  createGame,
  createNoMercyDeck,
  playCards,
  projectPlayerGame,
  takeDrawPenalty,
  type Card,
  type Direction,
  type GameContext,
} from "./index"

describe("Wild Reverse +10", () => {
  it("adds two unique cards while keeping the existing +10 and Reverse +4 copies", () => {
    const deck = createNoMercyDeck()
    expect(deck).toHaveLength(170)
    expect(new Set(deck.map((card) => card.id)).size).toBe(170)
    expect(
      deck.filter(
        (card) =>
          card.face.kind === "wild-reverse-draw" && card.face.count === 10
      )
    ).toEqual([reverseTen(1), reverseTen(2)])
    expect(
      deck.filter(
        (card) =>
          card.face.kind === "wild-reverse-draw" && card.face.count === 4
      )
    ).toHaveLength(8)
    expect(
      deck.filter(
        (card) => card.face.kind === "wild-draw" && card.face.count === 10
      )
    ).toHaveLength(4)
  })

  it.each([
    { players: 3, direction: 1 as Direction, target: "c", next: "b" },
    { players: 3, direction: -1 as Direction, target: "b", next: "c" },
    { players: 2, direction: 1 as Direction, target: "b", next: "a" },
    { players: 2, direction: -1 as Direction, target: "b", next: "a" },
  ])(
    "reverses from $direction and targets $target with $players players",
    ({ players, direction, target, next }) => {
      const { game, context } = setup(players)
      game.direction = direction
      const before = game.handsByPlayerId[target]!.length
      expect(
        playCards(game, context, "a", {
          cardIds: [reverseTen(1).id],
          chosenColor: "green",
        }).ok
      ).toBe(true)
      expect(game.direction).toBe(-direction)
      expect(game.currentColor).toBe("green")
      expect(game.turnPlayerId).toBe(target)
      expect(game.drawStack).toEqual({
        amount: 10,
        minimum: 10,
        targetPlayerId: target,
      })
      expect(game.events).toContainEqual(
        expect.objectContaining({
          type: "card-played",
          message: "A played Wild Reverse +10.",
        })
      )
      expect(takeDrawPenalty(game, context, target).ok).toBe(true)
      expect(game.handsByPlayerId[target]).toHaveLength(before + 10)
      expect(game.drawStack).toBeNull()
      expect(game.turnPlayerId).toBe(next)
    }
  )

  it("reverses a +10 stack back to the sender and adds ten", () => {
    const { game, context } = setup()
    game.turnPlayerId = "b"
    game.handsByPlayerId.b = [reverseTen(1), number("spare", "blue")]
    game.drawStack = { amount: 10, minimum: 10, targetPlayerId: "b" }
    game.discardPile = [
      { id: "wild-ten", color: "wild", face: { kind: "wild-draw", count: 10 } },
    ]
    expect(
      playCards(game, context, "b", {
        cardIds: [reverseTen(1).id],
        chosenColor: "yellow",
      }).ok
    ).toBe(true)
    expect(game.direction).toBe(-1)
    expect(game.drawStack).toEqual({
      amount: 20,
      minimum: 10,
      targetPlayerId: "a",
    })
  })

  it.each([
    { kind: "wild-reverse-draw", count: 4 },
    { kind: "wild-draw", count: 6 },
  ] as const)("blocks $kind +$count from answering Reverse +10", (face) => {
    const { game, context } = setup()
    expect(
      playCards(game, context, "a", {
        cardIds: [reverseTen(1).id],
        chosenColor: "red",
      }).ok
    ).toBe(true)
    game.handsByPlayerId.c = [
      { id: "too-small", color: "wild", face },
      number("spare", "blue"),
    ]
    const before = structuredClone(game)
    expect(projectPlayerGame(game, context, "c").playableCardIds).not.toContain(
      "too-small"
    )
    expect(
      playCards(game, context, "c", {
        cardIds: ["too-small"],
        chosenColor: "red",
      })
    ).toMatchObject({ ok: false, error: { code: "draw-stack-too-low" } })
    expect(game).toEqual(before)
  })

  it("accepts a regular +10 response without reversing again", () => {
    const { game, context } = setup()
    expect(
      playCards(game, context, "a", {
        cardIds: [reverseTen(1).id],
        chosenColor: "red",
      }).ok
    ).toBe(true)
    game.handsByPlayerId.c = [
      {
        id: "regular-ten",
        color: "wild",
        face: { kind: "wild-draw", count: 10 },
      },
      number("spare", "blue"),
    ]
    expect(
      playCards(game, context, "c", {
        cardIds: ["regular-ten"],
        chosenColor: "blue",
      }).ok
    ).toBe(true)
    expect(game.direction).toBe(-1)
    expect(game.drawStack).toEqual({
      amount: 20,
      minimum: 10,
      targetPlayerId: "b",
    })
  })

  it("allows both Reverse +10 copies together and reverses twice", () => {
    const { game, context } = setup()
    game.handsByPlayerId.a.push(reverseTen(2))
    expect(
      playCards(game, context, "a", {
        cardIds: [reverseTen(1).id, reverseTen(2).id],
        chosenColor: "red",
      }).ok
    ).toBe(true)
    expect(game.direction).toBe(1)
    expect(game.drawStack).toEqual({
      amount: 20,
      minimum: 10,
      targetPlayerId: "b",
    })
  })

  it.each([
    { kind: "wild-reverse-draw", count: 4 },
    { kind: "wild-draw", count: 10 },
  ] as const)("keeps $kind +$count in a separate play group", (face) => {
    const { game, context } = setup()
    game.handsByPlayerId.a.push({ id: "other", color: "wild", face })
    const before = structuredClone(game)
    expect(
      playCards(game, context, "a", {
        cardIds: [reverseTen(1).id, "other"],
        chosenColor: "red",
      })
    ).toMatchObject({ ok: false, error: { code: "multi-card-group-mismatch" } })
    expect(game).toEqual(before)
  })

  it("stops a Reverse +10 pickup at 26 cards and reserves all 26 for the last gift", () => {
    const { game, context } = setup()
    game.handsByPlayerId.c = Array.from({ length: 23 }, (_, i) =>
      number(`c-${i}`, "blue")
    )
    expect(
      playCards(game, context, "a", {
        cardIds: [reverseTen(1).id],
        chosenColor: "red",
      }).ok
    ).toBe(true)
    const drawPileCount = game.drawPile.length
    expect(takeDrawPenalty(game, context, "c").ok).toBe(true)
    expect(game.eliminatedPlayerIds).toContain("c")
    expect(game.drawPile).toHaveLength(drawPileCount - 3)
    expect(game.handsByPlayerId.c).toHaveLength(0)
    expect(game.lastGifts[0]?.playerId).toBe("c")
    expect(projectPlayerGame(game, context, "c").lastGiftCards).toHaveLength(26)
  })
})

function reverseTen(copy: number): Card {
  return {
    id: `wild:wild-reverse-draw10:${copy}`,
    color: "wild",
    face: { kind: "wild-reverse-draw", count: 10 },
  }
}

function number(id: string, color: Card["color"]): Card {
  return { id, color, face: { kind: "number", value: 1 } }
}

function setup(count = 3) {
  const context: GameContext = {
    players: Array.from({ length: count }, (_, seat) => ({
      id: String.fromCharCode(97 + seat),
      name: String.fromCharCode(65 + seat),
      seat,
      ready: true,
      connected: true,
      joinedAt: "2026-10-03T00:00:00.000Z",
      lastSeenAt: "2026-10-03T00:00:00.000Z",
    })),
    houseRules: createDefaultHouseRules(),
  }
  const game = createGame(context)
  game.turnPlayerId = "a"
  game.direction = 1
  game.currentColor = "red"
  game.discardPile = [number("top", "red")]
  game.drawPile = Array.from({ length: 30 }, (_, i) =>
    number(`deck-${i}`, "green")
  )
  game.handsByPlayerId = Object.fromEntries(
    context.players.map(({ id }) => [
      id,
      [number(`${id}-red`, "red"), number(`${id}-blue`, "blue")],
    ])
  )
  game.handsByPlayerId.a = [reverseTen(1), number("a-spare", "blue")]
  return { game, context }
}
