import { useEffect, useMemo, useRef, useState } from "react"
import { cancelLaunches, launchCards, launchToStage } from "./flights"
import type {
  Card,
  PlayCardsInput,
  PlayColor,
  PlayerGameSnapshot,
  RoomSnapshot,
  StageCardsInput,
} from "@workspace/game"

import type { PlayChoices } from "@/lib/play-rules"
import {
  canStageCardWithSelection,
  cardsInIdOrder,
  derivePlay,
} from "@/lib/play-rules"

export type GameActions = {
  playCards: (input: PlayCardsInput) => void | boolean
  stageCards: (input: StageCardsInput) => void
  drawCard: () => void
  endTurn: () => void
  takePenalty: () => void
  drawRouletteCard: () => void
  catchUno: (targetPlayerId: string) => void
}

const NO_CHOICES: PlayChoices = {
  chosenColor: null,
  declaredUno: false,
  wantsSwap: false,
  swapWithPlayerId: "",
  wantsRotate: false,
}

/**
 * Card selection and play for the 3D table. The rules come from the same
 * module the classic table uses (`derivePlay`), so a play built here is
 * byte-for-byte the play the classic table would send.
 */
export function useSeatedPlay({
  room,
  selfId,
  playerGame,
  actions,
  actionPending,
}: {
  room: RoomSnapshot
  selfId: string
  playerGame: PlayerGameSnapshot | null
  actions: GameActions
  actionPending: boolean
}) {
  const game = room.game
  const hand = playerGame?.hand ?? []
  const [selectedIds, setSelectedIds] = useState<Array<string>>([])
  const [choices, setChoices] = useState<PlayChoices>(NO_CHOICES)
  const [pendingIds, setPendingIds] = useState<Array<string>>([])
  const isMyTurn = Boolean(
    game && game.turnPlayerId === selfId && !game.lastGift
  )
  const playableCardIds = playerGame?.playableCardIds ?? []
  const drawStack = game?.drawStack ?? null
  const ready =
    !actionPending &&
    playerGame?.roomVersion === room.version &&
    pendingIds.length === 0

  const activeOpponents = room.players.filter((candidate) => {
    const state = game?.players.find((p) => p.playerId === candidate.id)
    return (
      candidate.id !== selfId &&
      !state?.eliminated &&
      !state?.voteKicked &&
      !state?.waiting &&
      !state?.winnerPlacement
    )
  })

  function derive(ids: Array<string>, nextChoices: PlayChoices) {
    return derivePlay({
      hand,
      selectedCardIds: ids,
      playableCardIds,
      drawStack,
      isMyTurn,
      ready,
      activeOpponentCount: activeOpponents.length,
      choices: nextChoices,
    })
  }
  const play = derive(selectedIds, choices)

  // Not your turn any more, or the cards left your hand: start fresh.
  useEffect(() => {
    if (!isMyTurn) {
      setSelectedIds([])
      setChoices(NO_CHOICES)
    }
  }, [isMyTurn])
  const handKey = hand.map((card) => card.id).join(":")
  useEffect(() => {
    const inHand = new Set(hand.map((card) => card.id))
    setSelectedIds((current) => {
      const kept = current.filter((id) => inHand.has(id))
      return kept.length === current.length ? current : kept
    })
    setPendingIds([])
  }, [handKey, playerGame?.roomVersion])
  useEffect(() => {
    if (selectedIds.length === 0) setChoices(NO_CHOICES)
  }, [selectedIds.length])
  // An action that failed unlocks without changing the hand.
  useEffect(() => {
    if (!actionPending && pendingIds.length) {
      const timer = window.setTimeout(() => {
        cancelLaunches(pendingIds)
        setPendingIds([])
      }, 1_500)
      return () => window.clearTimeout(timer)
    }
  }, [actionPending, pendingIds.length])

  // Like the classic table: show the selection to the room as it's built.
  const stageKey = `${selectedIds.join(":")}|${choices.chosenColor}|${choices.declaredUno}|${choices.wantsRotate}|${choices.wantsSwap}|${choices.swapWithPlayerId}`
  const stagedOnce = useRef(false)
  useEffect(() => {
    if (!isMyTurn) return
    if (!stagedOnce.current && selectedIds.length === 0) return
    stagedOnce.current = true
    actions.stageCards({
      cardIds: selectedIds,
      chosenColor: choices.chosenColor ?? undefined,
      declaredUno: choices.declaredUno || undefined,
      rotateHands: choices.wantsRotate || undefined,
      swapWithPlayerId: choices.wantsSwap
        ? choices.swapWithPlayerId || undefined
        : undefined,
    })
  }, [stageKey, isMyTurn])

  function canSelect(card: Card) {
    return canStageCardWithSelection(
      card,
      cardsInIdOrder(hand, selectedIds),
      playableCardIds,
      isMyTurn && !actionPending,
      drawStack
    )
  }

  /** Returns false when the card can't join this play. */
  function toggle(card: Card): boolean {
    if (selectedIds.includes(card.id)) {
      const current = cardsInIdOrder(hand, selectedIds)
      // Dropping the discard-colour card drops the cards riding on it.
      const removingFirstDiscard =
        selectedIds[0] === card.id &&
        current[0]?.face.kind === "discard-color" &&
        selectedIds.length > 1
      setSelectedIds(
        removingFirstDiscard ? [] : selectedIds.filter((id) => id !== card.id)
      )
      return true
    }
    if (!canSelect(card)) return false
    launchToStage([card])
    setSelectedIds([...selectedIds, card.id])
    return true
  }

  function submit(ids = selectedIds, nextChoices = choices) {
    const next = derive(ids, nextChoices)
    if (!next.canSubmitPlay) return false
    // Start the flight from the hand now; the pile takes it over on confirm.
    launchCards(next.selectedCards)
    const accepted = actions.playCards(next.input)
    if (accepted !== false) setPendingIds(ids)
    else cancelLaunches(ids)
    return accepted !== false
  }

  /**
   * A card thrown onto the table: add it to the selection and play right
   * away if nothing else is needed. If the play still needs a choice (a
   * colour, a swap target), it stays selected and the overlay asks.
   */
  function throwCard(card: Card) {
    const ids = selectedIds.includes(card.id)
      ? selectedIds
      : canSelect(card)
        ? [...selectedIds, card.id]
        : selectedIds.length === 0 && playableCardIds.includes(card.id)
          ? [card.id]
          : null
    if (!ids) return "rejected" as const
    if (ids !== selectedIds) {
      // If it can't go straight down, it waits in the tray.
      launchToStage([card])
      setSelectedIds(ids)
    }
    const autoUno = derive(ids, choices).canDeclareUno
    const nextChoices = autoUno ? { ...choices, declaredUno: true } : choices
    if (autoUno) setChoices(nextChoices)
    return submit(ids, nextChoices)
      ? ("played" as const)
      : ("needs-choice" as const)
  }

  function chooseColor(color: PlayColor) {
    const nextChoices = { ...choices, chosenColor: color }
    setChoices(nextChoices)
    // Picking the colour is the last step for most wild plays.
    const next = derive(selectedIds, nextChoices)
    if (next.canSubmitPlay && !next.canChooseSwap && !next.canChooseRotate)
      submit(selectedIds, nextChoices)
  }

  function updateChoices(patch: Partial<PlayChoices>) {
    setChoices((current) => ({ ...current, ...patch }))
  }

  const canPassTurn =
    ready &&
    isMyTurn &&
    Boolean(playerGame.canEndTurn) &&
    selectedIds.length === 0
  const canDraw =
    !actionPending &&
    isMyTurn &&
    Boolean(playerGame?.canDraw) &&
    game?.pendingChoice?.type !== "roulette-draw"
  const rouletteForMe =
    game?.pendingChoice?.type === "roulette-draw" &&
    game.pendingChoice.playerId === selfId
  const nameOf = (id: string) =>
    room.players.find((player) => player.id === id)?.name ?? "Someone"

  // Things only the classic view can handle yet.
  const needsClassic = Boolean(
    (game?.tradeOffer &&
      (game.tradeOffer.targetPlayerId === selfId ||
        game.tradeOffer.playerId === selfId)) ||
    (playerGame?.lastGiftCards.length ?? 0) > 0
  )

  const visibleHand = useMemo(
    () => hand.filter((card) => !pendingIds.includes(card.id)),
    [hand, pendingIds]
  )

  return {
    hand: visibleHand,
    isMyTurn,
    selectedIds,
    /** In the tray: picked, and not already on its way to the pile. */
    selectedCards: cardsInIdOrder(hand, selectedIds).filter(
      (card) => !pendingIds.includes(card.id)
    ),
    canEditStage: isMyTurn && !actionPending && pendingIds.length === 0,
    choices,
    play,
    canSelect,
    toggle,
    throwCard,
    submit: () => submit(),
    clear: () => setSelectedIds([]),
    chooseColor,
    updateChoices,
    canPassTurn,
    canDraw,
    canTakePenalty:
      !actionPending &&
      playerGame?.roomVersion === room.version &&
      Boolean(playerGame.canTakeDrawPenalty),
    rouletteForMe,
    catchable: (playerGame?.catchablePlayerIds ?? []).map((id) => ({
      id,
      name: nameOf(id),
    })),
    swapTargets: activeOpponents.map((player) => ({
      id: player.id,
      name: player.name,
    })),
    drawStack,
    needsClassic,
    actions,
  }
}

export type SeatedPlay = ReturnType<typeof useSeatedPlay>
