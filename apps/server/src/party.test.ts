import { afterEach, describe, expect, it, vi } from "vitest"
import type { GameState } from "@workspace/game"
import { RoomManager } from "./room-manager"

afterEach(() => vi.useRealTimers())

function setup(onRoomUpdated = vi.fn()) {
  const manager = new RoomManager({ onRoomUpdated })
  const created = manager.createRoom({
    playerName: "A",
    sessionId: "party-host",
  })
  if (!created.ok) throw new Error(created.error.message)
  const code = created.data.room.code
  const a = created.data.player.id
  const others = ["B", "C", "D"].map((name) => {
    const joined = manager.joinRoom({
      code,
      playerName: name,
      sessionId: `party-${name}`,
    })
    if (!joined.ok) throw new Error(joined.error.message)
    manager.setReady(code, joined.data.player.id, true)
    return joined.data.player.id
  })
  const ids = [a, ...others]
  ids.forEach((id) => manager.registerConnection(code, id, `socket-${id}`))
  expect(manager.startRoom(code, a).ok).toBe(true)
  const room = (
    manager as unknown as { rooms: Map<string, { gameState: GameState }> }
  ).rooms.get(code)!
  const game = room.gameState
  game.handsByPlayerId = Object.fromEntries(
    ids.map((id) => [
      id,
      [
        { id: `${id}-red`, color: "red", face: { kind: "number", value: 1 } },
        { id: `${id}-blue`, color: "blue", face: { kind: "number", value: 2 } },
      ],
    ])
  )
  game.discardPile = [
    { id: "top", color: "red", face: { kind: "number", value: 3 } },
  ]
  game.currentColor = "red"
  game.drawPile = [
    { id: "knockout", color: "blue", face: { kind: "number", value: 4 } },
    { id: "left-in-deck", color: "red", face: { kind: "number", value: 5 } },
  ]
  game.turnPlayerId = a
  return {
    manager,
    code,
    a,
    b: others[0]!,
    c: others[1]!,
    ids,
    game,
    onRoomUpdated,
  }
}

function knockout(table: ReturnType<typeof setup>) {
  table.game.handsByPlayerId[table.a] = Array.from({ length: 25 }, (_, i) => ({
    id: `frozen-${i}`,
    color: "yellow",
    face: { kind: "number", value: 1 },
  }))
  const result = table.manager.drawOne(table.code, table.a)
  if (!result.ok || !result.data.game?.lastGift)
    throw new Error("Expected a last gift")
  return result.data.game.lastGift
}

describe("party choice lifecycle", () => {
  it("expires a trade and broadcasts fresh state without another player action", () => {
    vi.useFakeTimers()
    const { manager, code, a, b, game, onRoomUpdated } = setup()
    expect(
      manager.offerBlindTrade(code, a, {
        cardId: `${a}-blue`,
        targetPlayerId: b,
      }).ok
    ).toBe(true)
    vi.advanceTimersByTime(9_999)
    expect(game.tradeOffer).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(game.tradeOffer).toBeNull()
    expect(onRoomUpdated).toHaveBeenCalledOnce()
    expect(manager.getPlayerGame(code, a)?.canDraw).toBe(true)
    expect(game.tradeUsedPlayerIds).toEqual([])
  })

  it("automatically skips a last gift and unblocks every survivor", () => {
    vi.useFakeTimers()
    const table = setup()
    const gift = knockout(table)
    expect(
      table.manager.getPlayerGame(table.code, table.a)?.lastGiftCards
    ).toHaveLength(26)
    expect(table.manager.getPlayerGame(table.code, table.b)?.canDraw).toBe(
      false
    )
    vi.advanceTimersByTime(10_000)
    expect(table.game.lastGifts).toEqual([])
    expect(table.manager.getPlayerGame(table.code, table.b)?.canDraw).toBe(true)
    expect(table.onRoomUpdated).toHaveBeenCalledOnce()
    expect(
      table.manager.resolveLastGift(table.code, table.a, { giftId: gift.id }).ok
    ).toBe(false)
    expect(table.game.knockedOutCards).toHaveLength(26)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("only cancels an offer when the participant's last connection drops", () => {
    vi.useFakeTimers()
    const { manager, code, a, b, game } = setup()
    manager.registerConnection(code, b, "second-device")
    manager.offerBlindTrade(code, a, { cardId: `${a}-blue`, targetPlayerId: b })
    manager.unregisterConnection(code, b, `socket-${b}`)
    expect(game.tradeOffer).not.toBeNull()
    manager.unregisterConnection(code, b, "second-device")
    expect(game.tradeOffer).toBeNull()
    expect(game.tradeUsedPlayerIds).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("skips a disconnected donor and preserves the next player's turn", () => {
    vi.useFakeTimers()
    const table = setup()
    knockout(table)
    const result = table.manager.unregisterConnection(
      table.code,
      table.a,
      `socket-${table.a}`
    )
    expect(result?.game?.lastGift).toBeNull()
    expect(result?.game?.turnPlayerId).toBe(table.b)
    expect(table.game.knockedOutCards).toHaveLength(26)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps private cards out of public snapshots and supporter views", () => {
    const table = setup()
    const gift = knockout(table)
    const room = table.manager.getRoom(table.code)
    expect(room.ok && JSON.stringify(room.data.game?.lastGift)).not.toContain(
      "frozen-"
    )
    expect(
      table.manager.getPlayerGame(table.code, table.c)?.lastGiftCards
    ).toEqual([])
    expect(
      table.manager.getSpectatorView(table.code, table.a, table.b)
    ).toBeNull()
    expect(table.manager.supportPlayer(table.code, table.a, table.b).ok).toBe(
      false
    )
    expect(
      table.manager.resolveLastGift(table.code, table.a, {
        giftId: gift.id,
        cardId: "knockout",
        targetPlayerId: table.b,
      }).ok
    ).toBe(true)
    expect(
      table.manager
        .getPlayerGame(table.code, table.b)
        ?.hand.map((card) => card.id)
    ).toContain("knockout")
    expect(table.manager.getPlayerGame(table.code, table.a)?.hand).toEqual([])
  })
})
