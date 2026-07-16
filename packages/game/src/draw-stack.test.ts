import { describe, expect, it } from "vitest"

import {
  createGame,
  playCards,
  stageCards,
  type Card,
  type GameContext,
  type GameState,
} from "./index"

const context: GameContext = {
  players: [player("a", "A", 1), player("b", "B", 2)],
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

describe("draw stacks", () => {
  it("rejects staging mixed draw-card types against an active penalty", () => {
    const cards = [
      card("red-plus-4", "red", { kind: "draw", count: 4 }),
      card("wild-plus-6", "wild", { kind: "wild-draw", count: 6 }),
      card("wild-plus-10", "wild", { kind: "wild-draw", count: 10 }),
    ]
    const game = drawStackGame(cards)
    const before = structuredClone(game)

    const result = stageCards(game, context, "b", {
      cardIds: cards.map((card) => card.id),
      chosenColor: "red",
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "multi-card-group-mismatch" },
    })
    expect(game).toEqual(before)
  })

  it("rejects playing mixed draw-card types against an active penalty", () => {
    const cards = [
      card("red-plus-4", "red", { kind: "draw", count: 4 }),
      card("wild-plus-6", "wild", { kind: "wild-draw", count: 6 }),
      card("wild-plus-10", "wild", { kind: "wild-draw", count: 10 }),
    ]
    const game = drawStackGame(cards)
    const before = structuredClone(game)

    const result = playCards(game, context, "b", {
      cardIds: cards.map((card) => card.id),
      chosenColor: "red",
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "multi-card-group-mismatch" },
    })
    expect(game).toEqual(before)
  })

  it("treats normal and Wild Reverse +4 cards as separate groups", () => {
    const cards = [
      card("red-plus-4", "red", { kind: "draw", count: 4 }),
      card("wild-reverse-plus-4", "wild", {
        kind: "wild-reverse-draw",
        count: 4,
      }),
    ]
    const game = drawStackGame(cards)

    const result = stageCards(game, context, "b", {
      cardIds: cards.map((card) => card.id),
      chosenColor: "red",
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "multi-card-group-mismatch" },
    })
  })

  it.each([
    {
      cards: [
        card("red-plus-4", "red", { kind: "draw", count: 4 }),
        card("blue-plus-4", "blue", { kind: "draw", count: 4 }),
      ],
      expectedPenalty: 10,
      expectedMinimum: 4,
      label: "multiple normal +4 cards",
    },
    {
      cards: [
        card("wild-plus-10-a", "wild", { kind: "wild-draw", count: 10 }),
        card("wild-plus-10-b", "wild", { kind: "wild-draw", count: 10 }),
      ],
      expectedPenalty: 22,
      expectedMinimum: 10,
      label: "multiple Wild +10 cards",
    },
  ])("accepts $label", ({ cards, expectedPenalty, expectedMinimum }) => {
    const game = drawStackGame(cards)

    const result = playCards(game, context, "b", {
      cardIds: cards.map((card) => card.id),
      chosenColor: "red",
    })

    expect(result.ok).toBe(true)
    expect(game.drawStack).toEqual({
      amount: expectedPenalty,
      minimum: expectedMinimum,
      targetPlayerId: "a",
    })
  })

  it.each([
    {
      card: card("red-plus-4", "red", { kind: "draw", count: 4 }),
      expectedMinimum: 4,
    },
    {
      card: card("wild-plus-6", "wild", { kind: "wild-draw", count: 6 }),
      expectedMinimum: 6,
    },
    {
      card: card("wild-plus-10", "wild", { kind: "wild-draw", count: 10 }),
      expectedMinimum: 10,
    },
  ])(
    "accepts a single +$expectedMinimum response to +2",
    ({ card, expectedMinimum }) => {
      const game = drawStackGame([card])

      const result = playCards(game, context, "b", {
        cardIds: [card.id],
        chosenColor: "red",
      })

      expect(result.ok).toBe(true)
      expect(game.drawStack).toEqual({
        amount: expectedMinimum + 2,
        minimum: expectedMinimum,
        targetPlayerId: "a",
      })
    }
  )
})

function drawStackGame(cards: Card[]): GameState {
  const game = createGame(context)
  game.turnPlayerId = "b"
  game.currentColor = "red"
  game.discardPile = [card("top-plus-2", "red", { kind: "draw", count: 2 })]
  game.drawStack = {
    amount: 2,
    minimum: 2,
    targetPlayerId: "b",
  }
  game.handsByPlayerId.b = [
    ...cards,
    card("spare-number", "blue", { kind: "number", value: 1 }),
  ]
  return game
}

function card(id: string, color: Card["color"], face: Card["face"]): Card {
  return { id, color, face }
}

function player(id: string, name: string, seat: number) {
  const now = "2026-07-16T00:00:00.000Z"
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
