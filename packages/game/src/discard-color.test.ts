import { describe, expect, it } from "vitest"

import {
  createDefaultHouseRules,
  createGame,
  playCards,
  stageCards,
  type Card,
  type GameContext,
} from "./index"

const context: GameContext = {
  players: ["a", "b", "c"].map((id, seat) => ({
    id,
    name: id,
    seat,
    ready: true,
    connected: true,
    joinedAt: "2026-10-03T00:00:00.000Z",
    lastSeenAt: "2026-10-03T00:00:00.000Z",
  })),
  houseRules: createDefaultHouseRules(),
}

describe("discard color", () => {
  it.each([1, 2, 3])(
    "clears %i same-color discard cards with the other cards of that color",
    (count) => {
      const cards = [
        ...Array.from({ length: count }, (_, index) =>
          card(`discard-${index}`, "red", { kind: "discard-color" })
        ),
        card("red-number", "red", { kind: "number", value: 5 }),
        card("red-draw", "red", { kind: "draw", count: 4 }),
        card("red-reverse", "red", { kind: "reverse" }),
      ]
      const spare = card("blue-number", "blue", { kind: "number", value: 1 })
      const game = discardGame([...cards, spare])

      const staged = stageCards(game, context, "a", {
        cardIds: cards.map((card) => card.id),
      })

      expect(staged.ok).toBe(true)
      expect(game.stagedPlay?.cardIds).toEqual(cards.map((card) => card.id))
      expect(game.handsByPlayerId.a).toEqual([...cards, spare])

      const played = playCards(game, context, "a", {
        cardIds: [cards[0].id],
        discardCardIds: cards.slice(1).map((card) => card.id),
        topCardId: "red-reverse",
      })

      expect(played.ok).toBe(true)
      expect(game.handsByPlayerId.a).toEqual([spare])
      expect(game.discardPile).toHaveLength(cards.length + 1)
      expect(game.discardPile.slice(1)).toEqual(expect.arrayContaining(cards))
      expect(game.discardPile.at(-1)?.id).toBe("red-reverse")
      expect(game.currentColor).toBe("red")
      expect(game.drawStack).toBeNull()
      expect(game.direction).toBe(1)
      expect(game.turnPlayerId).toBe("b")
      expect(game.stagedPlay).toBeNull()
      expect(game.statsByPlayerId.a.cardsPlayed).toBe(cards.length)
      expect(game.unoVulnerablePlayerIds).toContain("a")
    }
  )

  it("can go out by clearing only same-color discard cards", () => {
    const cards = [
      card("discard-1", "red", { kind: "discard-color" }),
      card("discard-2", "red", { kind: "discard-color" }),
      card("discard-3", "red", { kind: "discard-color" }),
    ]
    const game = discardGame(cards)

    expect(
      stageCards(game, context, "a", {
        cardIds: cards.map((card) => card.id),
      }).ok
    ).toBe(true)
    expect(
      playCards(game, context, "a", {
        cardIds: [cards[0].id],
        discardCardIds: cards.slice(1).map((card) => card.id),
        topCardId: cards[2].id,
      }).ok
    ).toBe(true)

    expect(game.handsByPlayerId.a).toEqual([])
    expect(game.winnerPlacements[0]?.playerId).toBe("a")
    expect(game.discardPile.at(-1)).toEqual(cards[2])
  })

  it.each([
    card("blue-discard", "blue", { kind: "discard-color" }),
    card("blue-number", "blue", { kind: "number", value: 5 }),
    card("wild-draw", "wild", { kind: "wild-draw", count: 6 }),
  ])("rejects clearing $id with a red discard card", (extra) => {
    const discard = card("red-discard", "red", { kind: "discard-color" })
    const game = discardGame([discard, extra])
    const before = structuredClone(game)

    expect(
      stageCards(game, context, "a", {
        cardIds: [discard.id, extra.id],
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-discard-card" } })
    expect(
      playCards(game, context, "a", {
        cardIds: [discard.id],
        discardCardIds: [extra.id],
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-discard-card" } })
    expect(game).toEqual(before)
  })

  it("requires the discard card to be staged first", () => {
    const cards = [
      card("red-number", "red", { kind: "number", value: 5 }),
      card("red-discard", "red", { kind: "discard-color" }),
    ]
    const game = discardGame(cards)
    const before = structuredClone(game)

    expect(
      stageCards(game, context, "a", {
        cardIds: cards.map((card) => card.id),
      })
    ).toMatchObject({ ok: false, error: { code: "discard-card-first" } })
    expect(game).toEqual(before)
  })

  it("requires the first discard card to match the pile", () => {
    const cards = [
      card("discard-1", "red", { kind: "discard-color" }),
      card("discard-2", "red", { kind: "discard-color" }),
    ]
    const game = discardGame(cards)
    game.currentColor = "blue"
    game.discardPile = [card("top-blue", "blue", { kind: "number", value: 9 })]
    const before = structuredClone(game)

    expect(
      stageCards(game, context, "a", {
        cardIds: cards.map((card) => card.id),
      })
    ).toMatchObject({ ok: false, error: { code: "not-playable" } })
    expect(game).toEqual(before)
  })

  it("cannot clear discard cards during a draw penalty", () => {
    const cards = [
      card("discard-1", "red", { kind: "discard-color" }),
      card("discard-2", "red", { kind: "discard-color" }),
    ]
    const game = discardGame(cards)
    game.drawStack = { amount: 2, minimum: 2, targetPlayerId: "a" }
    const before = structuredClone(game)

    expect(
      stageCards(game, context, "a", {
        cardIds: cards.map((card) => card.id),
      })
    ).toMatchObject({ ok: false, error: { code: "draw-stack-card-required" } })
    expect(
      playCards(game, context, "a", {
        cardIds: [cards[0].id],
        discardCardIds: [cards[1].id],
      })
    ).toMatchObject({ ok: false, error: { code: "draw-stack-card-required" } })
    expect(game).toEqual(before)
  })
})

function discardGame(hand: Card[]) {
  const game = createGame(context)
  game.turnPlayerId = "a"
  game.currentColor = "red"
  game.discardPile = [card("top-red", "red", { kind: "number", value: 9 })]
  game.handsByPlayerId.a = [...hand]
  return game
}

function card(id: string, color: Card["color"], face: Card["face"]): Card {
  return { id, color, face }
}
