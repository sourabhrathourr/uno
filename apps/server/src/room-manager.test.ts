import { beforeEach, describe, expect, it, vi } from "vitest"

import { RoomManager } from "./room-manager"

describe("RoomManager support squads", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"))
  })

  it("persists a support link across reconnects and limits full-hand access to it", () => {
    const { manager, code, hostId, playerBId } = startedRoomWithInactiveHost()

    expect(manager.supportPlayer(code, hostId, playerBId).ok).toBe(true)
    expect(manager.getSupportView(code, hostId)?.playerId).toBe(playerBId)

    manager.registerConnection(code, hostId, "socket-a")
    manager.unregisterConnection(code, hostId, "socket-a")
    manager.registerConnection(code, hostId, "socket-b")

    const room = manager.getRoom(code)
    expect(room.ok && room.data.game?.supportLinks).toMatchObject([
      { supporterPlayerId: hostId, supportedPlayerId: playerBId },
    ])
    expect(manager.getSupportView(code, hostId)?.playerId).toBe(playerBId)
  })

  it("authorizes squad chat by current membership and retains messages after a kick", () => {
    const { manager, code, hostId, playerBId, playerCId } =
      startedRoomWithInactiveHost()
    expect(manager.supportPlayer(code, hostId, playerBId).ok).toBe(true)

    const sent = manager.sendChatMessage(code, hostId, {
      channel: "squad",
      kind: "text",
      body: "@B play the wild",
      mentionPlayerIds: [playerBId],
    })
    expect(sent.ok).toBe(true)
    expect(
      manager.getPlayerSocial(code, playerBId)?.squadChatMessages
    ).toHaveLength(1)
    expect(manager.getPlayerSocial(code, playerCId)?.squadChatMessages).toEqual(
      []
    )

    const invalidMention = manager.sendChatMessage(code, playerBId, {
      channel: "squad",
      kind: "text",
      body: "@C spy for us",
      mentionPlayerIds: [playerCId],
    })
    expect(invalidMention).toMatchObject({
      ok: false,
      error: { code: "mention-not-in-channel" },
    })

    vi.advanceTimersByTime(700)
    expect(
      manager.sendChatMessage(code, hostId, {
        channel: "squad",
        kind: "text",
        body: "This ping is invisible",
        mentionPlayerIds: [playerBId],
      })
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-mention" },
    })

    expect(manager.kickSupporter(code, playerBId, hostId).ok).toBe(true)
    expect(manager.getPlayerSocial(code, hostId)?.squadChatMessages).toEqual([])
    expect(
      manager.getPlayerSocial(code, hostId)?.blockedSupportedPlayerIds
    ).toEqual([playerBId])
    expect(
      manager.getPlayerSocial(code, playerBId)?.squadChatMessages[0]?.body
    ).toBe("@B play the wild")
    const publicRoom = manager.getRoom(code)
    expect(
      publicRoom.ok && "supportBlocks" in (publicRoom.data.game ?? {})
    ).toBe(false)
    expect(manager.supportPlayer(code, hostId, playerBId)).toMatchObject({
      ok: false,
      error: { code: "support-blocked" },
    })
    expect(manager.supportPlayer(code, hostId, playerCId).ok).toBe(true)
  })

  it("accepts table reactions from active and inactive players with a spam cooldown", () => {
    const { manager, code, hostId, playerBId } = startedRoomWithInactiveHost()

    expect(
      manager.sendTableReaction(code, hostId, { kind: "emoji", body: "🔥" }).ok
    ).toBe(true)
    expect(
      manager.sendTableReaction(code, hostId, { kind: "emoji", body: "😂" })
    ).toMatchObject({ ok: false, error: { code: "reaction-too-fast" } })
    expect(
      manager.sendTableReaction(code, playerBId, {
        kind: "preset",
        body: "BIG MOVE",
      }).ok
    ).toBe(true)

    const room = manager.getRoom(code)
    expect(room.ok && room.data.game?.hypeMeter.value).toBe(20)
    expect(room.ok && room.data.game?.tableReactions).toHaveLength(2)
  })
})

function startedRoomWithInactiveHost() {
  const manager = new RoomManager()
  const created = manager.createRoom({
    playerName: "A",
    sessionId: "session-a",
    houseRules: { startingHandSize: 5, mercyHandLimit: 5 },
  })
  if (!created.ok) throw new Error(created.error.message)
  const code = created.data.room.code
  const hostId = created.data.player.id

  const joinedB = manager.joinRoom({
    code,
    playerName: "B",
    sessionId: "session-b",
  })
  const joinedC = manager.joinRoom({
    code,
    playerName: "C",
    sessionId: "session-c",
  })
  if (!joinedB.ok || !joinedC.ok) throw new Error("Players failed to join")
  const playerBId = joinedB.data.player.id
  const playerCId = joinedC.data.player.id

  manager.setReady(code, playerBId, true)
  manager.setReady(code, playerCId, true)
  const started = manager.startRoom(code, hostId)
  if (!started.ok) throw new Error(started.error.message)
  const eliminated = manager.drawOne(code, hostId)
  if (!eliminated.ok) throw new Error(eliminated.error.message)

  return { manager, code, hostId, playerBId, playerCId }
}
