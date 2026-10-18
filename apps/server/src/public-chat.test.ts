import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CHAT_REACTIONS, type CommandResult } from "@workspace/game"
import { RoomManager } from "./room-manager"

function data<T>(result: CommandResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}

function lobby(manager = new RoomManager()) {
  const created = data(
    manager.createRoom({ playerName: "A", sessionId: "public-chat-a" })
  )
  const code = created.room.code
  const a = created.player.id
  const b = data(
    manager.joinRoom({ code, playerName: "B", sessionId: "public-chat-b" })
  ).player.id
  manager.registerConnection(code, a, "socket-a")
  manager.registerConnection(code, b, "socket-b")
  return { manager, code, a, b }
}

function send(
  manager: RoomManager,
  code: string,
  player: string,
  body = "Hello"
) {
  const room = data(
    manager.sendChatMessage(code, player, { kind: "text", body })
  )
  return room.chatMessages.at(-1)!
}

function reaction(
  manager: RoomManager,
  code: string,
  player: string,
  messageId: string,
  emoji: string = CHAT_REACTIONS[0],
  active = true
) {
  return manager.reactToChatMessage(code, player, { messageId, emoji, active })
}

function messages(manager: RoomManager, code: string) {
  return data(manager.getRoom(code)).chatMessages
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("public chat replies", () => {
  it("preserves a reply to a public message in the same room", () => {
    const { manager, code, a, b } = lobby()
    const original = send(manager, code, a)
    const replied = data(
      manager.sendChatMessage(code, b, {
        kind: "text",
        body: "Reply",
        replyToMessageId: original.id,
      })
    )
    expect(replied.chatMessages.at(-1)).toMatchObject({
      playerId: b,
      replyToMessageId: original.id,
      body: "Reply",
    })
    expect(messages(manager, code)[0]).toEqual(original)
  })

  it("rejects unknown, malformed and other-room reply IDs without consuming a chat send", () => {
    const { manager, code, a } = lobby()
    const other = lobby(manager)
    const foreign = send(manager, other.code, other.a)
    const version = data(manager.getRoom(code)).version
    for (const replyToMessageId of ["missing", foreign.id, "", 123, null]) {
      expect(
        manager.sendChatMessage(code, a, {
          kind: "text",
          body: "Bad reply",
          replyToMessageId: replyToMessageId as string,
        })
      ).toMatchObject({ ok: false, error: { code: "reply-not-found" } })
    }
    expect(data(manager.getRoom(code))).toMatchObject({
      version,
      chatMessages: [],
    })
    expect(send(manager, code, a).body).toBe("Hello")
  })

  it("rejects replies targeting private squad messages or sent through the squad channel", () => {
    const manager = new RoomManager()
    const created = data(
      manager.createRoom({
        playerName: "A",
        sessionId: "squad-a",
        houseRules: { startingHandSize: 5, mercyHandLimit: 5 },
      })
    )
    const code = created.room.code
    const a = created.player.id
    const b = data(
      manager.joinRoom({ code, playerName: "B", sessionId: "squad-b" })
    ).player.id
    const c = data(
      manager.joinRoom({ code, playerName: "C", sessionId: "squad-c" })
    ).player.id
    for (const [id, socket] of [
      [a, "a"],
      [b, "b"],
      [c, "c"],
    ])
      manager.registerConnection(code, id!, socket!)
    data(manager.setReady(code, b, true))
    data(manager.setReady(code, c, true))
    data(manager.startRoom(code, a))
    data(manager.drawOne(code, a))
    data(manager.supportPlayer(code, a, b))
    data(
      manager.sendChatMessage(code, a, {
        channel: "squad",
        kind: "text",
        body: "Private squad message",
      })
    )
    const privateId = manager
      .getPlayerSocial(code, b)!
      .squadChatMessages.at(-1)!.id
    expect(
      messages(manager, code).some((message) => message.id === privateId)
    ).toBe(false)
    expect(
      manager.sendChatMessage(code, c, {
        kind: "text",
        body: "Leak attempt",
        replyToMessageId: privateId,
      })
    ).toMatchObject({ ok: false, error: { code: "reply-not-found" } })
    expect(reaction(manager, code, c, privateId)).toMatchObject({
      ok: false,
      error: { code: "message-not-found" },
    })
    const publicMessage = send(manager, code, c)
    vi.advanceTimersByTime(700)
    expect(
      manager.sendChatMessage(code, a, {
        channel: "squad",
        kind: "text",
        body: "Squad reply",
        replyToMessageId: publicMessage.id,
      })
    ).toMatchObject({ ok: false, error: { code: "reply-not-found" } })
    expect(manager.getPlayerSocial(code, b)!.squadChatMessages).toHaveLength(1)
  })

  it("rejects an evicted reply target rather than retaining an unbounded history", () => {
    const { manager, code, a, b } = lobby()
    const first = send(manager, code, a)
    for (let i = 0; i < 250; i++) {
      vi.advanceTimersByTime(700)
      send(manager, code, a, `Message ${i}`)
    }
    expect(messages(manager, code)).toHaveLength(250)
    expect(
      manager.sendChatMessage(code, b, {
        kind: "text",
        body: "Too old",
        replyToMessageId: first.id,
      })
    ).toMatchObject({ ok: false, error: { code: "reply-not-found" } })
    expect(reaction(manager, code, b, first.id)).toMatchObject({
      ok: false,
      error: { code: "message-not-found" },
    })
  })
})

describe("public chat reactions", () => {
  it.each(CHAT_REACTIONS)("accepts the supported %s reaction", (emoji) => {
    const { manager, code, a } = lobby()
    const message = send(manager, code, a)
    expect(
      data(reaction(manager, code, a, message.id, emoji)).chatMessages[0]!
        .reactions
    ).toEqual([{ emoji, playerIds: [a] }])
  })

  it("requires connected room membership and a public message belonging to that room", () => {
    const { manager, code, a, b } = lobby()
    const message = send(manager, code, a)
    const other = lobby(manager)
    expect(reaction(manager, "BAD123", a, message.id)).toMatchObject({
      ok: false,
      error: { code: "room-not-found" },
    })
    expect(reaction(manager, code, other.a, message.id)).toMatchObject({
      ok: false,
      error: { code: "player-not-found" },
    })
    expect(reaction(manager, other.code, other.a, message.id)).toMatchObject({
      ok: false,
      error: { code: "message-not-found" },
    })
    expect(reaction(manager, code, a, "missing")).toMatchObject({
      ok: false,
      error: { code: "message-not-found" },
    })
    manager.unregisterConnection(code, b, "socket-b")
    expect(reaction(manager, code, b, message.id)).toMatchObject({
      ok: false,
      error: { code: "player-not-found" },
    })
    expect(messages(manager, code)[0]!.reactions).toBeUndefined()
  })

  it("validates the emoji allowlist, boolean active and message ID before mutation", () => {
    const { manager, code, a } = lobby()
    const message = send(manager, code, a)
    const version = data(manager.getRoom(code)).version
    for (const input of [
      null,
      {},
      { messageId: message.id, emoji: "unlisted", active: true },
      { messageId: message.id, emoji: CHAT_REACTIONS[0], active: "yes" },
      { messageId: 123, emoji: CHAT_REACTIONS[0], active: true },
    ]) {
      expect(manager.reactToChatMessage(code, a, input as never)).toMatchObject(
        { ok: false, error: { code: "invalid-chat-reaction" } }
      )
    }
    expect(data(manager.getRoom(code)).version).toBe(version)
    expect(reaction(manager, code, a, message.id).ok).toBe(true)
  })

  it("makes repeated active/inactive operations idempotent without touching version or consuming cooldown", () => {
    const { manager, code, a } = lobby()
    const message = send(manager, code, a)
    const initialVersion = data(manager.getRoom(code)).version
    expect(
      data(reaction(manager, code, a, message.id, CHAT_REACTIONS[0], false))
        .version
    ).toBe(initialVersion)
    const added = data(reaction(manager, code, a, message.id))
    expect(added.version).toBeGreaterThan(initialVersion)
    expect(data(reaction(manager, code, a, message.id)).version).toBe(
      added.version
    )
    vi.advanceTimersByTime(300)
    const removed = data(
      reaction(manager, code, a, message.id, CHAT_REACTIONS[0], false)
    )
    expect(removed.chatMessages[0]!.reactions).toEqual([])
    expect(
      data(reaction(manager, code, a, message.id, CHAT_REACTIONS[0], false))
        .version
    ).toBe(removed.version)
    vi.advanceTimersByTime(300)
    expect(reaction(manager, code, a, message.id).ok).toBe(true)
    expect(messages(manager, code)[0]!.reactions).toEqual([
      { emoji: CHAT_REACTIONS[0], playerIds: [a] },
    ])
  })

  it("throttles changes per player across messages, with the exact 300ms boundary", () => {
    const { manager, code, a, b } = lobby()
    const first = send(manager, code, a)
    const second = send(manager, code, b)
    expect(reaction(manager, code, a, first.id).ok).toBe(true)
    expect(reaction(manager, code, b, first.id).ok).toBe(true)
    vi.advanceTimersByTime(299)
    expect(reaction(manager, code, a, second.id)).toMatchObject({
      ok: false,
      error: { code: "reaction-too-fast" },
    })
    vi.advanceTimersByTime(1)
    expect(reaction(manager, code, a, second.id).ok).toBe(true)
  })

  it("limits each player's reactions to three per message while allowing others and another message", () => {
    const { manager, code, a, b } = lobby()
    const first = send(manager, code, a)
    const second = send(manager, code, b)
    for (const emoji of CHAT_REACTIONS.slice(0, 3)) {
      data(reaction(manager, code, a, first.id, emoji))
      vi.advanceTimersByTime(300)
    }
    expect(
      reaction(manager, code, a, first.id, CHAT_REACTIONS[3])
    ).toMatchObject({ ok: false, error: { code: "reaction-limit" } })
    expect(reaction(manager, code, b, first.id, CHAT_REACTIONS[3]).ok).toBe(
      true
    )
    expect(reaction(manager, code, a, second.id, CHAT_REACTIONS[3]).ok).toBe(
      true
    )
    vi.advanceTimersByTime(300)
    data(reaction(manager, code, a, first.id, CHAT_REACTIONS[0], false))
    vi.advanceTimersByTime(300)
    expect(reaction(manager, code, a, first.id, CHAT_REACTIONS[3]).ok).toBe(
      true
    )
    const reacted = messages(manager, code)[0]!.reactions!
    expect(reacted.filter((entry) => entry.playerIds.includes(a))).toHaveLength(
      3
    )
    expect(
      reacted.find((entry) => entry.emoji === CHAT_REACTIONS[3])!.playerIds
    ).toEqual([b, a])
  })

  it("deep-clones nested reaction state in both mutation acknowledgements and read snapshots", () => {
    const { manager, code, a, b } = lobby()
    const message = send(manager, code, a)
    const acknowledged = data(reaction(manager, code, a, message.id))
    acknowledged.chatMessages[0]!.reactions![0]!.playerIds.push("forged-ack")
    const snapshot = data(manager.getRoom(code))
    snapshot.chatMessages[0]!.reactions![0]!.emoji = "forged-emoji"
    snapshot.chatMessages[0]!.reactions![0]!.playerIds.push("forged-snapshot")
    snapshot.chatMessages[0]!.reactions!.push({
      emoji: "forged",
      playerIds: [b],
    })
    expect(messages(manager, code)[0]!.reactions).toEqual([
      { emoji: CHAT_REACTIONS[0], playerIds: [a] },
    ])
  })
})

describe("ephemeral public typing", () => {
  it("requires a connected member and boolean input", () => {
    const { manager, code, a, b } = lobby()
    expect(manager.setChatTyping("BAD123", a, true)).toMatchObject({
      ok: false,
      error: { code: "room-not-found" },
    })
    expect(manager.setChatTyping(code, "outsider", true)).toMatchObject({
      ok: false,
      error: { code: "player-not-found" },
    })
    expect(manager.setChatTyping(code, a, "yes" as never)).toMatchObject({
      ok: false,
      error: { code: "invalid-typing" },
    })
    manager.unregisterConnection(code, b, "socket-b")
    expect(manager.setChatTyping(code, b, true)).toMatchObject({
      ok: false,
      error: { code: "player-not-found" },
    })
    expect(manager.getChatTyping(code)).toEqual([])
  })

  it("throttles refreshes to once per second and expires three seconds after the accepted refresh", () => {
    const updated = vi.fn()
    const { manager, code, a } = lobby(
      new RoomManager({ onChatTypingUpdated: updated })
    )
    const start = Date.now()
    data(manager.setChatTyping(code, a, true))
    expect(manager.getChatTyping(code)).toEqual([
      { playerId: a, expiresAt: start + 3_000 },
    ])
    vi.advanceTimersByTime(999)
    data(manager.setChatTyping(code, a, true))
    expect(updated).toHaveBeenCalledTimes(1)
    expect(manager.getChatTyping(code)[0]!.expiresAt).toBe(start + 3_000)
    vi.advanceTimersByTime(1)
    data(manager.setChatTyping(code, a, true))
    expect(updated).toHaveBeenCalledTimes(2)
    expect(manager.getChatTyping(code)[0]!.expiresAt).toBe(start + 4_000)
    vi.advanceTimersByTime(2_999)
    expect(manager.getChatTyping(code)).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(manager.getChatTyping(code)).toEqual([])
    expect(updated).toHaveBeenLastCalledWith(code, [])
    expect(updated).toHaveBeenCalledTimes(3)
  })

  it("explicit false clears immediately and repeated false is a no-op", () => {
    const updated = vi.fn()
    const { manager, code, a } = lobby(
      new RoomManager({ onChatTypingUpdated: updated })
    )
    data(manager.setChatTyping(code, a, true))
    data(manager.setChatTyping(code, a, false))
    data(manager.setChatTyping(code, a, false))
    expect(manager.getChatTyping(code)).toEqual([])
    expect(updated).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(3_000)
    expect(updated).toHaveBeenCalledTimes(2)
  })

  it("every send attempt ends only its sender's typing lease", () => {
    const { manager, code, a, b } = lobby()
    data(manager.setChatTyping(code, a, true))
    data(manager.setChatTyping(code, b, true))
    expect(
      manager.sendChatMessage(code, a, { kind: "text", body: "" }).ok
    ).toBe(false)
    expect(manager.getChatTyping(code).map((entry) => entry.playerId)).toEqual([
      b,
    ])
    send(manager, code, a)
    expect(manager.getChatTyping(code).map((entry) => entry.playerId)).toEqual([
      b,
    ])
  })

  it("retains typing across a partial socket disconnect and clears on the final disconnect", () => {
    const updated = vi.fn()
    const { manager, code, a } = lobby(
      new RoomManager({ onChatTypingUpdated: updated })
    )
    manager.registerConnection(code, a, "second-a")
    data(manager.setChatTyping(code, a, true))
    manager.unregisterConnection(code, a, "socket-a")
    expect(manager.getChatTyping(code)).toHaveLength(1)
    expect(updated).toHaveBeenCalledTimes(1)
    manager.unregisterConnection(code, a, "second-a")
    expect(manager.getChatTyping(code)).toEqual([])
    expect(updated).toHaveBeenLastCalledWith(code, [])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("returns detached typing arrays and never changes room version or activity timestamps", () => {
    const { manager, code, a } = lobby()
    const before = data(manager.getRoom(code))
    data(manager.setChatTyping(code, a, true))
    const view = manager.getChatTyping(code)
    view[0]!.expiresAt = 0
    view.push({ playerId: "forged", expiresAt: Date.now() + 9_999 })
    expect(manager.getChatTyping(code)).toEqual([
      { playerId: a, expiresAt: Date.now() + 3_000 },
    ])
    vi.advanceTimersByTime(1_000)
    data(manager.setChatTyping(code, a, true))
    data(manager.setChatTyping(code, a, false))
    expect(data(manager.getRoom(code))).toMatchObject({
      version: before.version,
      updatedAt: before.updatedAt,
    })
    data(manager.setChatTyping(code, a, true))
    vi.advanceTimersByTime(3_000)
    expect(data(manager.getRoom(code))).toMatchObject({
      version: before.version,
      updatedAt: before.updatedAt,
    })
  })

  it("keeps active gameplay and both private snapshot versions synchronized while typing changes", () => {
    const { manager, code, a, b } = lobby()
    data(manager.setReady(code, b, true))
    const before = data(manager.startRoom(code, a))
    const aBefore = manager.getPlayerGame(code, a)
    const bBefore = manager.getPlayerGame(code, b)
    data(manager.setChatTyping(code, a, true))
    vi.advanceTimersByTime(1_000)
    data(manager.setChatTyping(code, a, true))
    data(manager.setChatTyping(code, b, true))
    vi.advanceTimersByTime(3_000)
    const after = data(manager.getRoom(code))
    expect(after.version).toBe(before.version)
    expect(after.game).toEqual(before.game)
    expect(manager.getPlayerGame(code, a)).toEqual(aBefore)
    expect(manager.getPlayerGame(code, b)).toEqual(bBefore)
    expect(manager.getPlayerGame(code, a)!.roomVersion).toBe(after.version)
    expect(manager.getPlayerGame(code, b)!.roomVersion).toBe(after.version)
  })

  it("removes typing timers on room expiry without a late broadcast or extending room lifetime", () => {
    const updated = vi.fn()
    const expired = vi.fn()
    const { manager, code, a } = lobby(
      new RoomManager({ onChatTypingUpdated: updated, onRoomExpired: expired })
    )
    const original = Date.now()
    // Move the wall clock without running the three-second timer yet.
    vi.setSystemTime(original + 7 * 24 * 60 * 60 * 1_000 - 1_000)
    data(manager.setChatTyping(code, a, true))
    expect(vi.getTimerCount()).toBe(1)
    vi.setSystemTime(original + 7 * 24 * 60 * 60 * 1_000)
    expect(manager.pruneExpiredRooms()).toEqual([code])
    expect(expired).toHaveBeenCalledWith(code)
    expect(manager.getChatTyping(code)).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(3_000)
    expect(updated).toHaveBeenCalledTimes(1)
  })
})

it("cannot bypass typing broadcast throttling by alternating stop and start", () => {
  const updated = vi.fn()
  const { manager, code, a } = lobby(
    new RoomManager({ onChatTypingUpdated: updated })
  )
  data(manager.setChatTyping(code, a, true))
  data(manager.setChatTyping(code, a, false))
  for (let i = 0; i < 20; i++) {
    data(manager.setChatTyping(code, a, true))
    data(manager.setChatTyping(code, a, false))
  }
  expect(updated).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(1_000)
  data(manager.setChatTyping(code, a, true))
  expect(updated).toHaveBeenCalledTimes(3)
})
