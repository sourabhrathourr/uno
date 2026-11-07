import type {
  Card,
  PlayCardsInput,
  PlayColor,
  RoomSnapshot,
} from "@workspace/game"

/**
 * Which cards can go down together, and what a play needs before it can be
 * sent. Shared by the classic table and the lounge's 3D table so both apply
 * exactly the same rules; the server still has the final say.
 */

type DrawStack = NonNullable<RoomSnapshot["game"]>["drawStack"]

export function canStageCardWithSelection(
  card: Card,
  selectedCards: Array<Card>,
  playableCardIds: Array<string>,
  isMyTurn: boolean,
  drawStack: DrawStack
) {
  if (!isMyTurn) return false
  if (selectedCards.some((selected) => selected.id === card.id)) return true
  if (selectedCards.length === 0) return playableCardIds.includes(card.id)
  return canPlayStagedCards(
    [...selectedCards, card],
    playableCardIds,
    drawStack
  )
}

export function cardsInIdOrder(cards: Array<Card>, cardIds: Array<string>) {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  return cardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is Card => Boolean(card))
}

export function canPlayStagedCards(
  cards: Array<Card>,
  playableCardIds: Array<string>,
  drawStack: DrawStack
) {
  if (cards.length === 0) return false
  if (cards.length === 1) return playableCardIds.includes(cards[0]?.id ?? "")
  if (drawStack) {
    return (
      canStackDrawCards(drawStack, cards, playableCardIds) &&
      cards.some((card) => playableCardIds.includes(card.id))
    )
  }
  if (isDiscardFirstStage(cards, playableCardIds)) return true
  return (
    (sameNumberGroup(cards) ||
      sameDrawGroup(cards) ||
      sameActionGroup(cards)) &&
    cards.some((card) => playableCardIds.includes(card.id))
  )
}

export function isDiscardFirstStage(
  cards: Array<Card>,
  playableCardIds: Array<string>
) {
  const discardCard = cards.at(0)
  if (!discardCard || discardCard.face.kind !== "discard-color") return false
  if (!playableCardIds.includes(discardCard.id)) return false

  return cards.slice(1).every((card) => card.color === discardCard.color)
}

export function canStackDrawCards(
  drawStack: DrawStack | null,
  cards: Array<Card>,
  playableCardIds: Array<string>
) {
  if (!drawStack || cards.length === 0 || !sameDrawGroup(cards)) return false

  const minimum = drawStack.minimum
  const playableGroups = new Set(
    cards
      .filter((card) => playableCardIds.includes(card.id))
      .map((card) => drawGroupKey(card))
      .filter((key): key is string => Boolean(key))
  )

  return cards.every((card) => {
    const amount = drawAmount(card)
    const group = drawGroupKey(card)

    return Boolean(
      amount && amount >= minimum && group && playableGroups.has(group)
    )
  })
}

export function drawAmount(card: Card) {
  switch (card.face.kind) {
    case "draw":
    case "wild-draw":
    case "wild-reverse-draw":
      return card.face.count
    default:
      return null
  }
}

export function isForbiddenFinalCard(card: Card) {
  return card.face.kind !== "number" && card.face.kind !== "discard-color"
}

export function sameNumberGroup(cards: Array<Card>) {
  const first = cards.at(0)
  if (!first || first.face.kind !== "number") return false
  const value = first.face.value
  return cards.every(
    (card) => card.face.kind === "number" && card.face.value === value
  )
}

export function sameDrawGroup(cards: Array<Card>) {
  const first = cards.at(0)
  const key = first ? drawGroupKey(first) : null
  if (!key) return false
  return cards.every((card) => drawGroupKey(card) === key)
}

export function sameActionGroup(cards: Array<Card>) {
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

export function drawGroupKey(card: Card) {
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

export type PlayChoices = {
  chosenColor: PlayColor | null
  declaredUno: boolean
  wantsSwap: boolean
  swapWithPlayerId: string
  wantsRotate: boolean
}

/**
 * Everything the table needs to know about the cards selected so far: which
 * choices the play still needs, whether it can be sent, and the exact input
 * to send. `ready` is false while an earlier action is still in flight or
 * the hand is out of date with the room.
 */
export function derivePlay({
  hand,
  selectedCardIds,
  playableCardIds,
  drawStack,
  isMyTurn,
  ready,
  activeOpponentCount,
  choices,
}: {
  hand: Array<Card>
  selectedCardIds: Array<string>
  playableCardIds: Array<string>
  drawStack: DrawStack | null
  isMyTurn: boolean
  ready: boolean
  activeOpponentCount: number
  choices: PlayChoices
}) {
  const selectedCards = cardsInIdOrder(hand, selectedCardIds)
  const needsColor = selectedCards.some((card) => card.color === "wild")
  const remainingAfterSelectedCards = hand.length - selectedCards.length
  const canChooseSwap =
    selectedCards.length === 1 &&
    selectedCards[0]?.face.kind === "number" &&
    selectedCards[0].face.value === 7 &&
    remainingAfterSelectedCards > 0 &&
    activeOpponentCount > 0
  const canChooseRotate =
    selectedCards.length === 1 &&
    selectedCards[0]?.face.kind === "number" &&
    selectedCards[0].face.value === 0 &&
    remainingAfterSelectedCards > 0
  const discardActionCard =
    selectedCards[0]?.face.kind === "discard-color" ? selectedCards[0] : null
  const discardExtraCards = discardActionCard ? selectedCards.slice(1) : []
  const submittedCards = discardActionCard ? [discardActionCard] : selectedCards
  const needsSwap = canChooseSwap && choices.wantsSwap
  const selectedCardsCanPlay = canPlayStagedCards(
    selectedCards,
    playableCardIds,
    drawStack
  )
  const remainingAfterPlay = hand.length - selectedCards.length
  const finishesWithForbiddenPower =
    remainingAfterPlay === 0 &&
    submittedCards.some((card) => isForbiddenFinalCard(card))
  const canDeclareUno =
    isMyTurn &&
    selectedCards.length > 0 &&
    selectedCardsCanPlay &&
    remainingAfterPlay === 1
  const canSubmitPlay =
    ready &&
    isMyTurn &&
    selectedCardsCanPlay &&
    !finishesWithForbiddenPower &&
    (!needsColor || Boolean(choices.chosenColor)) &&
    (!needsSwap || Boolean(choices.swapWithPlayerId))
  const discardExtraCardIds = discardExtraCards.map((card) => card.id)
  const input: PlayCardsInput = {
    cardIds: discardActionCard ? [discardActionCard.id] : selectedCardIds,
    declaredUno: canDeclareUno && choices.declaredUno,
    chosenColor: choices.chosenColor ?? undefined,
    discardCardIds: discardExtraCardIds.length
      ? discardExtraCardIds
      : undefined,
    topCardId: discardActionCard
      ? (selectedCards[selectedCards.length - 1]?.id ?? discardActionCard.id)
      : undefined,
    swapWithPlayerId: needsSwap ? choices.swapWithPlayerId : undefined,
    rotateHands: canChooseRotate && choices.wantsRotate ? true : undefined,
  }
  return {
    selectedCards,
    needsColor,
    canChooseSwap,
    canChooseRotate,
    discardActionCard,
    discardExtraCards,
    submittedCards,
    needsSwap,
    selectedCardsCanPlay,
    finishesWithForbiddenPower,
    canDeclareUno,
    canSubmitPlay,
    input,
  }
}
