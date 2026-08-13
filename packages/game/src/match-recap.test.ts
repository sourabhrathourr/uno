import { describe, expect, it } from "vitest"

import {
  catchUno,
  createGame,
  drawOne,
  playCards,
  projectPublicGame,
  settleTurnClock,
  MAX_COUNTED_TURN_MS,
  takeDrawPenalty,
  type GameContext,
  type GameState,
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

describe("match recap", () => {
  it("stays hidden until the match is actually over", () => {
    const game = createGame(context)

    expect(projectPublicGame(game, context).matchRecap).toBeNull()

    finish(game)
    expect(projectPublicGame(game, context).matchRecap).not.toBeNull()
  })

  it("counts what each player did, not just who won", () => {
    // The hand is dealt from a shuffled deck, so the cards in play are set up
    // explicitly here. Playing whatever landed first would sometimes deal a
    // draw stack or a colour roulette, and the draw below would then be
    // illegal for reasons that have nothing to do with the recap.
    const game = createGame(context)
    game.handsByPlayerId.a = [
      numberCard("a-red-5", "red", 5),
      numberCard("a-blue-1", "blue", 1),
    ]
    game.discardPile = [numberCard("top-red-3", "red", 3)]
    game.currentColor = "red"
    game.turnPlayerId = "a"
    game.drawStack = null
    game.pendingChoice = null

    expect(
      playCards(game, context, "a", { cardIds: ["a-red-5"] }).ok
    ).toBe(true)

    const turnPlayerId = game.turnPlayerId as string
    expect(turnPlayerId).not.toBe("a")
    expect(drawOne(game, context, turnPlayerId).ok).toBe(true)

    finish(game)
    const recap = projectPublicGame(game, context).matchRecap
    if (!recap) throw new Error("Expected a recap")

    const statsA = recap.players.find((stats) => stats.playerId === "a")
    const drawer = recap.players.find(
      (stats) => stats.playerId === turnPlayerId
    )
    expect(statsA?.cardsPlayed).toBe(1)
    expect(statsA?.turnsTaken).toBe(1)
    expect(drawer?.cardsDrawn).toBe(1)
    expect(recap.totalCardsPlayed).toBe(1)
  })

  it("records a draw penalty against the player who ate it", () => {
    const game = createGame(context)
    game.drawStack = { amount: 10, minimum: 10, targetPlayerId: "b" }
    game.turnPlayerId = "b"

    expect(takeDrawPenalty(game, context, "b").ok).toBe(true)

    finish(game)
    const recap = projectPublicGame(game, context).matchRecap
    const statsB = recap?.players.find((stats) => stats.playerId === "b")
    expect(statsB?.penaltyCardsTaken).toBe(10)
    expect(statsB?.biggestPenaltyTaken).toBe(10)
    // The penalty cards also count toward everything they drew.
    expect(statsB?.cardsDrawn).toBeGreaterThanOrEqual(10)
  })

  it("credits an UNO catch to the catcher and the miss to the target", () => {
    const game = createGame(context)
    game.unoVulnerablePlayerIds = ["b"]

    expect(catchUno(game, context, "a", { targetPlayerId: "b" }).ok).toBe(true)

    finish(game)
    const recap = projectPublicGame(game, context).matchRecap
    expect(
      recap?.players.find((stats) => stats.playerId === "a")?.unoCatches
    ).toBe(1)
    expect(
      recap?.players.find((stats) => stats.playerId === "b")?.timesCaught
    ).toBe(1)
  })

  it("banks a player's thinking time when the turn moves on", () => {
    const game = createGame(context)
    const first = game.turnPlayerId as string
    game.turnStartedAtMs = Date.now() - 2_000

    // Hand the turn to someone else and settle the clock.
    game.turnPlayerId = game.playerOrder.find((id) => id !== first) as string
    settleTurnClock(game)

    finish(game)
    const recap = projectPublicGame(game, context).matchRecap
    const stats = recap?.players.find((entry) => entry.playerId === first)
    expect(stats?.timedTurns).toBe(1)
    expect(stats?.totalTurnMs).toBeGreaterThanOrEqual(1_900)
    expect(stats?.totalTurnMs).toBeLessThan(4_000)
  })

  it("caps a single turn so an idle player cannot skew the leaderboard", () => {
    const game = createGame(context)
    const first = game.turnPlayerId as string
    // Walked away for an hour.
    game.turnStartedAtMs = Date.now() - 60 * 60 * 1000

    game.turnPlayerId = game.playerOrder.find((id) => id !== first) as string
    settleTurnClock(game)

    const stats = game.statsByPlayerId[first]
    expect(stats?.totalTurnMs).toBe(MAX_COUNTED_TURN_MS)
  })

  it("orders the recap by finish position, stragglers last", () => {
    const game = createGame(context)
    game.winnerPlacements = [
      { playerId: "c", position: 1, createdAt: "2026-07-10T00:01:00.000Z" },
      { playerId: "a", position: 2, createdAt: "2026-07-10T00:02:00.000Z" },
    ]
    finish(game)

    const recap = projectPublicGame(game, context).matchRecap
    expect(recap?.players.map((stats) => stats.playerId)).toEqual([
      "c",
      "a",
      "b",
    ])
  })

  it("tracks the biggest stack that ever built up", () => {
    const game = createGame(context)
    game.biggestDrawStack = 0
    game.drawStack = { amount: 4, minimum: 4, targetPlayerId: "b" }
    game.biggestDrawStack = 14
    finish(game)

    expect(projectPublicGame(game, context).matchRecap?.biggestDrawStack).toBe(
      14
    )
  })
})

function numberCard(id: string, color: "red" | "blue", value: 1 | 3 | 5) {
  return { id, color, face: { kind: "number", value } } as const
}

/** Collapses the match so the recap projects. */
function finish(game: GameState) {
  game.turnPlayerId = null
  game.finishedAt ??= "2026-07-10T00:05:00.000Z"
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
