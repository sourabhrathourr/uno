import { afterEach, describe, expect, it, vi } from "vitest"
import {
  offerBlindTrade,
  respondBlindTrade,
  cancelBlindTrade,
  resolveLastGift,
  settlePartyChoices,
  createDefaultHouseRules,
  createGame,
  drawOne,
  drawRouletteCard,
  takeDrawPenalty,
  playCards,
  stageCards,
  endTurn,
  catchUno,
  supportPlayer,
  voteKickPlayer,
  projectPublicGame,
  projectPlayerGame,
  projectSpectatorView,
  projectSupportView,
  type Card,
  type GameContext,
  type GameState,
} from "./index"

afterEach(() => vi.useRealTimers())

function setup(count = 4) {
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
  game.handsByPlayerId = Object.fromEntries(
    context.players.map(({ id }) => [
      id,
      [number(`${id}-red`, "red"), number(`${id}-blue`, "blue")],
    ])
  )
  game.drawPile = Array.from({ length: 30 }, (_, i) =>
    number(`deck-${i}`, "green")
  )
  game.discardPile = [number("top", "red")]
  game.currentColor = "red"
  game.knockedOutCards = []
  game.events = []
  return { context, game }
}

function number(id: string, color: Card["color"] = "blue"): Card {
  return { id, color, face: { kind: "number", value: 1 } }
}

function allCards(game: GameState) {
  return [
    ...Object.values(game.handsByPlayerId).flat(),
    ...game.drawPile,
    ...game.discardPile,
    ...game.knockedOutCards,
    ...game.lastGifts.flatMap((gift) => gift.cards),
    ...(game.pendingChoice?.drawnCards ?? []),
  ]
    .map((card) => card.id)
    .sort()
}

function knockOut(game: GameState, context: GameContext, playerId = "a") {
  game.handsByPlayerId[playerId] = Array.from({ length: 25 }, (_, i) =>
    number(`${playerId}-frozen-${i}`)
  )
  game.turnPlayerId = playerId
  const cards = allCards(game)
  expect(drawOne(game, context, playerId).ok).toBe(true)
  expect(allCards(game)).toEqual(cards)
  return game.lastGifts[0]!
}

describe("blind trades", () => {
  it("swaps exactly one card in private, spends both tokens, and preserves the turn", () => {
    const { game, context } = setup()
    const all = allCards(game)
    game.stagedPlay = { playerId: "a", kind: "play", cardIds: ["a-red"] }
    expect(
      offerBlindTrade(game, context, "a", {
        cardId: "a-blue",
        targetPlayerId: "b",
      }).ok
    ).toBe(true)
    expect(game.stagedPlay).toBeNull()
    const offer = game.tradeOffer!
    expect(projectPublicGame(game, context).tradeOffer).not.toHaveProperty(
      "cardId"
    )
    expect(projectPlayerGame(game, context, "a").offeredTradeCardId).toBe(
      "a-blue"
    )
    expect(projectPlayerGame(game, context, "b").offeredTradeCardId).toBeNull()
    expect(
      respondBlindTrade(game, context, "b", {
        offerId: offer.id,
        accept: true,
        cardId: "b-red",
      }).ok
    ).toBe(true)
    expect(game.handsByPlayerId.a?.map((card) => card.id)).toEqual([
      "a-red",
      "b-red",
    ])
    expect(game.handsByPlayerId.b?.map((card) => card.id)).toEqual([
      "a-blue",
      "b-blue",
    ])
    expect(game.tradeUsedPlayerIds).toEqual(["a", "b"])
    expect(projectPlayerGame(game, context, "a").partyReceipt).toMatchObject({
      kind: "trade",
      card: { id: "b-red" },
      fromPlayerId: "b",
    })
    expect(projectPlayerGame(game, context, "b").partyReceipt).toMatchObject({
      kind: "trade",
      card: { id: "a-blue" },
      fromPlayerId: "a",
    })
    expect(projectPlayerGame(game, context, "c").partyReceipt).toBeNull()
    expect(projectPublicGame(game, context)).not.toHaveProperty(
      "partyReceiptsByPlayerId"
    )
    expect(game.turnPlayerId).toBe("a")
    expect(game.currentColor).toBe("red")
    expect(game.discardPile).toHaveLength(1)
    expect(allCards(game)).toEqual(all)
    expect(JSON.stringify(game.events)).not.toContain("a-blue")
    expect(JSON.stringify(game.events)).not.toContain("b-red")
    expect(
      playCards(game, context, "a", { cardIds: ["b-red"], declaredUno: true })
        .ok
    ).toBe(true)
    expect(game.turnPlayerId).toBe("b")
    expect(projectPlayerGame(game, context, "b").canOfferTrade).toBe(false)
  })

  it.each([
    "not-turn",
    "one-card",
    "drawn",
    "stack",
    "roulette",
    "spent",
    "disconnected",
  ])("rejects an offer when %s", (reason) => {
    const { game, context } = setup()
    if (reason === "not-turn") game.turnPlayerId = "b"
    if (reason === "one-card") game.handsByPlayerId.a = [number("a-blue")]
    if (reason === "drawn") game.drawnThisTurnPlayerId = "a"
    if (reason === "stack")
      game.drawStack = { amount: 2, minimum: 2, targetPlayerId: "a" }
    if (reason === "roulette")
      game.pendingChoice = {
        type: "roulette-draw",
        playerId: "a",
        color: "red",
        drawnCards: [],
      }
    if (reason === "spent") game.tradeUsedPlayerIds = ["a"]
    if (reason === "disconnected") context.players[0]!.connected = false
    const before = structuredClone(game)
    expect(
      offerBlindTrade(game, context, "a", {
        cardId: "a-blue",
        targetPlayerId: "b",
      }).ok
    ).toBe(false)
    expect(game).toEqual(before)
  })

  it.each(["self", "one-card", "spent", "inactive", "disconnected", "missing"])(
    "rejects an ineligible target: %s",
    (reason) => {
      const { game, context } = setup()
      let target = "b"
      if (reason === "self") target = "a"
      if (reason === "missing") target = "unknown"
      if (reason === "one-card") game.handsByPlayerId.b = [number("b-red")]
      if (reason === "spent") game.tradeUsedPlayerIds = ["b"]
      if (reason === "inactive") game.eliminatedPlayerIds = ["b"]
      if (reason === "disconnected") context.players[1]!.connected = false
      expect(
        offerBlindTrade(game, context, "a", {
          cardId: "a-blue",
          targetPlayerId: target,
        }).ok
      ).toBe(false)
      expect(game.tradeOffer).toBeNull()
      expect(game.tradeOfferedThisTurn).toBe(false)
    }
  )

  it("does not mutate the offer for forged cards, stale ids, or another player's reply", () => {
    const { game, context } = setup()
    expect(
      offerBlindTrade(game, context, "a", {
        cardId: "b-red",
        targetPlayerId: "b",
      }).ok
    ).toBe(false)
    offerBlindTrade(game, context, "a", {
      cardId: "a-blue",
      targetPlayerId: "b",
    })
    const before = structuredClone(game)
    for (const [id, offerId, cardId] of [
      ["c", game.tradeOffer!.id, "c-red"],
      ["b", "old", "b-red"],
      ["b", game.tradeOffer!.id, "a-red"],
    ]) {
      expect(
        respondBlindTrade(game, context, id!, {
          offerId: offerId!,
          accept: true,
          cardId,
        }).ok
      ).toBe(false)
      expect(game).toEqual(before)
    }
    expect(
      cancelBlindTrade(game, context, "c", { offerId: game.tradeOffer!.id }).ok
    ).toBe(false)
  })

  it.each(["decline", "cancel", "timeout"])(
    "returns both cards without spending tokens on %s",
    (reason) => {
      vi.useFakeTimers()
      const { game, context } = setup()
      const all = allCards(game)
      offerBlindTrade(game, context, "a", {
        cardId: "a-blue",
        targetPlayerId: "b",
      })
      const id = game.tradeOffer!.id
      if (reason === "decline")
        respondBlindTrade(game, context, "b", { offerId: id, accept: false })
      if (reason === "cancel")
        cancelBlindTrade(game, context, "a", { offerId: id })
      if (reason === "timeout") {
        vi.advanceTimersByTime(10_000)
        settlePartyChoices(game, context)
      }
      expect(game.tradeOffer).toBeNull()
      expect(game.tradeUsedPlayerIds).toEqual([])
      expect(game.turnPlayerId).toBe("a")
      expect(allCards(game)).toEqual(all)
      expect(
        offerBlindTrade(game, context, "a", {
          cardId: "a-blue",
          targetPlayerId: "b",
        }).ok
      ).toBe(false)
      expect(playCards(game, context, "a", { cardIds: ["a-red"] }).ok).toBe(
        true
      )
      expect(projectPlayerGame(game, context, "b").canOfferTrade).toBe(true)
    }
  )

  it.each(["play", "draw", "stage"])(
    "cancels the offer before a %s action",
    (action) => {
      const { game, context } = setup()
      const all = allCards(game)
      offerBlindTrade(game, context, "a", {
        cardId: "a-blue",
        targetPlayerId: "b",
      })
      const id = game.tradeOffer!.id
      if (action === "play")
        playCards(game, context, "a", { cardIds: ["a-red"] })
      if (action === "draw") drawOne(game, context, "a")
      if (action === "stage")
        stageCards(game, context, "a", { cardIds: ["a-red"] })
      expect(game.tradeOffer).toBeNull()
      expect(
        respondBlindTrade(game, context, "b", {
          offerId: id,
          accept: true,
          cardId: "b-red",
        }).ok
      ).toBe(false)
      expect(allCards(game)).toEqual(all)
    }
  )

  it("cancels on disconnect and rejects acceptance at the exact deadline", () => {
    vi.useFakeTimers()
    const { game, context } = setup()
    offerBlindTrade(game, context, "a", {
      cardId: "a-blue",
      targetPlayerId: "b",
    })
    vi.advanceTimersByTime(10_000)
    expect(
      respondBlindTrade(game, context, "b", {
        offerId: game.tradeOffer!.id,
        accept: true,
        cardId: "b-red",
      }).ok
    ).toBe(false)
    context.players[1]!.connected = false
    expect(settlePartyChoices(game, context)).toBe(true)
    expect(game.tradeOffer).toBeNull()
  })
})

describe("last gifts", () => {
  it("reserves all 26 cards privately, including the knockout card", () => {
    const { game, context } = setup()
    const gift = knockOut(game, context)
    expect(gift.cards).toHaveLength(26)
    expect(gift.cards[25]?.id).toBe("deck-0")
    expect(game.knockedOutCards).toEqual([])
    expect(game.eliminatedPlayerIds).toEqual(["a"])
    expect(projectPlayerGame(game, context, "a").lastGiftCards).toHaveLength(26)
    expect(projectPlayerGame(game, context, "b").lastGiftCards).toEqual([])
    expect(projectPublicGame(game, context).lastGift).not.toHaveProperty(
      "cards"
    )
    expect(projectSpectatorView(game, context, "a", "b")).toBeNull()
    expect(supportPlayer(game, context, "a", "b").ok).toBe(false)
  })

  it("gives a power card without firing it, clears UNO, and keeps the donor out", () => {
    const { game, context } = setup()
    game.handsByPlayerId.b = [number("b-last")]
    game.unoDeclaredPlayerIds = ["b"]
    const gift = knockOut(game, context)
    const power: Card = {
      id: gift.cards[0]!.id,
      color: "wild",
      face: { kind: "wild-draw", count: 10 },
    }
    gift.cards[0] = power
    const all = allCards(game)
    const discard = [...game.discardPile]
    expect(
      resolveLastGift(game, context, "a", {
        giftId: gift.id,
        cardId: power.id,
        targetPlayerId: "b",
      }).ok
    ).toBe(true)
    expect(game.handsByPlayerId.b).toEqual([number("b-last"), power])
    expect(projectPlayerGame(game, context, "b").partyReceipt).toMatchObject({
      kind: "gift",
      card: { id: power.id },
      fromPlayerId: "a",
    })
    expect(game.drawStack).toBeNull()
    expect(game.currentColor).toBe("red")
    expect(game.discardPile).toEqual(discard)
    expect(game.eliminatedPlayerIds).toEqual(["a"])
    expect(game.unoDeclaredPlayerIds).not.toContain("b")
    expect(game.lastGifts).toEqual([])
    expect(game.knockedOutCards).toHaveLength(25)
    expect(allCards(game)).toEqual(all)
    expect(projectPlayerGame(game, context, "b").canDraw).toBe(true)
    expect(supportPlayer(game, context, "a", "b").ok).toBe(true)
    expect(projectSupportView(game, context, "a")).toMatchObject({
      canOfferTrade: false,
      lastGiftCards: [],
    })
  })

  it("pauses every gameplay command until the gift resolves", () => {
    const { game, context } = setup()
    knockOut(game, context)
    const before = structuredClone(game)
    const results = [
      playCards(game, context, "b", { cardIds: ["b-red"] }),
      stageCards(game, context, "b", { cardIds: ["b-red"] }),
      drawOne(game, context, "b"),
      endTurn(game, context, "b"),
      takeDrawPenalty(game, context, "b"),
      drawRouletteCard(game, context, "b"),
      catchUno(game, context, "b", { targetPlayerId: "c" }),
      offerBlindTrade(game, context, "b", {
        cardId: "b-red",
        targetPlayerId: "c",
      }),
    ]
    expect(results.every((result) => !result.ok)).toBe(true)
    expect(game).toEqual(before)
    expect(projectPlayerGame(game, context, "b")).toMatchObject({
      canDraw: false,
      canEndTurn: false,
      canTakeDrawPenalty: false,
      canOfferTrade: false,
      playableCardIds: [],
      catchablePlayerIds: [],
    })
  })

  it("rejects full hands and forged choices; allows 24 to become 25", () => {
    const { game, context } = setup()
    game.handsByPlayerId.b = Array.from({ length: 25 }, (_, i) =>
      number(`b-${i}`)
    )
    game.handsByPlayerId.c = Array.from({ length: 24 }, (_, i) =>
      number(`c-${i}`)
    )
    const gift = knockOut(game, context)
    const before = structuredClone(game)
    for (const [donor, id, cardId, targetPlayerId] of [
      ["a", gift.id, gift.cards[0]!.id, "b"],
      ["a", gift.id, "forged", "c"],
      ["b", gift.id, gift.cards[0]!.id, "c"],
      ["a", "old", gift.cards[0]!.id, "c"],
      ["a", gift.id, gift.cards[0]!.id, "a"],
    ]) {
      expect(
        resolveLastGift(game, context, donor!, {
          giftId: id!,
          cardId,
          targetPlayerId,
        }).ok
      ).toBe(false)
      expect(game).toEqual(before)
    }
    expect(
      resolveLastGift(game, context, "a", {
        giftId: gift.id,
        cardId: gift.cards[25]!.id,
        targetPlayerId: "c",
      }).ok
    ).toBe(true)
    expect(game.handsByPlayerId.c).toHaveLength(25)
    expect(game.eliminatedPlayerIds).not.toContain("c")
  })

  it.each(["skip", "timeout", "disconnect"])(
    "recycles the frozen hand on %s and resumes play",
    (reason) => {
      vi.useFakeTimers()
      const { game, context } = setup()
      const gift = knockOut(game, context)
      const all = allCards(game)
      if (reason === "skip")
        expect(
          resolveLastGift(game, context, "a", { giftId: gift.id }).ok
        ).toBe(true)
      if (reason === "timeout") {
        vi.advanceTimersByTime(10_000)
        expect(
          resolveLastGift(game, context, "a", {
            giftId: gift.id,
            cardId: gift.cards[0]!.id,
            targetPlayerId: "b",
          }).ok
        ).toBe(false)
        expect(settlePartyChoices(game, context)).toBe(true)
      }
      if (reason === "disconnect") {
        context.players[0]!.connected = false
        settlePartyChoices(game, context)
      }
      expect(game.lastGifts).toEqual([])
      expect(game.knockedOutCards).toHaveLength(26)
      expect(allCards(game)).toEqual(all)
      expect(playCards(game, context, "b", { cardIds: ["b-red"] }).ok).toBe(
        true
      )
    }
  )

  it("caps a stacked pickup at 26, reserving the complete frozen hand", () => {
    const { game, context } = setup()
    game.handsByPlayerId.a = Array.from({ length: 23 }, (_, i) =>
      number(`a-${i}`)
    )
    game.drawStack = { amount: 10, minimum: 10, targetPlayerId: "a" }
    const all = allCards(game)
    expect(takeDrawPenalty(game, context, "a").ok).toBe(true)
    expect(game.lastGifts[0]?.cards).toHaveLength(26)
    expect(game.drawPile).toHaveLength(27)
    expect(game.statsByPlayerId.a?.penaltyCardsTaken).toBe(3)
    expect(allCards(game)).toEqual(all)
  })

  it("caps an UNO catch at 26 and lets the knockout card be gifted", () => {
    const { game, context } = setup()
    game.handsByPlayerId.b = Array.from({ length: 25 }, (_, i) =>
      number(`b-${i}`)
    )
    game.unoVulnerablePlayerIds = ["b"]
    expect(catchUno(game, context, "a", { targetPlayerId: "b" }).ok).toBe(true)
    expect(game.lastGifts[0]?.cards).toHaveLength(26)
    expect(game.drawPile).toHaveLength(29)
  })

  it("gives queued knockouts ten seconds each, in seat order", () => {
    vi.useFakeTimers()
    const { game, context } = setup(5)
    game.handsByPlayerId.b = Array.from({ length: 26 }, (_, i) =>
      number(`b-${i}`)
    )
    knockOut(game, context)
    expect(game.lastGifts.map((gift) => gift.playerId)).toEqual(["a", "b"])
    expect(game.lastGifts[1]?.expiresAt).toBeNull()
    expect(projectPlayerGame(game, context, "b").lastGiftCards).toEqual([])
    vi.advanceTimersByTime(10_000)
    settlePartyChoices(game, context)
    expect(game.lastGifts[0]?.playerId).toBe("b")
    expect(game.lastGifts[0]?.expiresAt).toBe(Date.now() + 10_000)
    expect(projectPlayerGame(game, context, "b").lastGiftCards).toHaveLength(26)
  })

  it("ends with no gift when only one player survives", () => {
    const { game, context } = setup(2)
    knockOut(game, context)
    expect(game.lastGifts).toEqual([])
    expect(game.winnerPlayerId).toBe("b")
    expect(game.finishedAt).not.toBeNull()
  })

  it("does not give a last gift to a normal finisher or a kicked player", () => {
    const { game, context } = setup()
    game.handsByPlayerId.a = [number("a-last", "red")]
    expect(playCards(game, context, "a", { cardIds: ["a-last"] }).ok).toBe(true)
    expect(voteKickPlayer(game, context, "b").ok).toBe(true)
    expect(game.lastGifts).toEqual([])
  })

  it("flushes reserved gifts if a kick finishes the match", () => {
    const { game, context } = setup(3)
    knockOut(game, context)
    const all = allCards(game)
    expect(voteKickPlayer(game, context, "c").ok).toBe(true)
    expect(game.lastGifts).toEqual([])
    expect(game.winnerPlayerId).toBe("b")
    expect(allCards(game)).toEqual(all)
  })
})
