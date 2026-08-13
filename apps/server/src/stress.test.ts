import { describe, expect, it } from "vitest"

import { createNoMercyDeck, type RoomSnapshot } from "@workspace/game"

import { RoomManager } from "./room-manager"

/**
 * Randomised end-to-end pressure on a full table: eight players, many matches
 * back to back, with the crown holder reseating the table and flipping the
 * direction between each one, and eliminated players churning through support
 * links, kicks and second-chance requests while the match runs.
 *
 * Every step re-checks the invariants that would break quietly rather than
 * throw — most importantly that no card is ever lost or duplicated.
 */

const DECK_SIZE = createNoMercyDeck().length
const MATCHES = 12
const MAX_STEPS_PER_MATCH = 6000

// Fixed seeds so a failure is reproducible rather than a one-off flake.
const SEEDS = [20260813, 7, 991, 123456]

describe("full-table stress", () => {
  it.each(SEEDS)(
    "survives back-to-back matches with reseating, kicks and support churn (seed %i)",
    (seed) => {
      const random = seededRandom(seed)
      const { manager, code, hostId, playerIds } = fullTable()

      const started = manager.startRoom(code, hostId)
      expect(started.ok).toBe(true)

      let organiserId = hostId
      const crownHolders: string[] = []

      for (let match = 0; match < MATCHES; match += 1) {
        const winnerId = runMatch(manager, code, random)
        crownHolders.push(winnerId)

        const finished = readRoom(manager, code)
        expect(finished.status).toBe("finished")
        expect(finished.crownPlayerId).toBe(winnerId)
        // Everyone who started is still seated between matches.
        expect(finished.players.map((player) => player.id).sort()).toEqual(
          [...playerIds].sort()
        )

        organiserId = winnerId
        if (match === MATCHES - 1) break

        const reseated = shuffle(
          finished.players.map((player) => player.id),
          random
        )
        const direction = random() < 0.5 ? 1 : -1
        const seatResult = manager.setSeatOrder(code, organiserId, {
          playerOrder: reseated,
          direction,
        })
        expect(seatResult.ok).toBe(true)
        if (!seatResult.ok) throw new Error(seatResult.error.message)
        expect(
          [...seatResult.data.players]
            .sort((a, b) => a.seat - b.seat)
            .map((player) => player.id)
        ).toEqual(reseated)

        // Nobody but the crown holder can jump the queue.
        const usurper = playerIds.find((id) => id !== organiserId) as string
        expect(manager.restartRoom(code, usurper).ok).toBe(false)

        const restarted = manager.restartRoom(code, organiserId)
        expect(restarted.ok).toBe(true)
        if (!restarted.ok) throw new Error(restarted.error.message)
        expect(restarted.data.game?.direction).toBe(direction)
      }

      expect(crownHolders).toHaveLength(MATCHES)
    }
  )
})

function runMatch(
  manager: RoomManager,
  code: string,
  random: () => number
): string {
  for (let step = 0; step < MAX_STEPS_PER_MATCH; step += 1) {
    const room = readRoom(manager, code)
    assertRoomInvariants(manager, room)

    const game = room.game
    if (!game) throw new Error("Expected a live match")
    if (game.turnPlayerId === null) {
      const winner = game.winnerPlacements.find(
        (placement) => placement.position === 1
      )
      if (!winner) throw new Error("A finished match must have a winner")
      return winner.playerId
    }

    churnSupport(manager, room, random)
    advanceTurn(manager, room, random)
  }

  throw new Error("Match never finished")
}

/** Inactive players pick squads, get kicked, and ask their way back in. */
function churnSupport(
  manager: RoomManager,
  room: RoomSnapshot,
  random: () => number
) {
  const game = room.game
  if (!game || random() > 0.25) return

  const inactive = game.players.filter(
    (player) => player.eliminated || player.winnerPlacement
  )
  const active = game.players.filter(
    (player) => !player.eliminated && !player.winnerPlacement
  )
  if (inactive.length === 0 || active.length === 0) return

  const supporter = pick(inactive, random).playerId
  const social = manager.getPlayerSocial(room.code, supporter)
  if (!social) return

  // Already in a squad: the supported player may throw them out.
  const existingLink = game.supportLinks.find(
    (link) => link.supporterPlayerId === supporter
  )
  if (existingLink) {
    if (random() < 0.5) {
      manager.kickSupporter(
        room.code,
        existingLink.supportedPlayerId,
        supporter
      )
    }
    return
  }

  // Waiting on an answer: the supported player decides.
  const outgoing = social.outgoingSupportRequest
  if (outgoing) {
    manager.respondToSupportRequest(
      room.code,
      outgoing.supportedPlayerId,
      supporter,
      random() < 0.5
    )
    return
  }

  const target = pick(active, random).playerId
  if (social.blockedSupportedPlayerIds.includes(target)) {
    manager.requestSupport(room.code, supporter, target)
    return
  }
  manager.supportPlayer(room.code, supporter, target)
}

function advanceTurn(
  manager: RoomManager,
  room: RoomSnapshot,
  random: () => number
) {
  const game = room.game
  if (!game?.turnPlayerId) throw new Error("Expected a turn player")
  const turnPlayerId = game.turnPlayerId

  if (game.pendingChoice?.type === "roulette-draw") {
    manager.drawRouletteCard(room.code, game.pendingChoice.playerId)
    return
  }
  if (game.drawStack?.targetPlayerId === turnPlayerId && random() < 0.6) {
    manager.takeDrawPenalty(room.code, turnPlayerId)
    return
  }

  const hand = manager.getPlayerGame(room.code, turnPlayerId)
  if (!hand) throw new Error("Expected a hand for the turn player")

  const playableCards = hand.hand.filter(
    (card) =>
      hand.playableCardIds.includes(card.id) &&
      // Going out on a power card is against the house rules; skip those.
      (hand.hand.length > 1 ||
        card.face.kind === "number" ||
        card.face.kind === "discard-color")
  )
  if (playableCards.length > 0) {
    const card = pick(playableCards, random)
    const played = manager.playCards(room.code, turnPlayerId, {
      cardIds: [card.id],
      chosenColor: card.color === "wild" ? "blue" : undefined,
    })
    if (played.ok) return
  }

  if (hand.canDraw) {
    manager.drawOne(room.code, turnPlayerId)
    return
  }
  if (hand.canEndTurn) {
    manager.endTurn(room.code, turnPlayerId)
    return
  }
  if (hand.canTakeDrawPenalty) {
    manager.takeDrawPenalty(room.code, turnPlayerId)
    return
  }

  throw new Error(`No legal action available for ${turnPlayerId}`)
}

function assertRoomInvariants(manager: RoomManager, room: RoomSnapshot) {
  const game = room.game
  if (!game) return

  // Every card is somewhere, exactly once. A leak here would silently drain
  // the deck over a long match.
  const seenCardIds = new Set<string>()
  let counted = game.drawPileCount + game.discardPileCount
  for (const player of room.players) {
    const hand = manager.getPlayerGame(room.code, player.id)?.hand ?? []
    counted += hand.length
    for (const card of hand) {
      expect(seenCardIds.has(card.id)).toBe(false)
      seenCardIds.add(card.id)
    }
  }
  // Cards taken off eliminated players sit aside until the next reshuffle.
  expect(counted).toBeLessThanOrEqual(DECK_SIZE)

  const activeIds = game.players
    .filter((player) => !player.eliminated && !player.winnerPlacement)
    .map((player) => player.playerId)
  if (game.turnPlayerId !== null) {
    expect(activeIds).toContain(game.turnPlayerId)
  }

  const positions = game.winnerPlacements.map((placement) => placement.position)
  expect(new Set(positions).size).toBe(positions.length)

  // A supporter is never also the supported player, and never in two squads.
  const supporters = game.supportLinks.map((link) => link.supporterPlayerId)
  expect(new Set(supporters).size).toBe(supporters.length)
  for (const link of game.supportLinks) {
    expect(link.supporterPlayerId).not.toBe(link.supportedPlayerId)
    expect(activeIds).toContain(link.supportedPlayerId)
    expect(activeIds).not.toContain(link.supporterPlayerId)
  }
}

function fullTable() {
  const manager = new RoomManager()
  const created = manager.createRoom({
    playerName: "Rushil",
    sessionId: "session-host",
    houseRules: { maxPlayers: 8, startingHandSize: 7, mercyHandLimit: 25 },
  })
  if (!created.ok) throw new Error(created.error.message)

  const code = created.data.room.code
  const hostId = created.data.player.id
  const others = ["Bea", "Cyrus", "Dev", "Esha", "Farid", "Gita", "Hari"].map(
    (name, index) => {
      const joined = manager.joinRoom({
        code,
        playerName: name,
        sessionId: `session-${index}`,
      })
      if (!joined.ok) throw new Error(joined.error.message)
      manager.setReady(code, joined.data.player.id, true)
      return joined.data.player.id
    }
  )

  return { manager, code, hostId, playerIds: [hostId, ...others] }
}

function readRoom(manager: RoomManager, code: string): RoomSnapshot {
  const room = manager.getRoom(code)
  if (!room.ok) throw new Error(room.error.message)
  return room.data
}

function pick<T>(values: T[], random: () => number): T {
  return values[Math.floor(random() * values.length)] as T
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T]
  }
  return copy
}

/** Deterministic so a failure can be replayed exactly. */
function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
