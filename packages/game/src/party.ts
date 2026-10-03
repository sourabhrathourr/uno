import type { Card } from "./cards"
import type {
  CancelBlindTradeInput,
  GameContext,
  GameEventType,
  GameState,
  OfferBlindTradeInput,
  ResolveLastGiftInput,
  RespondBlindTradeInput,
} from "./game"
import type { CommandResult } from "./realtime"

export const PARTY_CHOICE_MS = 10_000

export function partyPlayerActive(game: GameState, id: string): boolean {
  return (
    game.playerOrder.includes(id) &&
    !game.eliminatedPlayerIds.includes(id) &&
    !game.voteKickedPlayerIds.includes(id) &&
    !game.waitingPlayerIds.includes(id) &&
    !game.winnerPlacements.some((placement) => placement.playerId === id)
  )
}

function connected(context: GameContext, id: string) {
  return context.players.some((player) => player.id === id && player.connected)
}

export function tradeTargets(
  game: GameState,
  context: GameContext,
  id: string
) {
  return game.playerOrder.filter(
    (target) =>
      target !== id &&
      partyPlayerActive(game, target) &&
      connected(context, target) &&
      !game.tradeUsedPlayerIds.includes(target) &&
      (game.handsByPlayerId[target]?.length ?? 0) >= 2
  )
}

export function canOfferTrade(
  game: GameState,
  context: GameContext,
  id: string
) {
  return (
    !game.finishedAt &&
    game.turnPlayerId === id &&
    partyPlayerActive(game, id) &&
    connected(context, id) &&
    !game.drawStack &&
    !game.pendingChoice &&
    !game.lastGifts.length &&
    !game.drawnThisTurnPlayerId &&
    !game.tradeOffer &&
    !game.tradeOfferedThisTurn &&
    !game.tradeUsedPlayerIds.includes(id) &&
    (game.handsByPlayerId[id]?.length ?? 0) >= 2 &&
    tradeTargets(game, context, id).length > 0
  )
}

export function giftTargets(game: GameState, context: GameContext) {
  return game.playerOrder.filter(
    (id) =>
      partyPlayerActive(game, id) &&
      connected(context, id) &&
      (game.handsByPlayerId[id]?.length ?? 0) <
        context.houseRules.mercyHandLimit
  )
}

function event(
  game: GameState,
  type: GameEventType,
  playerId: string,
  message: string,
  targetPlayerId?: string
) {
  game.events.push({
    id: newId(),
    type,
    playerId,
    targetPlayerId,
    message,
    createdAt: new Date().toISOString(),
  })
  if (game.events.length > 40) game.events.splice(0, game.events.length - 40)
}

function name(context: GameContext, id: string) {
  return context.players.find((player) => player.id === id)?.name ?? "Player"
}

function newId() {
  return `${Date.now()}:${Math.random().toString(36).slice(2, 12)}`
}

function fail(code: string, message: string): CommandResult<GameState> {
  return { ok: false, error: { code, message } }
}

export function offerBlindTrade(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: OfferBlindTradeInput
): CommandResult<GameState> {
  if (
    !input ||
    typeof input.cardId !== "string" ||
    typeof input.targetPlayerId !== "string"
  )
    return fail("invalid-party-input", "Choose a valid card and player.")
  if (!canOfferTrade(game, context, playerId)) {
    return fail(
      "trade-unavailable",
      "You can offer one trade before drawing or playing on your turn."
    )
  }
  if (!tradeTargets(game, context, playerId).includes(input.targetPlayerId)) {
    return fail(
      "invalid-trade-target",
      "Choose a player with an unused trade and at least two cards."
    )
  }
  if (
    !game.handsByPlayerId[playerId]?.some((card) => card.id === input.cardId)
  ) {
    return fail("card-not-in-hand", "Choose a card from your hand.")
  }
  game.stagedPlay = null
  game.tradeOfferedThisTurn = true
  game.tradeOffer = {
    id: newId(),
    playerId,
    targetPlayerId: input.targetPlayerId,
    cardId: input.cardId,
    expiresAt: Date.now() + PARTY_CHOICE_MS,
  }
  event(
    game,
    "trade-offered",
    playerId,
    `${name(context, playerId)} offered ${name(context, input.targetPlayerId)} a blind trade.`,
    input.targetPlayerId
  )
  return { ok: true, data: game }
}

export function cancelTrade(game: GameState, _context: GameContext) {
  const offer = game.tradeOffer
  if (!offer) return
  game.tradeOffer = null
  event(
    game,
    "trade-cancelled",
    offer.playerId,
    "The blind trade ended. No cards changed hands.",
    offer.targetPlayerId
  )
}

export function cancelBlindTrade(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: CancelBlindTradeInput
): CommandResult<GameState> {
  if (!input || typeof input.offerId !== "string")
    return fail("invalid-party-input", "Choose a valid card and player.")
  if (
    !game.tradeOffer ||
    game.tradeOffer.id !== input.offerId ||
    game.tradeOffer.playerId !== playerId
  ) {
    return fail("trade-not-found", "That trade is no longer yours to cancel.")
  }
  cancelTrade(game, context)
  return { ok: true, data: game }
}

export function respondBlindTrade(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: RespondBlindTradeInput
): CommandResult<GameState> {
  if (
    !input ||
    typeof input.offerId !== "string" ||
    typeof input.accept !== "boolean" ||
    (input.accept && typeof input.cardId !== "string")
  )
    return fail("invalid-party-input", "Choose a valid card and player.")
  const offer = game.tradeOffer
  if (
    !offer ||
    offer.id !== input.offerId ||
    offer.targetPlayerId !== playerId ||
    Date.now() >= offer.expiresAt
  ) {
    return fail("trade-not-found", "That trade is no longer available.")
  }
  if (!input.accept) {
    cancelTrade(game, context)
    return { ok: true, data: game }
  }
  if (
    game.turnPlayerId !== offer.playerId ||
    game.lastGifts.length ||
    game.pendingChoice ||
    game.drawStack ||
    game.drawnThisTurnPlayerId ||
    !partyPlayerActive(game, offer.playerId) ||
    !tradeTargets(game, context, offer.playerId).includes(playerId) ||
    !connected(context, offer.playerId)
  ) {
    return fail("trade-unavailable", "That trade is no longer available.")
  }
  const fromHand = game.handsByPlayerId[offer.playerId] ?? []
  const toHand = game.handsByPlayerId[playerId] ?? []
  const fromIndex = fromHand.findIndex((card) => card.id === offer.cardId)
  const toIndex = toHand.findIndex((card) => card.id === input.cardId)
  if (
    fromHand.length < 2 ||
    toHand.length < 2 ||
    fromIndex < 0 ||
    toIndex < 0
  ) {
    return fail("card-not-in-hand", "Choose a card from your hand.")
  }
  const fromCard = fromHand[fromIndex]!
  const toCard = toHand[toIndex]!
  fromHand[fromIndex] = toHand[toIndex]!
  toHand[toIndex] = fromCard
  game.partyReceiptsByPlayerId[offer.playerId] = {
    id: newId(),
    kind: "trade",
    card: { ...toCard },
    fromPlayerId: playerId,
    createdAt: Date.now(),
  }
  game.partyReceiptsByPlayerId[playerId] = {
    id: newId(),
    kind: "trade",
    card: { ...fromCard },
    fromPlayerId: offer.playerId,
    createdAt: Date.now(),
  }
  game.tradeUsedPlayerIds.push(offer.playerId, playerId)
  game.tradeOffer = null
  game.stagedPlay = null
  event(
    game,
    "trade-completed",
    offer.playerId,
    `${name(context, offer.playerId)} and ${name(context, playerId)} traded one hidden card.`,
    playerId
  )
  return { ok: true, data: game }
}

export function queueLastGift(
  game: GameState,
  context: GameContext,
  playerId: string,
  cards: Card[]
) {
  if (
    game.playerOrder.filter((id) => partyPlayerActive(game, id)).length < 2 ||
    !connected(context, playerId) ||
    !giftTargets(game, context).length
  ) {
    game.knockedOutCards.push(...cards)
    return
  }
  game.lastGifts.push({ id: newId(), playerId, cards, expiresAt: null })
  event(
    game,
    "last-gift-ready",
    playerId,
    `${name(context, playerId)} gets one last gift.`
  )
}

function finishGift(game: GameState, context: GameContext, skipped: boolean) {
  const gift = game.lastGifts.shift()
  if (!gift) return
  game.knockedOutCards.push(...gift.cards)
  if (skipped)
    event(
      game,
      "last-gift-skipped",
      gift.playerId,
      `${name(context, gift.playerId)} left without a gift.`
    )
}

export function expirePartyChoices(
  game: GameState,
  context: GameContext,
  now = Date.now()
): boolean {
  let changed = false
  const offer = game.tradeOffer
  if (
    offer &&
    (now >= offer.expiresAt ||
      game.turnPlayerId !== offer.playerId ||
      !connected(context, offer.playerId) ||
      !connected(context, offer.targetPlayerId) ||
      !partyPlayerActive(game, offer.playerId) ||
      !partyPlayerActive(game, offer.targetPlayerId) ||
      game.lastGifts.length > 0 ||
      game.finishedAt)
  ) {
    cancelTrade(game, context)
    changed = true
  }
  while (game.lastGifts.length) {
    const gift = game.lastGifts[0]!
    if (
      game.finishedAt ||
      game.playerOrder.filter((id) => partyPlayerActive(game, id)).length < 2 ||
      !connected(context, gift.playerId) ||
      !giftTargets(game, context).length ||
      (gift.expiresAt !== null && now >= gift.expiresAt)
    ) {
      finishGift(game, context, true)
      changed = true
      continue
    }
    if (gift.expiresAt === null) {
      gift.expiresAt = now + PARTY_CHOICE_MS
      changed = true
    }
    break
  }
  return changed
}

export function giveLastGift(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: ResolveLastGiftInput
): CommandResult<GameState> {
  if (
    !input ||
    typeof input.giftId !== "string" ||
    (input.cardId !== undefined && typeof input.cardId !== "string") ||
    (input.targetPlayerId !== undefined &&
      typeof input.targetPlayerId !== "string")
  )
    return fail("invalid-party-input", "Choose a valid card and player.")
  const gift = game.lastGifts[0]
  if (
    !gift ||
    gift.id !== input.giftId ||
    gift.playerId !== playerId ||
    gift.expiresAt === null ||
    Date.now() >= gift.expiresAt
  ) {
    return fail("gift-not-found", "That last gift is no longer available.")
  }
  if (input.cardId === undefined && input.targetPlayerId === undefined) {
    finishGift(game, context, true)
    expirePartyChoices(game, context)
    return { ok: true, data: game }
  }
  if (
    !input.targetPlayerId ||
    !giftTargets(game, context).includes(input.targetPlayerId)
  ) {
    return fail(
      "invalid-gift-target",
      "Choose a player who can take one more card."
    )
  }
  const index = gift.cards.findIndex((card) => card.id === input.cardId)
  if (index < 0)
    return fail("invalid-gift-card", "Choose a card from your frozen hand.")
  const card = gift.cards.splice(index, 1)[0]!
  const hand = game.handsByPlayerId[input.targetPlayerId]!
  hand.push(card)
  game.partyReceiptsByPlayerId[input.targetPlayerId] = {
    id: newId(),
    kind: "gift",
    card: { ...card },
    fromPlayerId: playerId,
    createdAt: Date.now(),
  }
  game.unoDeclaredPlayerIds = game.unoDeclaredPlayerIds.filter(
    (id) => id !== input.targetPlayerId
  )
  game.unoVulnerablePlayerIds = game.unoVulnerablePlayerIds.filter(
    (id) => id !== input.targetPlayerId
  )
  const stats = game.statsByPlayerId[input.targetPlayerId]
  if (stats) stats.peakHandSize = Math.max(stats.peakHandSize, hand.length)
  event(
    game,
    "last-gift-given",
    playerId,
    `${name(context, playerId)} left ${name(context, input.targetPlayerId)} one last card.`,
    input.targetPlayerId
  )
  finishGift(game, context, false)
  expirePartyChoices(game, context)
  return { ok: true, data: game }
}
