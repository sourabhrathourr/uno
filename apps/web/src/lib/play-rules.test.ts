import { describe, expect, it } from "vitest"
import { canStageCardWithSelection, derivePlay } from "./play-rules"
import type { Card } from "@workspace/game"

import type { PlayChoices } from "./play-rules"

const num = (id: string, color: Card["color"], value: number): Card => ({
  id,
  color,
  face: { kind: "number", value: value as never },
})
const wild4: Card = {
  id: "w4",
  color: "wild",
  face: { kind: "wild-draw", count: 4 },
}
const discard: Card = {
  id: "dc",
  color: "red",
  face: { kind: "discard-color" },
}

const none: PlayChoices = {
  chosenColor: null,
  declaredUno: false,
  wantsSwap: false,
  swapWithPlayerId: "",
  wantsRotate: false,
}

function derive(
  hand: Array<Card>,
  selected: Array<string>,
  playable: Array<string>,
  choices: Partial<PlayChoices> = {}
) {
  return derivePlay({
    hand,
    selectedCardIds: selected,
    playableCardIds: playable,
    drawStack: null,
    isMyTurn: true,
    ready: true,
    activeOpponentCount: 2,
    choices: { ...none, ...choices },
  })
}

describe("derivePlay", () => {
  it("needs a colour before a wild can go", () => {
    const hand = [wild4, num("r5", "red", 5), num("b2", "blue", 2)]
    expect(derive(hand, ["w4"], ["w4"]).canSubmitPlay).toBe(false)
    const ready = derive(hand, ["w4"], ["w4"], { chosenColor: "blue" })
    expect(ready.canSubmitPlay).toBe(true)
    expect(ready.input).toMatchObject({ cardIds: ["w4"], chosenColor: "blue" })
  })

  it("plays same-number groups and offers UNO when one card is left", () => {
    const hand = [
      num("r5", "red", 5),
      num("b5", "blue", 5),
      num("g1", "green", 1),
    ]
    const play = derive(hand, ["r5", "b5"], ["r5"], { declaredUno: true })
    expect(play.canSubmitPlay).toBe(true)
    expect(play.canDeclareUno).toBe(true)
    expect(play.input.declaredUno).toBe(true)
  })

  it("won't finish on a power card", () => {
    const play = derive([wild4], ["w4"], ["w4"], { chosenColor: "red" })
    expect(play.finishesWithForbiddenPower).toBe(true)
    expect(play.canSubmitPlay).toBe(false)
  })

  it("needs a target once a 7 swap is chosen", () => {
    const hand = [num("r7", "red", 7), num("b1", "blue", 1)]
    expect(derive(hand, ["r7"], ["r7"]).canChooseSwap).toBe(true)
    expect(
      derive(hand, ["r7"], ["r7"], { wantsSwap: true }).canSubmitPlay
    ).toBe(false)
    const swap = derive(hand, ["r7"], ["r7"], {
      wantsSwap: true,
      swapWithPlayerId: "p2",
    })
    expect(swap.input.swapWithPlayerId).toBe("p2")
  })

  it("sends discard-colour extras separately with the last pick on top", () => {
    const hand = [
      discard,
      num("r3", "red", 3),
      num("r8", "red", 8),
      num("b1", "blue", 1),
    ]
    const play = derive(hand, ["dc", "r3", "r8"], ["dc"])
    expect(play.input).toMatchObject({
      cardIds: ["dc"],
      discardCardIds: ["r3", "r8"],
      topCardId: "r8",
    })
  })

  it("waits while an action is in flight", () => {
    const hand = [num("r5", "red", 5), num("b2", "blue", 2)]
    const play = derivePlay({
      hand,
      selectedCardIds: ["r5"],
      playableCardIds: ["r5"],
      drawStack: null,
      isMyTurn: true,
      ready: false,
      activeOpponentCount: 1,
      choices: none,
    })
    expect(play.canSubmitPlay).toBe(false)
  })
})

describe("canStageCardWithSelection", () => {
  it("only groups cards that can go down together", () => {
    const r5 = num("r5", "red", 5)
    const b5 = num("b5", "blue", 5)
    const b6 = num("b6", "blue", 6)
    expect(canStageCardWithSelection(b5, [r5], ["r5"], true, null)).toBe(true)
    expect(canStageCardWithSelection(b6, [r5], ["r5"], true, null)).toBe(false)
    expect(canStageCardWithSelection(r5, [], ["r5"], false, null)).toBe(false)
  })
})
