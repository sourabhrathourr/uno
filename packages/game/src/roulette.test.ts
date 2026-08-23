import { describe, expect, it } from "vitest"

import {
  createGame,
  drawRouletteCard,
  type Card,
  type GameContext,
} from "./index"

const context: GameContext = {
  players: [player("a", "A", 1), player("b", "B", 2), player("c", "C", 3)],
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

describe("color roulette draw", () => {
  it("eliminates a player as soon as pending pickup cards cross the mercy limit", () => {
    const game = createGame(context)
    const alreadyRevealed = Array.from({ length: 5 }, (_, index) =>
      numberCard(`revealed-${index}`, "blue", 1)
    )
    game.handsByPlayerId.b = Array.from({ length: 20 }, (_, index) =>
      numberCard(`hand-${index}`, "red", 2)
    )
    game.drawPile = [numberCard("next-non-yellow", "green", 3)]
    game.pendingChoice = {
      type: "roulette-draw",
      playerId: "b",
      color: "yellow",
      drawnCards: alreadyRevealed,
    }
    game.turnPlayerId = "b"

    const result = drawRouletteCard(game, context, "b")

    expect(result.ok).toBe(true)
    expect(game.eliminatedPlayerIds).toContain("b")
    expect(game.pendingChoice).toBeNull()
    expect(game.handsByPlayerId.b).toEqual([])
    expect(game.knockedOutCards).toHaveLength(26)
  })
})

function numberCard(
  id: string,
  color: Exclude<Card["color"], "wild">,
  value: Extract<Card["face"], { kind: "number" }>["value"]
): Card {
  return { id, color, face: { kind: "number", value } }
}

function player(id: string, name: string, seat: number) {
  const now = "2026-07-10T00:00:00.000Z"
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
