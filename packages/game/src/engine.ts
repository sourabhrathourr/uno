import type { Card, CardFace } from "./cards"
import { createNoMercyDeck, shuffleCards } from "./deck"
import type {
  CatchUnoInput,
  Direction,
  GameContext,
  GameEvent,
  GameState,
  PlayCardsInput,
  PlayColor,
  PlayerGameSnapshot,
  PublicGameSnapshot,
  StageCardsInput,
  SupportEndReason,
  SendAvatarEmojiReactionInput,
  SupportRecap,
  SupportRequest,
} from "./game"
import { AVATAR_REACTION_EMOJIS } from "./reactions"
import type { CommandResult } from "./realtime"

export type CreateGameOptions = {
  /** Turn direction the match opens with. Defaults to clockwise. */
  direction?: Direction
  voteKickedPlayerIds?: string[]
}

export function createGame(
  context: GameContext,
  options: CreateGameOptions = {}
): GameState {
  const playerOrder = context.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((player) => player.id)
  const voteKickedPlayerIds = unique(
    options.voteKickedPlayerIds?.filter((playerId) =>
      playerOrder.includes(playerId)
    ) ?? []
  )
  const voteKickedPlayers = new Set(voteKickedPlayerIds)

  const deck = shuffleCards(createNoMercyDeck())
  const handsByPlayerId: Record<string, Card[]> = {}

  for (const playerId of playerOrder) {
    if (voteKickedPlayers.has(playerId)) {
      handsByPlayerId[playerId] = []
      continue
    }
    handsByPlayerId[playerId] = deck.splice(
      0,
      context.houseRules.startingHandSize
    )
  }

  const discardPile: Card[] = []
  let firstDiscard = deck.shift()
  while (firstDiscard && isPowerCard(firstDiscard)) {
    discardPile.push(firstDiscard)
    firstDiscard = deck.shift()
  }

  if (!firstDiscard) {
    firstDiscard = discardPile.pop() ?? createNoMercyDeck()[0]
  }

  discardPile.push(firstDiscard)

  const game: GameState = {
    matchId: `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    playerOrder,
    direction: options.direction ?? 1,
    currentColor: colorFor(firstDiscard),
    turnPlayerId:
      playerOrder.find((playerId) => !voteKickedPlayers.has(playerId)) ?? null,
    drawPile: deck,
    discardPile,
    handsByPlayerId,
    eliminatedPlayerIds: [],
    voteKickedPlayerIds,
    waitingPlayerIds: [],
    knockedOutCards: [],
    drawStack: null,
    pendingChoice: null,
    unoVulnerablePlayerIds: [],
    unoDeclaredPlayerIds: [],
    drawnThisTurnPlayerId: null,
    stagedPlay: null,
    winnerPlacements: [],
    winnerPlayerId: null,
    supportLinks: [],
    supportHistory: [],
    supportBlocks: [],
    supportRequests: [],
    avatarEmojiReactions: [],
    events: [],
  }

  pushEvent(game, {
    type: "game-started",
    message: "The first card is down. No Mercy begins.",
  })

  return game
}

export function addWaitingPlayer(
  game: GameState,
  context: GameContext,
  playerId: string
): CommandResult<GameState> {
  if (isGameFinished(game)) {
    return fail("game-finished", "This match is finished.")
  }
  if (!context.players.some((player) => player.id === playerId)) {
    return fail("player-not-found", "That player is not seated here.")
  }
  if (game.playerOrder.includes(playerId)) {
    game.waitingPlayerIds = unique([...(game.waitingPlayerIds ?? []), playerId])
    game.handsByPlayerId[playerId] ??= []
    return ok(game)
  }

  const existingOrWaiting = new Set([...game.playerOrder, playerId])
  game.playerOrder = context.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((player) => player.id)
    .filter((orderedPlayerId) => existingOrWaiting.has(orderedPlayerId))
  game.waitingPlayerIds = unique([...(game.waitingPlayerIds ?? []), playerId])
  game.handsByPlayerId[playerId] = []
  pushEvent(game, {
    type: "player-waiting",
    playerId,
    message: `${playerName(context, playerId)} is waiting for the next match.`,
  })
  return ok(game)
}

export function projectPublicGame(
  game: GameState,
  context: GameContext
): PublicGameSnapshot {
  const playersById = new Map(
    context.players.map((player) => [player.id, player])
  )

  return {
    matchId: game.matchId,
    direction: game.direction,
    currentColor: game.currentColor,
    turnPlayerId: game.turnPlayerId,
    topDiscard: topDiscard(game),
    drawPileCount: game.drawPile.length,
    discardPileCount: game.discardPile.length,
    drawStack: game.drawStack ? { ...game.drawStack } : null,
    pendingChoice: projectPendingChoice(game),
    stagedPlay: projectStagedPlay(game),
    players: game.playerOrder
      .map((playerId) => playersById.get(playerId))
      .filter((player): player is GameContext["players"][number] =>
        Boolean(player)
      )
      .map((player) => {
        const winnerPlacement = winnerPlacementFor(game, player.id)
        const handCount = winnerPlacement
          ? 0
          : (game.handsByPlayerId[player.id]?.length ?? 0)
        const waiting = (game.waitingPlayerIds ?? []).includes(player.id)
        return {
          playerId: player.id,
          handCount,
          declaredUno:
            handCount === 1 &&
            (game.unoDeclaredPlayerIds ?? []).includes(player.id),
          eliminated: game.eliminatedPlayerIds.includes(player.id),
          voteKicked: game.voteKickedPlayerIds.includes(player.id),
          waiting,
          winnerPlacement: winnerPlacement ? { ...winnerPlacement } : null,
          connected: player.connected,
          ready: player.ready,
        }
      }),
    events: game.events.slice(-16).map((event) => ({ ...event })),
    winnerPlacements: game.winnerPlacements.map((placement) => ({
      ...placement,
    })),
    winnerPlayerId: game.winnerPlayerId,
    supportLinks: game.supportLinks.map((link) => ({ ...link })),
    avatarEmojiReactions: game.avatarEmojiReactions.map((reaction) => ({
      ...reaction,
    })),
    supportRecap: isGameFinished(game) ? buildSupportRecap(game) : null,
  }
}

export function supportSquadPlayerIdFor(
  game: GameState,
  playerId: string
): string | null {
  const supportedLink = game.supportLinks.find(
    (link) => link.supporterPlayerId === playerId
  )
  if (supportedLink) return supportedLink.supportedPlayerId

  const hasSupporters = game.supportLinks.some(
    (link) => link.supportedPlayerId === playerId
  )
  const hadSupporters = game.supportHistory.some(
    (entry) => entry.supportedPlayerId === playerId
  )
  return isPlayerActive(game, playerId) && (hasSupporters || hadSupporters)
    ? playerId
    : null
}

export function supportSquadMemberIds(
  game: GameState,
  squadPlayerId: string
): string[] {
  return [
    squadPlayerId,
    ...game.supportLinks
      .filter((link) => link.supportedPlayerId === squadPlayerId)
      .map((link) => link.supporterPlayerId),
  ]
}

export function projectPlayerGame(
  game: GameState,
  context: GameContext,
  playerId: string
): PlayerGameSnapshot {
  void context
  const hand =
    isPlayerActive(game, playerId) || game.turnPlayerId === playerId
      ? (game.handsByPlayerId[playerId] ?? [])
      : []

  return {
    playerId,
    hand: hand.map((card) => ({ ...card })),
    playableCardIds: hand
      .filter((card) => canPlaySingleCard(game, playerId, card))
      .map((card) => card.id),
    catchablePlayerIds: isPlayerActive(game, playerId)
      ? game.unoVulnerablePlayerIds.filter(
          (targetPlayerId) =>
            targetPlayerId !== playerId &&
            isPlayerActive(game, targetPlayerId) &&
            (game.handsByPlayerId[targetPlayerId]?.length ?? 0) === 1
        )
      : [],
    canDraw: canDrawOneFromDeck(game, playerId),
    canEndTurn:
      !isGameFinished(game) &&
      game.turnPlayerId === playerId &&
      game.drawnThisTurnPlayerId === playerId &&
      !game.drawStack &&
      !game.pendingChoice &&
      isPlayerActive(game, playerId),
    canTakeDrawPenalty:
      !isGameFinished(game) &&
      game.turnPlayerId === playerId &&
      game.drawStack?.targetPlayerId === playerId &&
      isPlayerActive(game, playerId),
  }
}

export function projectSpectatorView(
  game: GameState,
  context: GameContext,
  spectatorPlayerId: string,
  targetPlayerId: string
): PlayerGameSnapshot | null {
  void context
  if (isPlayerActive(game, spectatorPlayerId)) return null
  if (!game.playerOrder.includes(targetPlayerId)) return null
  if (!isPlayerActive(game, targetPlayerId)) return null

  const hand = game.handsByPlayerId[targetPlayerId] ?? []
  return {
    playerId: targetPlayerId,
    hand: hand.map((card) => ({ ...card })),
    playableCardIds: [],
    catchablePlayerIds: [],
    canDraw: false,
    canEndTurn: false,
    canTakeDrawPenalty: false,
  }
}

export function projectSupportView(
  game: GameState,
  context: GameContext,
  supporterPlayerId: string
): PlayerGameSnapshot | null {
  const link = game.supportLinks.find(
    (candidate) => candidate.supporterPlayerId === supporterPlayerId
  )
  if (!link || !isPlayerActive(game, link.supportedPlayerId)) return null

  const view = projectPlayerGame(game, context, link.supportedPlayerId)
  return {
    ...view,
    catchablePlayerIds: [],
    canDraw: false,
    canEndTurn: false,
    canTakeDrawPenalty: false,
  }
}

export function supportPlayer(
  game: GameState,
  context: GameContext,
  supporterPlayerId: string,
  supportedPlayerId: string
): CommandResult<GameState> {
  if (isGameFinished(game))
    return fail("game-finished", "This match is finished.")
  if (!game.playerOrder.includes(supporterPlayerId)) {
    return fail("player-not-found", "The supporter is not part of this match.")
  }
  if (!game.playerOrder.includes(supportedPlayerId)) {
    return fail("player-not-found", "That player is not part of this match.")
  }
  if (supporterPlayerId === supportedPlayerId) {
    return fail("cannot-support-self", "You cannot support yourself.")
  }
  if (isPlayerActive(game, supporterPlayerId)) {
    return fail("player-active", "Only inactive players can become supporters.")
  }
  if (!isPlayerActive(game, supportedPlayerId)) {
    return fail(
      "supported-player-inactive",
      "Choose an active player to support."
    )
  }
  if (
    game.supportLinks.some(
      (link) => link.supporterPlayerId === supporterPlayerId
    )
  ) {
    return fail(
      "support-locked",
      "You are already supporting an active player."
    )
  }
  if (
    game.supportBlocks.some(
      (block) =>
        block.supporterPlayerId === supporterPlayerId &&
        block.supportedPlayerId === supportedPlayerId
    )
  ) {
    return fail("support-blocked", "That player removed you from their squad.")
  }

  const createdAt = new Date().toISOString()
  const link = { supporterPlayerId, supportedPlayerId, createdAt }
  dropSupportRequestsFrom(game, supporterPlayerId)
  game.supportLinks.push(link)
  game.supportHistory.push({ ...link, endedAt: null, endReason: null })
  pushEvent(game, {
    type: "support-started",
    playerId: supporterPlayerId,
    targetPlayerId: supportedPlayerId,
    message: `${playerName(context, supporterPlayerId)} is backing ${playerName(
      context,
      supportedPlayerId
    )}.`,
  })
  return ok(game)
}

export function kickSupporter(
  game: GameState,
  context: GameContext,
  supportedPlayerId: string,
  supporterPlayerId: string
): CommandResult<GameState> {
  if (!isPlayerActive(game, supportedPlayerId)) {
    return fail(
      "player-inactive",
      "Only an active player can manage their squad."
    )
  }
  const link = game.supportLinks.find(
    (candidate) =>
      candidate.supporterPlayerId === supporterPlayerId &&
      candidate.supportedPlayerId === supportedPlayerId
  )
  if (!link)
    return fail("support-link-not-found", "That player is not supporting you.")

  endSupportLink(game, link, "supporter-kicked")
  game.supportBlocks.push({
    supporterPlayerId,
    supportedPlayerId,
    createdAt: new Date().toISOString(),
  })
  pushEvent(game, {
    type: "support-kicked",
    playerId: supportedPlayerId,
    targetPlayerId: supporterPlayerId,
    message: `${playerName(context, supportedPlayerId)} kicked ${playerName(
      context,
      supporterPlayerId
    )} from their squad.`,
  })
  return ok(game)
}

/**
 * Second-chance ask after a kick. The supported player decides whether the
 * person they removed gets back into the squad.
 */
export function requestSupport(
  game: GameState,
  context: GameContext,
  supporterPlayerId: string,
  supportedPlayerId: string
): CommandResult<GameState> {
  if (isGameFinished(game))
    return fail("game-finished", "This match is finished.")
  if (!game.playerOrder.includes(supporterPlayerId)) {
    return fail("player-not-found", "You are not part of this match.")
  }
  if (!game.playerOrder.includes(supportedPlayerId)) {
    return fail("player-not-found", "That player is not part of this match.")
  }
  if (supporterPlayerId === supportedPlayerId) {
    return fail("cannot-support-self", "You cannot support yourself.")
  }
  if (isPlayerActive(game, supporterPlayerId)) {
    return fail("player-active", "Only inactive players can become supporters.")
  }
  if (!isPlayerActive(game, supportedPlayerId)) {
    return fail(
      "supported-player-inactive",
      "Choose an active player to support."
    )
  }
  if (
    game.supportLinks.some(
      (link) => link.supporterPlayerId === supporterPlayerId
    )
  ) {
    return fail(
      "support-locked",
      "You are already supporting an active player."
    )
  }
  if (!isSupportBlocked(game, supporterPlayerId, supportedPlayerId)) {
    return fail(
      "support-request-not-needed",
      "You can support that player without asking."
    )
  }
  if (
    game.supportRequests.some(
      (request) =>
        request.supporterPlayerId === supporterPlayerId &&
        request.supportedPlayerId === supportedPlayerId
    )
  ) {
    return fail("support-request-pending", "That request is already waiting.")
  }

  // One outstanding ask at a time — switching targets replaces the old one.
  dropSupportRequestsFrom(game, supporterPlayerId)
  game.supportRequests.push({
    supporterPlayerId,
    supportedPlayerId,
    createdAt: new Date().toISOString(),
  })
  pushEvent(game, {
    type: "support-requested",
    playerId: supporterPlayerId,
    targetPlayerId: supportedPlayerId,
    message: `${playerName(context, supporterPlayerId)} asked to support ${playerName(
      context,
      supportedPlayerId
    )}.`,
  })
  return ok(game)
}

export function respondToSupportRequest(
  game: GameState,
  context: GameContext,
  supportedPlayerId: string,
  supporterPlayerId: string,
  approve: boolean
): CommandResult<GameState> {
  const request = game.supportRequests.find(
    (candidate) =>
      candidate.supporterPlayerId === supporterPlayerId &&
      candidate.supportedPlayerId === supportedPlayerId
  )
  if (!request) {
    return fail("support-request-not-found", "That request is no longer open.")
  }
  if (!isPlayerActive(game, supportedPlayerId)) {
    return fail(
      "player-inactive",
      "Only an active player can manage their squad."
    )
  }

  dropSupportRequestsFrom(game, supporterPlayerId)

  if (!approve) {
    pushEvent(game, {
      type: "support-request-declined",
      playerId: supportedPlayerId,
      targetPlayerId: supporterPlayerId,
      message: `${playerName(context, supportedPlayerId)} turned down ${playerName(
        context,
        supporterPlayerId
      )}.`,
    })
    return ok(game)
  }

  game.supportBlocks = game.supportBlocks.filter(
    (block) =>
      !(
        block.supporterPlayerId === supporterPlayerId &&
        block.supportedPlayerId === supportedPlayerId
      )
  )

  return supportPlayer(game, context, supporterPlayerId, supportedPlayerId)
}

export function incomingSupportRequests(
  game: GameState,
  supportedPlayerId: string
): SupportRequest[] {
  return game.supportRequests
    .filter((request) => request.supportedPlayerId === supportedPlayerId)
    .map((request) => ({ ...request }))
}

export function outgoingSupportRequest(
  game: GameState,
  supporterPlayerId: string
): SupportRequest | null {
  const request = game.supportRequests.find(
    (candidate) => candidate.supporterPlayerId === supporterPlayerId
  )
  return request ? { ...request } : null
}

function isSupportBlocked(
  game: GameState,
  supporterPlayerId: string,
  supportedPlayerId: string
): boolean {
  return game.supportBlocks.some(
    (block) =>
      block.supporterPlayerId === supporterPlayerId &&
      block.supportedPlayerId === supportedPlayerId
  )
}

function dropSupportRequestsFrom(game: GameState, supporterPlayerId: string) {
  game.supportRequests = game.supportRequests.filter(
    (request) => request.supporterPlayerId !== supporterPlayerId
  )
}

export function voteKickPlayer(
  game: GameState,
  context: GameContext,
  targetPlayerId: string
): CommandResult<GameState> {
  if (isGameFinished(game)) {
    return fail("game-finished", "This match is finished.")
  }
  if (!game.playerOrder.includes(targetPlayerId)) {
    return fail("player-not-found", "That player is not part of this match.")
  }
  if (!isPlayerActive(game, targetPlayerId)) {
    return fail("player-inactive", "Choose an active player to vote-kick.")
  }

  game.voteKickedPlayerIds = unique([
    ...game.voteKickedPlayerIds,
    targetPlayerId,
  ])
  removePlayerFromActivePlay(game, targetPlayerId)
  pushEvent(game, {
    type: "player-vote-kicked",
    playerId: targetPlayerId,
    message: `${playerName(context, targetPlayerId)} was vote-kicked from this match.`,
  })
  finishGameIfComplete(game, context)
  normalizeInactiveTurnState(game, targetPlayerId)
  return ok(game)
}

export function releaseInactiveSupportLinks(
  game: GameState,
  context: GameContext
): GameState {
  for (const link of [...game.supportLinks]) {
    const matchFinished = isGameFinished(game)
    if (!matchFinished && isPlayerActive(game, link.supportedPlayerId)) continue
    const reason: SupportEndReason = matchFinished
      ? "match-finished"
      : "supported-player-inactive"
    endSupportLink(game, link, reason)
    pushEvent(game, {
      type: "support-ended",
      playerId: link.supporterPlayerId,
      targetPlayerId: link.supportedPlayerId,
      message: matchFinished
        ? `${playerName(context, link.supporterPlayerId)} supported ${playerName(context, link.supportedPlayerId)} through the end of the match.`
        : `${playerName(context, link.supporterPlayerId)} can choose a new player to support.`,
    })
  }

  // A pending ask dies with the squad it was aimed at.
  game.supportRequests = game.supportRequests.filter(
    (request) =>
      !isGameFinished(game) && isPlayerActive(game, request.supportedPlayerId)
  )
  return game
}

export function sendAvatarEmojiReaction(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: SendAvatarEmojiReactionInput
): CommandResult<GameState> {
  void context
  if (isGameFinished(game))
    return fail("game-finished", "This match is finished.")
  if (!game.playerOrder.includes(playerId)) {
    return fail("player-not-found", "You are not part of this match.")
  }

  const validBody = AVATAR_REACTION_EMOJIS.includes(input.body)
  if (!validBody) {
    return fail(
      "invalid-avatar-emoji-reaction",
      "Choose an avatar emoji reaction."
    )
  }

  const supportedPlayerId =
    game.supportLinks.find((link) => link.supporterPlayerId === playerId)
      ?.supportedPlayerId ?? null
  const createdAt = new Date().toISOString()
  game.avatarEmojiReactions.push({
    id: `${Date.now()}:${game.avatarEmojiReactions.length}:${Math.random().toString(36).slice(2, 8)}`,
    playerId,
    supportedPlayerId,
    body: input.body,
    createdAt,
  })
  if (game.avatarEmojiReactions.length > 24) {
    game.avatarEmojiReactions = game.avatarEmojiReactions.slice(-24)
  }
  return ok(game)
}

export function stageCards(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: StageCardsInput
): CommandResult<GameState> {
  void context
  if (isGameFinished(game)) {
    return fail("game-finished", "This game is already finished.")
  }
  if (game.turnPlayerId !== playerId)
    return fail("not-your-turn", "It is not your turn.")
  if (game.pendingChoice)
    return fail("pending-choice", "Resolve the pending choice first.")
  if (!isPlayerActive(game, playerId)) {
    return fail("player-inactive", "Inactive players cannot play cards.")
  }

  if (input.cardIds.length === 0) {
    if (game.stagedPlay?.playerId === playerId) game.stagedPlay = null
    return ok(game)
  }

  const cardsResult = getCardsFromHand(game, playerId, input.cardIds)
  if (!cardsResult.ok) return cardsResult

  const validation = validateStage(game, playerId, cardsResult.data)
  if (!validation.ok) return validation

  game.stagedPlay = {
    playerId,
    kind: "play",
    cardIds: unique(input.cardIds),
    chosenColor: input.chosenColor,
    declaredUno: input.declaredUno,
    rotateHands: input.rotateHands,
    swapWithPlayerId: input.swapWithPlayerId,
  }

  return ok(game)
}

export function playCards(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: PlayCardsInput
): CommandResult<GameState> {
  const cardsResult = getCardsFromHand(game, playerId, input.cardIds)
  if (!cardsResult.ok) return cardsResult

  const cards = cardsResult.data
  const validation = validatePlay(game, context, playerId, cards, input)
  if (!validation.ok) return validation

  beginTurnAction(game, playerId)
  game.drawnThisTurnPlayerId = null
  game.stagedPlay = null

  const hand = game.handsByPlayerId[playerId] ?? []
  const primaryCard = cards[cards.length - 1] as Card
  const discardExtras =
    primaryCard.face.kind === "discard-color"
      ? cardsInHandOrder(hand, input.discardCardIds ?? [])
      : []

  for (const card of cards) {
    removeCard(hand, card.id)
  }
  for (const card of discardExtras) {
    removeCard(hand, card.id)
  }

  const finalCards = orderDiscardPileCards(
    [...discardExtras, ...cards],
    input.topCardId ?? primaryCard.id
  )
  const topPlayedCard = finalCards[finalCards.length - 1] ?? primaryCard
  game.discardPile.push(...finalCards)
  game.currentColor =
    topPlayedCard.color === "wild"
      ? (input.chosenColor as PlayColor)
      : colorFor(topPlayedCard)

  pushEvent(game, {
    type: game.drawStack ? "draw-stacked" : "card-played",
    playerId,
    cards: finalCards,
    message: playedMessage(context, playerId, finalCards),
  })

  if (input.declaredUno && hand.length === 1) {
    game.unoDeclaredPlayerIds = unique([
      ...(game.unoDeclaredPlayerIds ?? []),
      playerId,
    ])
    pushEvent(game, {
      type: "uno-called",
      playerId,
      message: `${playerName(context, playerId)} called UNO.`,
    })
  } else if (context.houseRules.callUno && hand.length === 1) {
    game.unoDeclaredPlayerIds = game.unoDeclaredPlayerIds.filter(
      (targetPlayerId) => targetPlayerId !== playerId
    )
    game.unoVulnerablePlayerIds = unique([
      ...game.unoVulnerablePlayerIds,
      playerId,
    ])
  }

  if (hand.length === 0) {
    recordWinner(game, context, playerId)
    finishGameIfComplete(game, context)
    if (!isGameFinished(game)) advanceTurn(game, playerId, 1)
    return ok(game)
  }

  applyPlayedCardsEffect(game, context, playerId, cards, input)
  checkMercyEliminations(game, context)

  return ok(game)
}

export function drawOne(
  game: GameState,
  context: GameContext,
  playerId: string
): CommandResult<GameState> {
  if (isGameFinished(game)) {
    return fail("game-finished", "This game is already finished.")
  }
  if (game.turnPlayerId !== playerId)
    return fail("not-your-turn", "It is not your turn.")
  if (game.pendingChoice)
    return fail("pending-choice", "Resolve the pending choice first.")
  const drawStackPowerEscape = canDrawBeforeStackingFinalPowerCard(
    game,
    playerId
  )
  if (game.drawStack && !drawStackPowerEscape) {
    return fail(
      "draw-stack-active",
      "Stack a draw card or take the full penalty."
    )
  }
  if (!isPlayerActive(game, playerId)) {
    return fail("player-inactive", "Inactive players cannot draw cards.")
  }
  if (game.drawnThisTurnPlayerId === playerId) {
    return fail(
      "already-drew",
      "You already drew this turn. Play a card or pass."
    )
  }

  beginTurnAction(game, playerId)
  game.stagedPlay = null
  const drawn = drawCards(game, 1)
  addCardsToHand(game, playerId, drawn)
  game.drawnThisTurnPlayerId = playerId
  pushEvent(game, {
    type: "card-drawn",
    playerId,
    cardCount: 1,
    drawKind: "single",
    message: drawStackPowerEscape
      ? `${playerName(context, playerId)} drew 1 card before stacking.`
      : `${playerName(context, playerId)} drew 1 card.`,
  })
  checkMercyEliminations(game, context)
  if (isGameFinished(game) || !isPlayerActive(game, playerId)) {
    game.drawnThisTurnPlayerId = null
  }
  return ok(game)
}

export function endTurn(
  game: GameState,
  context: GameContext,
  playerId: string
): CommandResult<GameState> {
  if (isGameFinished(game)) {
    return fail("game-finished", "This game is already finished.")
  }
  if (game.turnPlayerId !== playerId)
    return fail("not-your-turn", "It is not your turn.")
  if (game.pendingChoice)
    return fail("pending-choice", "Resolve the pending choice first.")
  if (game.drawStack) {
    return fail(
      "draw-stack-active",
      "Stack a draw card or take the full penalty."
    )
  }
  if (game.drawnThisTurnPlayerId !== playerId) {
    return fail("draw-before-ending", "Draw a card before passing your turn.")
  }
  if (!isPlayerActive(game, playerId)) {
    return fail("player-inactive", "Inactive players cannot end turns.")
  }

  pushEvent(game, {
    type: "turn-passed",
    playerId,
    message: `${playerName(context, playerId)} passed after drawing.`,
  })
  game.stagedPlay = null
  advanceTurn(game, playerId, 1)
  return ok(game)
}

export function takeDrawPenalty(
  game: GameState,
  context: GameContext,
  playerId: string
): CommandResult<GameState> {
  if (!game.drawStack || game.drawStack.targetPlayerId !== playerId) {
    return fail("no-draw-penalty", "There is no draw penalty waiting for you.")
  }

  beginTurnAction(game, playerId)
  const amount = game.drawStack.amount
  const drawn = drawCards(game, amount)
  addCardsToHand(game, playerId, drawn)
  game.drawStack = null

  pushEvent(game, {
    type: "draw-penalty",
    playerId,
    cardCount: amount,
    drawKind: "penalty",
    message: `${playerName(context, playerId)} took the +${amount} penalty.`,
  })

  checkMercyEliminations(game, context)
  if (!isGameFinished(game)) advanceTurn(game, playerId, 1)
  return ok(game)
}

export function drawRouletteCard(
  game: GameState,
  context: GameContext,
  playerId: string
): CommandResult<GameState> {
  if (game.pendingChoice?.type !== "roulette-draw") {
    return fail("no-roulette-draw", "There is no roulette pickup waiting.")
  }

  if (game.pendingChoice.playerId !== playerId) {
    return fail("not-your-pickup", "Another player must pick up these cards.")
  }

  beginTurnAction(game, playerId)

  const pendingChoice = game.pendingChoice
  const next = drawCards(game, 1)[0]
  if (!next) {
    return completeRouletteDraw(game, context, playerId, pendingChoice)
  }

  pendingChoice.drawnCards.push(next)
  game.pendingChoice = pendingChoice
  game.stagedPlay = null

  pushEvent(game, {
    type: "card-drawn",
    playerId,
    cards: [next],
    cardCount: 1,
    drawKind: "roulette-reveal",
    message: `${playerName(context, playerId)} revealed ${cardLabel(next)}.`,
  })

  if (next.color !== pendingChoice.color) return ok(game)

  return completeRouletteDraw(game, context, playerId, pendingChoice)
}

function completeRouletteDraw(
  game: GameState,
  context: GameContext,
  playerId: string,
  pendingChoice: NonNullable<GameState["pendingChoice"]>
): CommandResult<GameState> {
  const drawnCards = pendingChoice.drawnCards

  addCardsToHand(game, playerId, drawnCards)
  game.pendingChoice = null
  game.drawnThisTurnPlayerId = null

  pushEvent(game, {
    type: "card-drawn",
    playerId,
    cards: drawnCards,
    cardCount: drawnCards.length,
    drawKind: "roulette-complete",
    message:
      drawnCards.length === 0
        ? `${playerName(context, playerId)} found no roulette cards to draw.`
        : `${playerName(context, playerId)} found ${pendingChoice.color} after drawing ${drawnCards.length} card${drawnCards.length === 1 ? "" : "s"}.`,
  })

  checkMercyEliminations(game, context)

  if (!isGameFinished(game) && isPlayerActive(game, playerId)) {
    game.turnPlayerId = nextPlayerId(game, playerId, 1)
    if (drawnCards.length > 0) {
      game.stagedPlay = {
        playerId,
        kind: "roulette",
        cardIds: drawnCards.map((card) => card.id),
      }
    }
  }

  return ok(game)
}

export function catchUno(
  game: GameState,
  context: GameContext,
  playerId: string,
  input: CatchUnoInput
): CommandResult<GameState> {
  if (!isPlayerActive(game, playerId)) {
    return fail("player-inactive", "Inactive players cannot call UNO.")
  }
  if (playerId === input.targetPlayerId) {
    return fail("cannot-catch-self", "You cannot catch yourself.")
  }

  if (!game.unoVulnerablePlayerIds.includes(input.targetPlayerId)) {
    return fail("not-catchable", "That player is not catchable right now.")
  }

  const drawn = drawCards(game, 2)
  addCardsToHand(game, input.targetPlayerId, drawn)
  game.unoVulnerablePlayerIds = game.unoVulnerablePlayerIds.filter(
    (targetPlayerId) => targetPlayerId !== input.targetPlayerId
  )

  pushEvent(game, {
    type: "uno-caught",
    playerId,
    targetPlayerId: input.targetPlayerId,
    message: `${playerName(context, playerId)} caught ${playerName(
      context,
      input.targetPlayerId
    )}. +2 cards.`,
  })

  checkMercyEliminations(game, context)
  return ok(game)
}

function endSupportLink(
  game: GameState,
  link: GameState["supportLinks"][number],
  reason: SupportEndReason
) {
  game.supportLinks = game.supportLinks.filter(
    (candidate) => candidate.supporterPlayerId !== link.supporterPlayerId
  )
  const historyEntry = game.supportHistory.find(
    (entry) =>
      entry.supporterPlayerId === link.supporterPlayerId &&
      entry.supportedPlayerId === link.supportedPlayerId &&
      entry.endedAt === null
  )
  if (historyEntry) {
    historyEntry.endedAt = new Date().toISOString()
    historyEntry.endReason = reason
  }
}

function buildSupportRecap(game: GameState): SupportRecap {
  const journey = game.supportHistory.map((entry) => ({ ...entry }))
  const titles: SupportRecap["titles"] = []
  const firstWinnerId = game.winnerPlacements.find(
    (placement) => placement.position === 1
  )?.playerId
  const earlyBeliever = firstWinnerId
    ? journey.find((entry) => entry.supportedPlayerId === firstWinnerId)
    : null
  if (earlyBeliever) {
    titles.push({
      label: "Early Believer",
      playerId: earlyBeliever.supporterPlayerId,
      description: "Backed the match winner first.",
    })
  }

  const supportCounts = journey.reduce<Record<string, number>>(
    (counts, entry) => {
      counts[entry.supportedPlayerId] =
        (counts[entry.supportedPlayerId] ?? 0) + 1
      return counts
    },
    {}
  )
  const crowdFavorite = maxCountEntry(supportCounts)
  if (crowdFavorite) {
    titles.push({
      label: "Crowd Favorite",
      playerId: crowdFavorite[0],
      description: "Drew the largest supporter crowd.",
    })
  }
  return { journey, titles }
}

function maxCountEntry(
  counts: Record<string, number>
): [string, number] | null {
  return (
    Object.entries(counts).sort(
      ([firstId, firstCount], [secondId, secondCount]) =>
        secondCount - firstCount || firstId.localeCompare(secondId)
    )[0] ?? null
  )
}

function applyPlayedCardsEffect(
  game: GameState,
  context: GameContext,
  playerId: string,
  cards: Card[],
  input: PlayCardsInput
) {
  const drawPlayedCards = cards.filter((card) => drawCount(card))
  if (drawPlayedCards.length > 0) {
    for (const card of drawPlayedCards) {
      if (card.face.kind !== "wild-reverse-draw") continue
      game.direction = game.direction === 1 ? -1 : 1
      pushEvent(game, {
        type: "direction-changed",
        playerId,
        message: "Direction reversed.",
      })
    }

    const totalDrawAmount = drawPlayedCards.reduce(
      (total, card) => total + (drawCount(card) ?? 0),
      0
    )
    const minimum = Math.max(
      ...drawPlayedCards.map((card) => drawCount(card) ?? 0)
    )
    const targetPlayerId = nextPlayerId(game, playerId, 1)

    game.drawStack = {
      amount: (game.drawStack?.amount ?? 0) + totalDrawAmount,
      minimum,
      targetPlayerId,
    }
    game.turnPlayerId = targetPlayerId
    game.drawnThisTurnPlayerId = null
    return
  }

  const card = cards[cards.length - 1] as Card

  switch (card.face.kind) {
    case "skip": {
      const skipCount = cards.filter(
        (played) => played.face.kind === "skip"
      ).length
      pushEvent(game, {
        type: "turn-skipped",
        playerId,
        message:
          skipCount === 1
            ? `${playerName(context, nextPlayerId(game, playerId, 1))} was skipped.`
            : `${playerName(context, playerId)} skipped ${skipCount} turns.`,
      })
      advanceTurnAfterSkips(game, playerId, skipCount)
      return
    }
    case "skip-everyone":
      pushEvent(game, {
        type: "turn-skipped",
        playerId,
        message: `${playerName(context, playerId)} skipped everyone and plays again.`,
      })
      game.turnPlayerId = playerId
      return
    case "reverse": {
      const reverseCount = cards.filter(
        (played) => played.face.kind === "reverse"
      ).length
      if (reverseCount % 2 === 1) {
        game.direction = game.direction === 1 ? -1 : 1
        pushEvent(game, {
          type: "direction-changed",
          playerId,
          message:
            reverseCount === 1
              ? "Direction reversed."
              : `${playerName(context, playerId)} played ${reverseCount} reverses. Direction reversed.`,
        })
      } else {
        pushEvent(game, {
          type: "direction-changed",
          playerId,
          message: `${playerName(context, playerId)} played ${reverseCount} reverses. Direction stayed the same.`,
        })
      }
      if (activePlayerIds(game).length === 2) {
        pushEvent(game, {
          type: "turn-skipped",
          playerId,
          message: `${playerName(context, playerId)} reversed in a two-player game and plays again.`,
        })
        game.turnPlayerId = playerId
        game.drawnThisTurnPlayerId = null
        game.stagedPlay = null
        return
      }
      advanceTurn(game, playerId, 1)
      return
    }
    case "number":
      if (
        input.rotateHands &&
        isSingleNumberCardPlay(cards, 0) &&
        context.houseRules.zeroRotate
      ) {
        rotateHands(game)
        pushEvent(game, {
          type: "hands-rotated",
          playerId,
          message: "Every hand rotated in turn order.",
        })
      }
      if (
        input.swapWithPlayerId &&
        isSingleNumberCardPlay(cards, 7) &&
        context.houseRules.sevenSwap
      ) {
        const targetPlayerId = input.swapWithPlayerId
        swapHands(game, playerId, targetPlayerId)
        pushEvent(game, {
          type: "hand-swapped",
          playerId,
          targetPlayerId,
          message: `${playerName(context, playerId)} swapped hands with ${playerName(
            context,
            targetPlayerId
          )}.`,
        })
      }
      advanceTurn(game, playerId, 1)
      return
    case "wild-color-roulette": {
      const targetPlayerId = nextPlayerId(game, playerId, 1)
      const rouletteColor = input.chosenColor ?? game.currentColor
      game.pendingChoice = {
        type: "roulette-draw",
        playerId: targetPlayerId,
        color: rouletteColor,
        drawnCards: [],
      }
      game.currentColor = rouletteColor
      game.turnPlayerId = targetPlayerId
      game.drawnThisTurnPlayerId = null
      pushEvent(game, {
        type: "color-changed",
        playerId,
        targetPlayerId,
        message: `${playerName(context, playerId)} called ${rouletteColor}. ${playerName(
          context,
          targetPlayerId
        )} must draw until ${rouletteColor}.`,
      })
      return
    }
    default:
      advanceTurn(game, playerId, 1)
  }
}

function validatePlay(
  game: GameState,
  context: GameContext,
  playerId: string,
  cards: Card[],
  input: PlayCardsInput
): CommandResult<GameState> {
  if (isGameFinished(game)) {
    return fail("game-finished", "This game is already finished.")
  }
  if (game.turnPlayerId !== playerId)
    return fail("not-your-turn", "It is not your turn.")
  if (game.pendingChoice)
    return fail("pending-choice", "Resolve the pending choice first.")
  if (!isPlayerActive(game, playerId)) {
    return fail("player-inactive", "Inactive players cannot play cards.")
  }

  if (cards.length === 0) return fail("no-cards", "Select at least one card.")

  const discardValidation = validateDiscardPlay(game, playerId, cards, input)
  if (!discardValidation.ok) return discardValidation

  if (game.drawStack) {
    const drawStackValidation = validateDrawStackPlay(game, cards)
    if (!drawStackValidation.ok) return drawStackValidation
  } else if (cards.length > 1) {
    if (
      !sameNumberGroup(cards) &&
      !sameDrawGroup(cards) &&
      !sameActionGroup(cards)
    ) {
      return fail(
        "multi-card-group-mismatch",
        "Grouped cards must share a number, draw, skip, or reverse symbol."
      )
    }
    if (!cards.some((card) => canPlaySingleCard(game, playerId, card))) {
      return fail(
        "not-playable",
        "At least one selected card must match the pile."
      )
    }
  } else if (!canPlaySingleCard(game, playerId, cards[0] as Card)) {
    return fail("not-playable", "That card does not match the pile.")
  }

  const chosenColorNeeded = cards.some((card) => card.color === "wild")
  if (chosenColorNeeded && !input.chosenColor) {
    return fail("missing-color", "Choose a color for the wild card.")
  }

  const finalHandCount = handCountAfterPlay(game, playerId, cards, input)
  if (
    finalHandCount === 0 &&
    cards.some((card) => isForbiddenFinalCard(card))
  ) {
    return fail(
      "power-card-finish",
      "House rule: you cannot go out on a power card."
    )
  }

  if (input.rotateHands) {
    if (!context.houseRules.zeroRotate) {
      return fail(
        "zero-rotate-disabled",
        "Hand cycling is disabled for this room."
      )
    }
    if (!isSingleNumberCardPlay(cards, 0)) {
      return fail(
        "invalid-zero-rotate",
        "You can only cycle hands with a single 0."
      )
    }
    if (finalHandCount === 0) {
      return fail(
        "invalid-zero-rotate",
        "You cannot cycle hands when going out."
      )
    }
  }

  if (input.swapWithPlayerId) {
    if (!context.houseRules.sevenSwap) {
      return fail(
        "seven-swap-disabled",
        "Hand swapping is disabled for this room."
      )
    }
    if (!isSingleNumberCardPlay(cards, 7)) {
      return fail(
        "invalid-swap-card",
        "You can only swap hands with a single 7."
      )
    }
    if (finalHandCount === 0) {
      return fail("invalid-swap-card", "You cannot swap hands when going out.")
    }
    if (input.swapWithPlayerId === playerId) {
      return fail("invalid-swap-target", "Choose another player to swap with.")
    }
    if (!activePlayerIds(game).includes(input.swapWithPlayerId)) {
      return fail(
        "invalid-swap-target",
        "That player is not active in this game."
      )
    }
  }

  return ok(game)
}

function validateStage(
  game: GameState,
  playerId: string,
  cards: Card[]
): CommandResult<GameState> {
  if (cards.length === 0) return fail("no-cards", "Select at least one card.")

  if (game.drawStack) {
    const drawStackValidation = validateDrawStackPlay(game, cards)
    if (!drawStackValidation.ok) return drawStackValidation
    return ok(game)
  }

  const discardStageValidation = validateDiscardStage(game, playerId, cards)
  if (!discardStageValidation.ok) return discardStageValidation
  if (cards.some((card) => card.face.kind === "discard-color")) return ok(game)

  if (cards.length > 1) {
    if (
      !sameNumberGroup(cards) &&
      !sameDrawGroup(cards) &&
      !sameActionGroup(cards)
    ) {
      return fail(
        "multi-card-group-mismatch",
        "Grouped cards must share a number, draw, skip, or reverse symbol."
      )
    }
    if (!cards.some((card) => canPlaySingleCard(game, playerId, card))) {
      return fail(
        "not-playable",
        "At least one selected card must match the pile."
      )
    }
    return ok(game)
  }

  if (!canPlaySingleCard(game, playerId, cards[0] as Card)) {
    return fail("not-playable", "That card does not match the pile.")
  }

  return ok(game)
}

function validateDiscardStage(
  game: GameState,
  playerId: string,
  cards: Card[]
): CommandResult<GameState> {
  const discardCards = cards.filter(
    (card) => card.face.kind === "discard-color"
  )
  if (discardCards.length === 0) return ok(game)

  const firstCard = cards[0] as Card
  if (firstCard.face.kind !== "discard-color") {
    return fail("discard-card-first", "Play the discard card first.")
  }

  if (discardCards.length > 1) {
    return fail(
      "multiple-discard-cards",
      "You can only play one discard card at a time."
    )
  }

  if (!canPlaySingleCard(game, playerId, firstCard)) {
    return fail("not-playable", "That discard card does not match the pile.")
  }

  const invalidExtra = cards
    .slice(1)
    .find(
      (card) =>
        card.face.kind === "discard-color" || card.color !== firstCard.color
    )
  if (invalidExtra) {
    return fail(
      "invalid-discard-card",
      "Discarded cards must match the discard card color."
    )
  }

  return ok(game)
}

function validateDiscardPlay(
  game: GameState,
  playerId: string,
  cards: Card[],
  input: PlayCardsInput
): CommandResult<GameState> {
  const discardCards = cards.filter(
    (card) => card.face.kind === "discard-color"
  )
  const discardCardIds = input.discardCardIds ?? []

  if (discardCards.length > 1) {
    return fail(
      "multiple-discard-cards",
      "You can only play one discard card at a time."
    )
  }

  if (discardCards.length === 0) {
    if (discardCardIds.length > 0 || input.topCardId) {
      return fail(
        "discard-options-without-card",
        "Discard options require a discard card."
      )
    }
    return ok(game)
  }

  if (cards.length > 1) {
    return fail(
      "multiple-discard-cards",
      "You can only play one discard card at a time."
    )
  }

  const discardCard = discardCards[0] as Card
  const uniqueDiscardIds = unique(discardCardIds)
  if (uniqueDiscardIds.length !== discardCardIds.length) {
    return fail(
      "duplicate-discard-card",
      "A discarded card can only be selected once."
    )
  }

  if (uniqueDiscardIds.includes(discardCard.id)) {
    return fail(
      "invalid-discard-card",
      "The played discard card is already on the table."
    )
  }

  const hand = game.handsByPlayerId[playerId] ?? []
  for (const cardId of uniqueDiscardIds) {
    const card = hand.find((candidate) => candidate.id === cardId)
    if (!card) return fail("card-not-found", "That card is not in your hand.")
    if (card.color !== discardCard.color) {
      return fail(
        "invalid-discard-card",
        "Discarded cards must match the discard card color."
      )
    }
  }

  if (input.topCardId) {
    const topCardIds = new Set([discardCard.id, ...uniqueDiscardIds])
    if (!topCardIds.has(input.topCardId)) {
      return fail(
        "invalid-top-card",
        "The top card must be one of the discarded cards."
      )
    }
  }

  return ok(game)
}

function validateDrawStackPlay(
  game: GameState,
  cards: Card[]
): CommandResult<GameState> {
  if (!game.drawStack) return ok(game)

  if (cards.some((card) => !drawCount(card))) {
    return fail(
      "draw-stack-card-required",
      "Stack draw cards or take the penalty."
    )
  }

  if (cards.length > 1 && !sameDrawGroup(cards)) {
    return fail(
      "multi-card-group-mismatch",
      "Grouped draw cards must share the same draw type."
    )
  }

  if (!canStackDrawCards(game, cards)) {
    return fail(
      "draw-stack-too-low",
      "Stack the same draw type, the current color, or a wild draw card."
    )
  }

  return ok(game)
}

function sameNumberGroup(cards: Card[]): boolean {
  const first = cards[0]
  if (!first || first.face.kind !== "number") return false
  const firstValue = first.face.value
  return cards.every(
    (card) => card.face.kind === "number" && card.face.value === firstValue
  )
}

function sameDrawGroup(cards: Card[]): boolean {
  const first = cards[0]
  const firstKey = first ? drawGroupKey(first) : null
  if (!firstKey) return false
  return cards.every((card) => drawGroupKey(card) === firstKey)
}

function sameActionGroup(cards: Card[]): boolean {
  const firstKind = cards[0]?.face.kind
  if (
    firstKind !== "skip" &&
    firstKind !== "skip-everyone" &&
    firstKind !== "reverse"
  ) {
    return false
  }

  return cards.every((card) => card.face.kind === firstKind)
}

function isSingleNumberCardPlay(cards: Card[], value: number): boolean {
  return (
    cards.length === 1 &&
    cards[0]?.face.kind === "number" &&
    cards[0].face.value === value
  )
}

function drawGroupKey(card: Card): string | null {
  switch (card.face.kind) {
    case "draw":
      return `draw:${card.face.count}`
    case "wild-draw":
      return `wild-draw:${card.face.count}`
    case "wild-reverse-draw":
      return `wild-reverse-draw:${card.face.count}`
    default:
      return null
  }
}

function canDrawOneFromDeck(game: GameState, playerId: string): boolean {
  if (isGameFinished(game)) return false
  if (game.turnPlayerId !== playerId) return false
  if (game.pendingChoice) return false
  if (game.drawnThisTurnPlayerId) return false
  if (!isPlayerActive(game, playerId)) return false

  if (!game.drawStack) return true

  return canDrawBeforeStackingFinalPowerCard(game, playerId)
}

function canDrawBeforeStackingFinalPowerCard(
  game: GameState,
  playerId: string
): boolean {
  if (!game.drawStack || game.drawStack.targetPlayerId !== playerId)
    return false
  if (game.pendingChoice) return false
  if (game.drawnThisTurnPlayerId) return false
  if (!isPlayerActive(game, playerId)) return false

  const hand = game.handsByPlayerId[playerId] ?? []
  if (hand.length !== 1) return false

  const finalCard = hand[0]
  if (!finalCard || !isForbiddenFinalCard(finalCard)) return false
  if (!drawCount(finalCard)) return false

  return canStackDrawCards(game, [finalCard])
}

function canPlaySingleCard(
  game: GameState,
  playerId: string,
  card: Card
): boolean {
  if (isGameFinished(game)) return false
  if (game.turnPlayerId !== playerId) return false
  if (game.pendingChoice) return false
  if (!isPlayerActive(game, playerId)) return false

  if (game.drawStack) {
    return canStackDrawCards(game, [card])
  }

  if (card.color === "wild") return true

  const top = topDiscard(game)
  if (!top) return true

  return (
    card.color === game.currentColor ||
    card.color === top.color ||
    faceSymbol(card.face) === faceSymbol(top.face)
  )
}

function canStackDrawCards(game: GameState, cards: Card[]): boolean {
  if (!game.drawStack || cards.length === 0 || !sameDrawGroup(cards)) {
    return false
  }

  const minimum = game.drawStack.minimum
  const top = topDiscard(game)
  const topDrawGroup = top ? drawGroupKey(top) : null
  const playableGroups = new Set(
    cards
      .filter(
        (card) =>
          (drawCount(card) ?? 0) >= minimum &&
          canStackDrawCardAgainstPile(game, card, topDrawGroup)
      )
      .map((card) => drawGroupKey(card))
      .filter((key): key is string => Boolean(key))
  )

  return cards.every((card) => {
    const amount = drawCount(card)
    const group = drawGroupKey(card)

    return Boolean(
      amount &&
      amount >= minimum &&
      group &&
      (canStackDrawCardAgainstPile(game, card, topDrawGroup) ||
        playableGroups.has(group))
    )
  })
}

function canStackDrawCardAgainstPile(
  game: GameState,
  card: Card,
  topDrawGroup: string | null
): boolean {
  const group = drawGroupKey(card)
  if (!group) return false
  if (group === topDrawGroup) return true
  return card.color === "wild" || card.color === game.currentColor
}

function getCardsFromHand(
  game: GameState,
  playerId: string,
  cardIds: string[]
): CommandResult<Card[]> {
  const uniqueCardIds = unique(cardIds)
  if (uniqueCardIds.length !== cardIds.length) {
    return fail("duplicate-card", "A card can only be selected once.")
  }

  const hand = game.handsByPlayerId[playerId] ?? []
  const cards: Card[] = []

  for (const cardId of uniqueCardIds) {
    const card = hand.find((candidate) => candidate.id === cardId)
    if (!card) return fail("card-not-found", "That card is not in your hand.")
    cards.push(card)
  }

  return ok(cards)
}

function handCountAfterPlay(
  game: GameState,
  playerId: string,
  cards: Card[],
  input: PlayCardsInput
) {
  const hand = [...(game.handsByPlayerId[playerId] ?? [])]
  for (const card of cards) removeCard(hand, card.id)

  const primaryCard = cards[cards.length - 1]
  if (primaryCard?.face.kind === "discard-color") {
    for (const cardId of input.discardCardIds ?? []) removeCard(hand, cardId)
  }

  return hand.length
}

function cardsInHandOrder(hand: Card[], cardIds: string[]) {
  const ids = new Set(cardIds)
  return hand.filter((card) => ids.has(card.id))
}

function orderDiscardPileCards(cards: Card[], topCardId: string): Card[] {
  const topCard = cards.find((card) => card.id === topCardId)
  if (!topCard) return cards

  return [...cards.filter((card) => card.id !== topCardId), topCard]
}

function drawCards(game: GameState, count: number): Card[] {
  const drawn: Card[] = []
  for (let i = 0; i < count; i += 1) {
    if (game.drawPile.length === 0) reshuffleDrawPile(game)
    const card = game.drawPile.shift()
    if (!card) break
    drawn.push(card)
  }
  return drawn
}

function addCardsToHand(game: GameState, playerId: string, cards: Card[]) {
  game.handsByPlayerId[playerId] ??= []
  game.handsByPlayerId[playerId]?.push(...cards)
  if (cards.length > 0) clearUnoDeclaration(game, playerId)
}

function reshuffleDrawPile(game: GameState) {
  if (!canReshuffle(game)) return

  const top = game.discardPile.pop()
  game.drawPile = shuffleCards([...game.discardPile, ...game.knockedOutCards])
  game.discardPile = top ? [top] : []
  game.knockedOutCards = []
}

function canReshuffle(game: GameState) {
  return game.discardPile.length > 1 || game.knockedOutCards.length > 0
}

function checkMercyEliminations(game: GameState, context: GameContext) {
  for (const playerId of activePlayerIds(game)) {
    const hand = game.handsByPlayerId[playerId] ?? []
    if (hand.length <= context.houseRules.mercyHandLimit) continue

    game.eliminatedPlayerIds.push(playerId)
    removePlayerFromActivePlay(game, playerId)
    pushEvent(game, {
      type: "player-eliminated",
      playerId,
      message: `${playerName(context, playerId)} crossed ${context.houseRules.mercyHandLimit} cards and was eliminated.`,
    })
  }

  finishGameIfComplete(game, context)

  if (isGameFinished(game)) {
    return
  }

  normalizeInactiveTurnState(game)
}

function removePlayerFromActivePlay(game: GameState, playerId: string) {
  const hand = game.handsByPlayerId[playerId] ?? []
  if (hand.length > 0) {
    game.knockedOutCards.push(...hand)
    game.handsByPlayerId[playerId] = []
  }
  game.unoVulnerablePlayerIds = game.unoVulnerablePlayerIds.filter(
    (targetPlayerId) => targetPlayerId !== playerId
  )
  clearUnoDeclaration(game, playerId)
}

function normalizeInactiveTurnState(
  game: GameState,
  fallbackFromPlayerId?: string
) {
  if (game.drawStack && !isPlayerActive(game, game.drawStack.targetPlayerId)) {
    game.drawStack = null
  }

  if (
    game.pendingChoice &&
    !isPlayerActive(game, game.pendingChoice.playerId)
  ) {
    game.pendingChoice = null
  }

  if (game.turnPlayerId && !isPlayerActive(game, game.turnPlayerId)) {
    game.turnPlayerId = nextPlayerId(
      game,
      fallbackFromPlayerId ?? game.turnPlayerId,
      1
    )
    game.drawnThisTurnPlayerId = null
    game.stagedPlay = null
  } else if (
    game.drawnThisTurnPlayerId &&
    !isPlayerActive(game, game.drawnThisTurnPlayerId)
  ) {
    game.drawnThisTurnPlayerId = null
    game.stagedPlay = null
  }
}

function recordWinner(game: GameState, context: GameContext, playerId: string) {
  if (winnerPlacementFor(game, playerId)) return

  const hand = game.handsByPlayerId[playerId] ?? []
  if (hand.length > 0) {
    game.knockedOutCards.push(...hand)
    game.handsByPlayerId[playerId] = []
  }

  const position = game.winnerPlacements.length + 1
  const placement = {
    playerId,
    position,
    createdAt: new Date().toISOString(),
  }

  game.winnerPlacements.push(placement)
  game.winnerPlayerId ??= playerId
  game.unoVulnerablePlayerIds = game.unoVulnerablePlayerIds.filter(
    (targetPlayerId) => targetPlayerId !== playerId
  )
  clearUnoDeclaration(game, playerId)

  pushEvent(game, {
    type: "game-won",
    playerId,
    message: `${playerName(context, playerId)} takes ${ordinal(position)} place.`,
  })
}

function finishGameIfComplete(game: GameState, context: GameContext) {
  const remaining = activePlayerIds(game)
  if (remaining.length > 1) return

  if (remaining.length === 1) {
    recordWinner(game, context, remaining[0] as string)
  }

  game.turnPlayerId = null
  game.drawStack = null
  game.pendingChoice = null
  game.drawnThisTurnPlayerId = null
  game.stagedPlay = null
  game.unoVulnerablePlayerIds = []
  game.unoDeclaredPlayerIds = []
  game.voteKickedPlayerIds = []
}

function advanceTurn(game: GameState, fromPlayerId: string, steps: number) {
  if (isGameFinished(game)) return
  game.turnPlayerId = nextPlayerId(game, fromPlayerId, steps)
  game.drawnThisTurnPlayerId = null
  game.stagedPlay = null
}

function advanceTurnAfterSkips(
  game: GameState,
  fromPlayerId: string,
  skipCount: number
) {
  if (isGameFinished(game)) return
  game.turnPlayerId = nextPlayerIdSkippingOpponents(
    game,
    fromPlayerId,
    skipCount
  )
  game.drawnThisTurnPlayerId = null
  game.stagedPlay = null
}

function nextPlayerId(
  game: GameState,
  fromPlayerId: string,
  steps: number
): string {
  const active = activePlayerIds(game)
  if (active.length === 0) return fromPlayerId
  if (active.length === 1) return active[0] as string

  let index = game.playerOrder.indexOf(fromPlayerId)
  if (index < 0) index = 0

  let remainingSteps = steps
  const activeSet = new Set(active)
  while (remainingSteps > 0) {
    index =
      (index + game.direction + game.playerOrder.length) %
      game.playerOrder.length
    const candidate = game.playerOrder[index] as string
    if (activeSet.has(candidate)) remainingSteps -= 1
  }

  return game.playerOrder[index] as string
}

function nextPlayerIdSkippingOpponents(
  game: GameState,
  fromPlayerId: string,
  skipCount: number
): string {
  const active = activePlayerIds(game)
  if (active.length === 0) return fromPlayerId
  if (active.length === 1) return active[0] as string

  let index = game.playerOrder.indexOf(fromPlayerId)
  if (index < 0) index = 0

  let remainingSkips = skipCount
  const activeSet = new Set(active)

  while (true) {
    index =
      (index + game.direction + game.playerOrder.length) %
      game.playerOrder.length
    const candidate = game.playerOrder[index] as string
    if (!activeSet.has(candidate)) continue

    if (candidate === fromPlayerId) {
      if (remainingSkips <= 0) return candidate
      continue
    }

    if (remainingSkips > 0) {
      remainingSkips -= 1
      continue
    }

    return candidate
  }
}

function activePlayerIds(game: GameState): string[] {
  return game.playerOrder.filter((playerId) => isPlayerActive(game, playerId))
}

function isPlayerActive(game: GameState, playerId: string): boolean {
  return (
    game.playerOrder.includes(playerId) &&
    !game.eliminatedPlayerIds.includes(playerId) &&
    !(game.voteKickedPlayerIds ?? []).includes(playerId) &&
    !(game.waitingPlayerIds ?? []).includes(playerId) &&
    !winnerPlacementFor(game, playerId)
  )
}

function winnerPlacementFor(game: GameState, playerId: string) {
  return (
    game.winnerPlacements.find(
      (placement) => placement.playerId === playerId
    ) ?? null
  )
}

function isGameFinished(game: GameState): boolean {
  return game.turnPlayerId === null
}

function projectPendingChoice(
  game: GameState
): PublicGameSnapshot["pendingChoice"] {
  if (!game.pendingChoice) return null

  return {
    ...game.pendingChoice,
    drawnCards: game.pendingChoice.drawnCards.map((card) => ({ ...card })),
  }
}

function ordinal(value: number): string {
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th"

  return `${value}${suffix}`
}

function projectStagedPlay(game: GameState): PublicGameSnapshot["stagedPlay"] {
  if (game.pendingChoice?.drawnCards.length) {
    return {
      playerId: game.pendingChoice.playerId,
      kind: "roulette",
      cards: game.pendingChoice.drawnCards.map((card) => ({ ...card })),
    }
  }

  const staged = game.stagedPlay
  if (!staged) return null

  const hand = game.handsByPlayerId[staged.playerId] ?? []
  const cards = staged.cardIds
    .map((cardId) => hand.find((card) => card.id === cardId))
    .filter((card): card is Card => Boolean(card))

  if (cards.length === 0) return null

  return {
    playerId: staged.playerId,
    kind: staged.kind,
    cards: cards.map((card) => ({ ...card })),
    chosenColor: staged.chosenColor,
    declaredUno: staged.declaredUno,
    rotateHands: staged.rotateHands,
    swapWithPlayerId: staged.swapWithPlayerId,
  }
}

function rotateHands(game: GameState) {
  const active = activePlayerIds(game)
  if (active.length < 2) return

  const snapshot = new Map(
    active.map((playerId) => [
      playerId,
      [...(game.handsByPlayerId[playerId] ?? [])],
    ])
  )

  for (const playerId of active) {
    const receiver = nextPlayerId(game, playerId, 1)
    game.handsByPlayerId[receiver] = snapshot.get(playerId) ?? []
  }

  game.unoVulnerablePlayerIds = []
  game.unoDeclaredPlayerIds = []
}

function swapHands(game: GameState, a: string, b: string) {
  const aHand = game.handsByPlayerId[a] ?? []
  const bHand = game.handsByPlayerId[b] ?? []
  game.handsByPlayerId[a] = bHand
  game.handsByPlayerId[b] = aHand
  game.unoVulnerablePlayerIds = []
  clearUnoDeclaration(game, a)
  clearUnoDeclaration(game, b)
}

function beginTurnAction(game: GameState, playerId?: string) {
  game.unoVulnerablePlayerIds = []
  if (playerId) clearUnoDeclaration(game, playerId)
  game.stagedPlay = null
}

function clearUnoDeclaration(game: GameState, playerId: string) {
  game.unoDeclaredPlayerIds = (game.unoDeclaredPlayerIds ?? []).filter(
    (targetPlayerId) => targetPlayerId !== playerId
  )
}

function topDiscard(game: GameState): Card | null {
  return game.discardPile[game.discardPile.length - 1] ?? null
}

function removeCard(cards: Card[], cardId: string) {
  const index = cards.findIndex((card) => card.id === cardId)
  if (index >= 0) cards.splice(index, 1)
}

function drawCount(card: Card): number | null {
  switch (card.face.kind) {
    case "draw":
    case "wild-draw":
    case "wild-reverse-draw":
      return card.face.count
    default:
      return null
  }
}

function isPowerCard(card: Card): boolean {
  return card.face.kind !== "number"
}

function isForbiddenFinalCard(card: Card): boolean {
  return card.face.kind !== "number" && card.face.kind !== "discard-color"
}

function colorFor(card: Card): PlayColor {
  return card.color === "wild" ? "red" : card.color
}

function faceSymbol(face: CardFace): string {
  switch (face.kind) {
    case "number":
      return `number:${face.value}`
    case "draw":
      return `draw:${face.count}`
    case "wild-draw":
      return `wild-draw:${face.count}`
    case "wild-reverse-draw":
      return `wild-reverse-draw:${face.count}`
    default:
      return face.kind
  }
}

function playedMessage(
  context: GameContext,
  playerId: string,
  cards: Card[]
): string {
  const name = playerName(context, playerId)
  if (cards.length === 1)
    return `${name} played ${cardLabel(cards[0] as Card)}.`
  return `${name} played ${cards.length} cards.`
}

function cardLabel(card: Card): string {
  const color = card.color === "wild" ? "Wild" : capitalize(card.color)
  switch (card.face.kind) {
    case "number":
      return `${color} ${card.face.value}`
    case "skip":
      return `${color} Skip`
    case "skip-everyone":
      return `${color} Skip Everyone`
    case "reverse":
      return `${color} Reverse`
    case "draw":
      return `${color} +${card.face.count}`
    case "discard-color":
      return `${color} Discard All`
    case "wild":
      return "Wild"
    case "wild-draw":
      return `Wild +${card.face.count}`
    case "wild-reverse-draw":
      return "Wild Reverse +4"
    case "wild-color-roulette":
      return "Wild Color Roulette"
  }
}

function playerName(context: GameContext, playerId: string): string {
  return (
    context.players.find((player) => player.id === playerId)?.name ?? "A player"
  )
}

function pushEvent(
  game: GameState,
  event: Omit<GameEvent, "id" | "createdAt">
) {
  game.events.push({
    ...event,
    id: `${Date.now()}:${game.events.length}:${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  })
  if (game.events.length > 40) game.events = game.events.slice(-40)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function ok<T>(data: T): CommandResult<T> {
  return { ok: true, data }
}

function fail<T>(code: string, message: string): CommandResult<T> {
  return { ok: false, error: { code, message } }
}
