import { beforeEach, describe, expect, it, vi } from "vitest"

import { RoomManager } from "./room-manager"

describe("RoomManager room expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"))
  })

  it("removes rooms after seven days without activity", () => {
    const expiredCodes: string[] = []
    const manager = new RoomManager({
      onRoomExpired: (code) => expiredCodes.push(code),
    })
    const created = manager.createRoom({
      playerName: "A",
      sessionId: "session-a",
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const code = created.data.room.code

    vi.setSystemTime(new Date("2026-07-16T23:59:59.999Z"))
    expect(manager.getRoom(code).ok).toBe(true)

    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"))
    expect(manager.pruneExpiredRooms()).toEqual([code])
    expect(expiredCodes).toEqual([code])
    expect(manager.getRoom(code)).toMatchObject({
      ok: false,
      error: { code: "room-not-found" },
    })
    expect(manager.hasPlayerSession(code, "session-a")).toBe(false)
    expect(manager.getAnalysisRooms().rooms).toEqual([])
  })

  it("extends room expiry when the room has activity", () => {
    const manager = new RoomManager()
    const created = manager.createRoom({
      playerName: "A",
      sessionId: "session-a",
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const code = created.data.room.code
    const hostId = created.data.player.id

    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"))
    expect(manager.registerConnection(code, hostId, "socket-a")).not.toBeNull()

    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"))
    expect(manager.getRoom(code).ok).toBe(true)

    vi.setSystemTime(new Date("2026-07-23T00:00:00.000Z"))
    expect(manager.getRoom(code).ok).toBe(false)
  })
})

describe("RoomManager support squads", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"))
  })

  it("recognizes only sessions that belong to the requested room", () => {
    const manager = new RoomManager()
    const created = manager.createRoom({
      playerName: "Host",
      sessionId: "session-host-1234",
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(
      manager.hasPlayerSession(created.data.room.code, "session-host-1234")
    ).toBe(true)
    expect(
      manager.hasPlayerSession(created.data.room.code, "session-stranger-1234")
    ).toBe(false)
    expect(manager.hasPlayerSession("XXXXXX", "session-host-1234")).toBe(false)
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

  it("accepts avatar emoji reactions from active and inactive players with a spam cooldown", () => {
    const { manager, code, hostId, playerBId } = startedRoomWithInactiveHost()

    expect(
      manager.sendAvatarEmojiReaction(code, hostId, { body: "😭" }).ok
    ).toBe(true)
    expect(
      manager.sendAvatarEmojiReaction(code, hostId, { body: "😂" })
    ).toMatchObject({
      ok: false,
      error: { code: "avatar-emoji-reaction-too-fast" },
    })
    expect(
      manager.sendAvatarEmojiReaction(code, playerBId, { body: "👀" }).ok
    ).toBe(true)

    const room = manager.getRoom(code)
    expect(room.ok && room.data.game?.avatarEmojiReactions).toHaveLength(2)
  })

  it("accepts only provider-approved GIPHY selections in chat", () => {
    const manager = new RoomManager({
      resolveGif: (provider, id) =>
        provider === "giphy" && id === "winner-123"
          ? {
              body: "https://media.giphy.com/original.webp",
              label: "Victory dance",
            }
          : null,
    })
    const { code, hostId } = startedRoomWithInactiveHost(manager)

    expect(
      manager.sendChatMessage(code, hostId, {
        channel: "public",
        kind: "gif",
        gifProvider: "giphy",
        body: "winner-123",
      }).ok
    ).toBe(true)

    const room = manager.getRoom(code)
    expect(room.ok && room.data.chatMessages[0]).toMatchObject({
      kind: "gif",
      body: "https://media.giphy.com/original.webp",
      label: "Victory dance",
    })

    vi.advanceTimersByTime(700)
    expect(
      manager.sendChatMessage(code, hostId, {
        channel: "public",
        kind: "gif",
        gifProvider: "giphy",
        body: "not-approved",
      })
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-chat-gif" },
    })
  })
})

describe("RoomManager vote-kicks", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"))
  })

  it("soft-kicks a lobby player from readiness and starts them inactive for the next match", () => {
    const { manager, code, hostId, playerBId, playerCId } = lobbyRoom()

    expect(manager.setReady(code, playerBId, true).ok).toBe(true)
    expect(manager.setReady(code, playerCId, true).ok).toBe(true)

    const startedVote = manager.startVoteKick(code, hostId, playerCId)
    expect(startedVote.ok).toBe(true)
    if (!startedVote.ok) return
    const voteKickId =
      startedVote.data.chatMessages.find(
        (message) => message.kind === "vote-kick"
      )?.voteKick?.id ?? ""

    const joinedD = manager.joinRoom({
      code,
      playerName: "D",
      sessionId: "session-d",
    })
    expect(joinedD.ok).toBe(true)
    if (!joinedD.ok) return
    expect(
      manager.castVoteKick(code, joinedD.data.player.id, voteKickId, "yes")
    ).toMatchObject({
      ok: false,
      error: { code: "vote-kick-not-eligible" },
    })
    expect(manager.setReady(code, joinedD.data.player.id, true).ok).toBe(true)

    expect(manager.castVoteKick(code, playerBId, voteKickId, "yes").ok).toBe(
      true
    )
    vi.advanceTimersByTime(25_000)

    const lobby = manager.getRoom(code)
    expect(lobby.ok && lobby.data.voteKick.lobbyVoteKickedPlayerIds).toEqual([
      playerCId,
    ])
    expect(
      lobby.ok &&
        lobby.data.players.find((candidate) => candidate.id === playerCId)
          ?.ready
    ).toBe(false)

    const started = manager.startRoom(code, hostId)
    expect(started.ok).toBe(true)
    expect(
      started.ok &&
        started.data.game?.players.find(
          (candidate) => candidate.playerId === playerCId
        )
    ).toMatchObject({
      voteKicked: true,
      handCount: 0,
    })
  })

  it("soft-kicks an active player after the full vote window and lets them support", () => {
    const { manager, code, hostId, playerBId, playerCId } = startedRoom()

    const startedVote = manager.startVoteKick(code, playerBId, hostId)
    expect(startedVote.ok).toBe(true)
    if (!startedVote.ok) return
    const voteKickId =
      startedVote.data.chatMessages.find(
        (message) => message.kind === "vote-kick"
      )?.voteKick?.id ?? ""

    vi.advanceTimersByTime(24_999)
    const beforeResolution = manager.getRoom(code)
    expect(
      beforeResolution.ok &&
        beforeResolution.data.game?.players.find(
          (candidate) => candidate.playerId === hostId
        )?.voteKicked
    ).toBe(false)

    expect(manager.castVoteKick(code, playerCId, voteKickId, "yes").ok).toBe(
      true
    )
    vi.advanceTimersByTime(1)

    const room = manager.getRoom(code)
    expect(
      room.ok &&
        room.data.game?.players.find(
          (candidate) => candidate.playerId === hostId
        )
    ).toMatchObject({
      voteKicked: true,
      handCount: 0,
    })
    expect(room.ok && room.data.game?.turnPlayerId).not.toBe(hostId)
    expect(manager.getPlayerGame(code, hostId)?.hand).toEqual([])
    expect(manager.supportPlayer(code, hostId, playerBId).ok).toBe(true)
    expect(manager.startVoteKick(code, hostId, playerBId)).toMatchObject({
      ok: false,
      error: { code: "vote-kicked-player" },
    })
  })

  it("keeps a failed vote in chat and blocks the same target during cooldown", () => {
    const { manager, code, hostId, playerBId, playerCId } = lobbyRoom()
    expect(manager.setReady(code, playerBId, true).ok).toBe(true)

    const startedVote = manager.startVoteKick(code, hostId, playerCId)
    expect(startedVote.ok).toBe(true)
    if (!startedVote.ok) return
    const voteKickId =
      startedVote.data.chatMessages.find(
        (message) => message.kind === "vote-kick"
      )?.voteKick?.id ?? ""
    expect(manager.castVoteKick(code, playerBId, voteKickId, "yes").ok).toBe(
      true
    )
    expect(manager.castVoteKick(code, playerBId, voteKickId, "no").ok).toBe(
      true
    )

    vi.advanceTimersByTime(25_000)

    const failed = manager.getRoom(code)
    const poll = failed.ok
      ? failed.data.chatMessages.find((message) => message.id === voteKickId)
          ?.voteKick
      : null
    expect(poll).toMatchObject({
      status: "failed",
      result: "not-kicked",
      yesCount: 1,
      noCount: 1,
    })
    expect(failed.ok && failed.data.voteKick.cooldowns).toMatchObject([
      { targetPlayerId: playerCId },
    ])
    expect(manager.startVoteKick(code, hostId, playerCId)).toMatchObject({
      ok: false,
      error: { code: "vote-kick-cooldown" },
    })

    vi.advanceTimersByTime(60_000)
    expect(manager.startVoteKick(code, hostId, playerCId).ok).toBe(true)
  })
})

describe("RoomManager waiting players", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"))
  })

  it("lets a player join an active match as waiting and participate socially", () => {
    const { manager, code, hostId, playerBId, playerCId } = startedRoom()

    const startedVote = manager.startVoteKick(code, hostId, playerBId)
    expect(startedVote.ok).toBe(true)
    if (!startedVote.ok) return
    const voteKickId =
      startedVote.data.chatMessages.find(
        (message) => message.kind === "vote-kick"
      )?.voteKick?.id ?? ""

    const joinedD = manager.joinRoom({
      code,
      playerName: "D",
      sessionId: "session-d",
    })

    expect(joinedD.ok).toBe(true)
    if (!joinedD.ok) return
    const playerDId = joinedD.data.player.id
    expect(
      joinedD.data.room.game?.players.find(
        (candidate) => candidate.playerId === playerDId
      )
    ).toMatchObject({
      waiting: true,
      handCount: 0,
    })
    expect(manager.getPlayerGame(code, playerDId)?.hand).toEqual([])
    expect(manager.supportPlayer(code, playerDId, playerBId).ok).toBe(true)
    expect(manager.getSupportView(code, playerDId)?.playerId).toBe(playerBId)
    expect(
      manager.sendAvatarEmojiReaction(code, playerDId, { body: "👀" }).ok
    ).toBe(true)
    expect(
      manager.castVoteKick(code, playerDId, voteKickId, "yes")
    ).toMatchObject({
      ok: false,
      error: { code: "vote-kick-not-eligible" },
    })

    expect(manager.castVoteKick(code, playerCId, voteKickId, "no").ok).toBe(
      true
    )
    vi.advanceTimersByTime(25_000)

    expect(manager.startVoteKick(code, playerDId, playerCId).ok).toBe(true)
  })

  it("keeps waiting players out of gameplay until the next match starts", () => {
    const { manager, code, hostId, playerBId } = twoPlayerStartedRoom()
    const joinedC = manager.joinRoom({
      code,
      playerName: "C",
      sessionId: "session-c",
    })
    expect(joinedC.ok).toBe(true)
    if (!joinedC.ok) return
    const playerCId = joinedC.data.player.id

    expect(manager.startVoteKick(code, hostId, playerCId)).toMatchObject({
      ok: false,
      error: { code: "vote-kick-target-ineligible" },
    })
    expect(manager.drawOne(code, playerCId)).toMatchObject({
      ok: false,
      error: { code: "not-your-turn" },
    })

    const finished = manager.drawOne(code, hostId)
    expect(finished.ok && finished.data.status).toBe("finished")
    expect(
      finished.ok &&
        finished.data.game?.players.find(
          (candidate) => candidate.playerId === playerCId
        )
    ).toMatchObject({ waiting: true })

    const restarted = manager.restartRoom(code, playerBId)
    expect(restarted.ok).toBe(true)
    expect(
      restarted.ok &&
        restarted.data.game?.players.find(
          (candidate) => candidate.playerId === playerCId
        )
    ).toMatchObject({
      waiting: false,
      handCount: 5,
    })
  })

  it("lets players join a finished room as normal next-match participants", () => {
    const { manager, code, hostId, playerBId } = twoPlayerStartedRoom()
    expect(manager.drawOne(code, hostId).ok).toBe(true)

    const joinedC = manager.joinRoom({
      code,
      playerName: "C",
      sessionId: "session-c",
    })
    expect(joinedC.ok).toBe(true)
    if (!joinedC.ok) return
    const playerCId = joinedC.data.player.id
    expect(
      joinedC.data.room.game?.players.some(
        (candidate) => candidate.playerId === playerCId
      )
    ).toBe(false)

    const restarted = manager.restartRoom(code, playerBId)
    expect(
      restarted.ok &&
        restarted.data.game?.players.find(
          (candidate) => candidate.playerId === playerCId
        )
    ).toMatchObject({
      waiting: false,
      handCount: 5,
    })
  })
})

function startedRoomWithInactiveHost(manager = new RoomManager()) {
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

function lobbyRoom(manager = new RoomManager()) {
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

  return {
    manager,
    code,
    hostId,
    playerBId: joinedB.data.player.id,
    playerCId: joinedC.data.player.id,
  }
}

function startedRoom(manager = new RoomManager()) {
  const room = lobbyRoom(manager)
  manager.setReady(room.code, room.playerBId, true)
  manager.setReady(room.code, room.playerCId, true)
  const started = manager.startRoom(room.code, room.hostId)
  if (!started.ok) throw new Error(started.error.message)
  return room
}

function twoPlayerStartedRoom(manager = new RoomManager()) {
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
  if (!joinedB.ok) throw new Error(joinedB.error.message)
  const playerBId = joinedB.data.player.id
  manager.setReady(code, playerBId, true)
  const started = manager.startRoom(code, hostId)
  if (!started.ok) throw new Error(started.error.message)
  return { manager, code, hostId, playerBId }
}
