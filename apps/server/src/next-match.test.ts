import { describe, expect, it } from "vitest"

import { RoomManager } from "./room-manager"

describe("winner-led next match", () => {
  it("hands the crown to first place and lets only them start again", () => {
    const table = finishedMatch()
    const { manager, code, winnerId, everyoneElse } = table

    const room = manager.getRoom(code)
    expect(room.ok && room.data.crownPlayerId).toBe(winnerId)

    for (const outsiderId of everyoneElse) {
      expect(manager.restartRoom(code, outsiderId)).toMatchObject({
        ok: false,
        error: { code: "crown-only" },
      })
    }

    const restarted = manager.restartRoom(code, winnerId)
    expect(restarted.ok).toBe(true)
    expect(restarted.ok && restarted.data.status).toBe("playing")
  })

  it("lets the crown holder reseat the table and flip the direction", () => {
    const { manager, code, winnerId, everyoneElse } = finishedMatch()

    const before = manager.getRoom(code)
    if (!before.ok) throw new Error("Expected the room")
    const reversedOrder = [...before.data.players]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => player.id)
      .reverse()

    expect(
      manager.setSeatOrder(code, everyoneElse[0] as string, {
        playerOrder: reversedOrder,
        direction: -1,
      })
    ).toMatchObject({ ok: false, error: { code: "crown-only" } })

    const seated = manager.setSeatOrder(code, winnerId, {
      playerOrder: reversedOrder,
      direction: -1,
    })
    expect(seated.ok).toBe(true)
    if (!seated.ok) throw new Error("Expected the seating to apply")
    expect(
      [...seated.data.players]
        .sort((a, b) => a.seat - b.seat)
        .map((player) => player.id)
    ).toEqual(reversedOrder)
    expect(seated.data.players.map((player) => player.seat)).toEqual([
      1, 2, 3, 4,
    ])
    expect(seated.data.nextMatchDirection).toBe(-1)

    const restarted = manager.restartRoom(code, winnerId)
    expect(restarted.ok).toBe(true)
    if (!restarted.ok) throw new Error("Expected the restart")
    // The new match respects both the seating and the chosen direction.
    expect(restarted.data.game?.direction).toBe(-1)
    expect(
      restarted.data.game?.players.map((player) => player.playerId)
    ).toEqual(reversedOrder)
  })

  it("rejects a seating list that is not exactly the seated players", () => {
    const { manager, code, winnerId, everyoneElse } = finishedMatch()

    expect(
      manager.setSeatOrder(code, winnerId, {
        playerOrder: [winnerId, everyoneElse[0] as string],
        direction: 1,
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-seat-order" } })

    expect(
      manager.setSeatOrder(code, winnerId, {
        playerOrder: [winnerId, winnerId, winnerId, winnerId],
        direction: 1,
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-seat-order" } })
  })

  it("refuses to reseat a table mid-match", () => {
    const { manager, code, winnerId } = finishedMatch()
    const restarted = manager.restartRoom(code, winnerId)
    if (!restarted.ok) throw new Error("Expected the restart")

    expect(
      manager.setSeatOrder(code, winnerId, {
        playerOrder: restarted.data.players.map((player) => player.id),
        direction: 1,
      })
    ).toMatchObject({ ok: false, error: { code: "game-in-progress" } })
  })

  it("falls back to the host before anybody has won", () => {
    const { manager, code, hostId, playerIds } = lobbyRoom()

    const room = manager.getRoom(code)
    expect(room.ok && room.data.crownPlayerId).toBeNull()

    expect(
      manager.setSeatOrder(code, playerIds[1] as string, {
        playerOrder: playerIds,
        direction: 1,
      })
    ).toMatchObject({ ok: false, error: { code: "host-only" } })
    expect(
      manager.setSeatOrder(code, hostId, {
        playerOrder: playerIds,
        direction: 1,
      }).ok
    ).toBe(true)
  })

  it("moves the crown to whoever wins the next match", () => {
    const table = finishedMatch()
    const { manager, code, winnerId } = table

    expect(manager.restartRoom(code, winnerId).ok).toBe(true)
    const secondWinnerId = playUntilFinished(manager, code)

    const room = manager.getRoom(code)
    expect(room.ok && room.data.crownPlayerId).toBe(secondWinnerId)
    expect(manager.restartRoom(code, secondWinnerId).ok).toBe(true)
  })
})

function lobbyRoom() {
  const manager = new RoomManager()
  const created = manager.createRoom({
    playerName: "Host",
    sessionId: "session-host",
    // A tiny mercy limit makes matches resolve in a handful of draws.
    houseRules: { startingHandSize: 2, mercyHandLimit: 3 },
  })
  if (!created.ok) throw new Error(created.error.message)

  const code = created.data.room.code
  const hostId = created.data.player.id
  const otherIds = ["Bea", "Cyrus", "Dev"].map((name, index) => {
    const joined = manager.joinRoom({
      code,
      playerName: name,
      sessionId: `session-${index}`,
    })
    if (!joined.ok) throw new Error(joined.error.message)
    manager.setReady(code, joined.data.player.id, true)
    return joined.data.player.id
  })

  return { manager, code, hostId, otherIds, playerIds: [hostId, ...otherIds] }
}

function finishedMatch() {
  const table = lobbyRoom()
  const started = table.manager.startRoom(table.code, table.hostId)
  if (!started.ok) throw new Error(started.error.message)

  const winnerId = playUntilFinished(table.manager, table.code)
  // Who wins is up to the shuffle, so tests compare against the crown holder
  // rather than assuming it is or is not the host.
  const everyoneElse = table.playerIds.filter((id) => id !== winnerId)
  return { ...table, winnerId, everyoneElse }
}

/**
 * Drives a real match to completion by always taking the safest legal action,
 * then returns the player who took first place.
 */
function playUntilFinished(manager: RoomManager, code: string): string {
  for (let step = 0; step < 4000; step += 1) {
    const room = manager.getRoom(code)
    if (!room.ok) throw new Error(room.error.message)
    const game = room.data.game
    if (!game) throw new Error("Expected a live match")
    if (game.turnPlayerId === null) {
      const winner = game.winnerPlacements.find(
        (placement) => placement.position === 1
      )
      if (!winner) throw new Error("Expected a first-place finish")
      return winner.playerId
    }

    const turnPlayerId = game.turnPlayerId
    if (game.pendingChoice?.type === "roulette-draw") {
      manager.drawRouletteCard(code, game.pendingChoice.playerId)
      continue
    }
    if (game.drawStack?.targetPlayerId === turnPlayerId) {
      manager.takeDrawPenalty(code, turnPlayerId)
      continue
    }

    const hand = manager.getPlayerGame(code, turnPlayerId)
    if (!hand) throw new Error(`Expected a hand for ${turnPlayerId}`)
    const playableId = hand.playableCardIds[0]
    const playable = hand.hand.find((card) => card.id === playableId)
    // Going out on a power card is illegal, so only play when it is clearly safe.
    const safeToPlay =
      playable &&
      (hand.hand.length > 1 ||
        playable.face.kind === "number" ||
        playable.face.kind === "discard-color")
    if (safeToPlay) {
      const played = manager.playCards(code, turnPlayerId, {
        cardIds: [playable.id],
        chosenColor: playable.color === "wild" ? "red" : undefined,
      })
      if (played.ok) continue
    }

    if (hand.canDraw) {
      manager.drawOne(code, turnPlayerId)
      continue
    }
    if (hand.canEndTurn) {
      manager.endTurn(code, turnPlayerId)
      continue
    }

    throw new Error(`Stuck with no legal action for ${turnPlayerId}`)
  }

  throw new Error("Match did not finish in a reasonable number of steps")
}
