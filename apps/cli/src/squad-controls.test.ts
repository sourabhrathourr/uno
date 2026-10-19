import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ChatMessage, PlayerSocialSnapshot } from "@workspace/game"
import { card, fixture, seed } from "./test-fixture"

let f: Awaited<ReturnType<typeof fixture>>
beforeEach(async () => {
  f = await fixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

async function table() {
  const a = f.client(),
    b = f.client(),
    c = f.client()
  await a.execute({ action: "create", name: "CLI A" })
  const code = a.status().room!.code
  await b.execute({ action: "join", code, name: "CLI B" })
  await c.execute({ action: "join", code, name: "CLI C" })
  const mobile = await f.browser(code)
  for (const client of [a, b, c])
    await client.execute({ action: "ready", ready: true })
  await mobile.socket
    .timeout(1000)
    .emitWithAck("room:setReady", { ready: true })
  await a.execute({ action: "start" })
  const ai = a.status().playerId!,
    bi = b.status().playerId!,
    ci = c.status().playerId!
  const game = f.game(code)
  seed(
    game,
    {
      [ai]: [card("a-private"), card("a-spare", "blue")],
      [bi]: [card("b-private"), card("b-spare")],
      [ci]: [],
      [mobile.playerId]: [card("mobile-private"), card("mobile-spare")],
    },
    ai
  )
  game.eliminatedPlayerIds = [ci]
  f.bumpVersion(code)
  await expect.poll(() => c.status().self?.hand).toEqual([])
  await expect.poll(() => a.status().self?.hand[0]?.id).toBe("a-private")
  return { a, b, c, ai, bi, ci, code, game, mobile }
}
const socialSocket = (id: string) =>
  [...f.io.sockets.sockets.values()].find(
    (socket) => socket.data.playerId === id
  )!
type Page = {
  messages: ChatMessage[]
  gap: boolean
  nextMessageId: string | null
}
const pauseChat = () => new Promise((resolve) => setTimeout(resolve, 660))

it("joins an eligible squad and reads only its linked hand without granting gameplay access", async () => {
  const { a, b, c, ai, bi, ci } = await table()
  expect(c.status().support.candidates.map((p) => p.playerId)).toContain(ai)
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  expect(c.status().support).toMatchObject({
    supportingPlayerId: ai,
    canReadSupportView: true,
    candidates: [],
  })
  const view = await c.execute({ action: "support-view" })
  expect(view).toMatchObject({
    readOnly: true,
    playerId: ai,
    hand: [{ id: "a-private" }, { id: "a-spare" }],
  })
  expect(JSON.stringify(view)).not.toMatch(
    /b-private|mobile-private|canDraw|playableCardIds/
  )
  expect(c.status().self).toMatchObject({ playerId: ci, hand: [] })
  expect(JSON.stringify(c.status())).not.toContain("a-private")
  await expect(
    c.execute({ action: "play", cardIds: ["a-private"] })
  ).rejects.toMatchObject({ code: "card-not-owned" })
  await expect(
    c.execute({ action: "support-join", supportedPlayerId: bi })
  ).rejects.toMatchObject({ code: "support-locked" })
  await expect(
    b.execute({ action: "support-join", supportedPlayerId: ai })
  ).rejects.toMatchObject({ code: "player-active" })
  await expect(a.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
  expect(f.received).not.toContain("game:spectatePlayer")
})

it("isolates squad bodies, cursors, notices and mentions while keeping public defaults", async () => {
  const { a, b, c, ai, ci, mobile } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  const notices: any[] = [],
    mobileSocial: PlayerSocialSnapshot[] = []
  c.on("notice", (notice) => notices.push(notice))
  mobile.socket.on("room:playerSocial", (social) => mobileSocial.push(social))
  await a.execute({
    action: "chat-send",
    channel: "squad",
    body: "Secret @CLI C",
    mentionPlayerIds: [ci],
  })
  await expect.poll(() => c.status().squadChat.pendingMentionIds.length).toBe(1)
  expect(notices.filter((n) => n.type === "chat-message")).toEqual([])
  const first = (await c.execute({
    action: "chat-read",
    channel: "squad",
  })) as Page
  expect(first.messages).toHaveLength(1)
  expect(first.messages[0]).toMatchObject({
    body: "Secret @CLI C",
    channel: "squad",
  })
  expect(await c.execute({ action: "chat-read" })).toMatchObject({
    messages: [],
  })
  expect(
    await b.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [] })
  expect(JSON.stringify(b.status())).not.toContain("Secret")
  expect(JSON.stringify(mobileSocial)).not.toContain("Secret")
  expect(JSON.stringify(a.status().room)).not.toContain("Secret")
  await c.execute({ action: "chat-watch", channel: "squad", enabled: true })
  await b.execute({
    action: "chat-send",
    body: "Public @CLI C",
    mentionPlayerIds: [ci],
  })
  await pauseChat()
  await a.execute({
    action: "chat-send",
    channel: "squad",
    body: "Second @CLI C",
    mentionPlayerIds: [ci],
  })
  await expect
    .poll(
      () =>
        notices.filter(
          (n) => n.type === "chat-message" && n.channel === "squad"
        ).length
    )
    .toBe(1)
  expect(c.status().chat.pendingMentionIds).toHaveLength(1)
  expect(c.status().squadChat.pendingMentionIds).toHaveLength(1)
  const wake = await c.execute({
    action: "wait-for-action",
    afterVersion: c.status().room!.version,
    timeoutMs: 100,
  })
  expect(wake).toMatchObject({
    reasons: expect.arrayContaining(["mention", "squad-mention"]),
  })
  await c.execute({ action: "chat-read" })
  expect(c.status().chat.pendingMentionIds).toEqual([])
  expect(c.status().squadChat.pendingMentionIds).toHaveLength(1)
  const second = (await c.execute({
    action: "chat-read",
    channel: "squad",
    afterMessageId: first.nextMessageId,
  })) as Page
  expect(second).toMatchObject({
    gap: false,
    messages: [{ body: "Second @CLI C" }],
  })
  expect(c.status().squadChat.pendingMentionIds).toEqual([])
  expect(
    await c.execute({
      action: "chat-read",
      afterMessageId: first.nextMessageId,
    })
  ).toMatchObject({ gap: true, messages: [{ body: "Public @CLI C" }] })
  await c.execute({ action: "chat-send", channel: "squad", body: "From CLI C" })
  await expect
    .poll(
      async () =>
        (
          (await a.execute({ action: "chat-read", channel: "squad" })) as Page
        ).messages.at(-1)?.body
    )
    .toBe("From CLI C")
  await c.execute({ action: "chat-watch", enabled: false })
  expect(c.status().squadChat.watching).toBe(true)
})

it("enforces kick and explicit rejoin approval, clearing private history before social packets arrive", async () => {
  const { a, b, c, ai, bi, ci, code } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  await a.execute({
    action: "chat-send",
    channel: "squad",
    body: "Retained team history",
  })
  await expect
    .poll(
      async () =>
        ((await c.execute({ action: "chat-read", channel: "squad" })) as Page)
          .messages.length
    )
    .toBe(1)
  f.controls.holdSocial = true
  await a.execute({ action: "support-kick", supporterPlayerId: ci })
  await expect.poll(() => c.status().support.supportingPlayerId).toBeNull()
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [] })
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
  await expect(
    c.execute({ action: "support-join", supportedPlayerId: ai })
  ).rejects.toMatchObject({ code: "support-blocked" })
  await expect(
    c.execute({ action: "chat-send", channel: "squad", body: "No access" })
  ).rejects.toMatchObject({ code: "squad-chat-unavailable" })
  f.controls.holdSocial = false
  f.publish(code)
  await c.execute({ action: "support-request", supportedPlayerId: ai })
  await expect
    .poll(() =>
      a.status().support.incomingSupportRequests.map((r) => r.supporterPlayerId)
    )
    .toContain(ci)
  expect(c.status().support.outgoingSupportRequest).toMatchObject({
    supportedPlayerId: ai,
  })
  await expect(
    b.execute({
      action: "support-respond",
      supporterPlayerId: ci,
      approve: true,
    })
  ).rejects.toMatchObject({ code: "support-request-not-found" })
  await a.execute({
    action: "support-respond",
    supporterPlayerId: ci,
    approve: false,
  })
  expect(c.status().support.supportingPlayerId).toBeNull()
  await c.execute({ action: "support-request", supportedPlayerId: ai })
  await a.execute({
    action: "support-respond",
    supporterPlayerId: ci,
    approve: true,
  })
  await expect.poll(() => c.status().support.squadPlayerId).toBe(ai)
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [{ body: "Retained team history" }] })
  await expect(
    b.execute({ action: "support-kick", supporterPlayerId: ci })
  ).rejects.toMatchObject({ code: "support-link-not-found" })
  await expect(
    c.execute({ action: "support-request", supportedPlayerId: bi })
  ).rejects.toMatchObject({ code: "support-locked" })
})

it("rejects ineligible support operations without broadening spectator access", async () => {
  const { a, c, ai, ci } = await table()
  await expect(
    c.execute({ action: "support-join", supportedPlayerId: ci })
  ).rejects.toMatchObject({ code: "cannot-support-self" })
  await expect(
    c.execute({ action: "support-join", supportedPlayerId: "not-in-room" })
  ).rejects.toMatchObject({ code: "player-not-found" })
  await expect(
    c.execute({ action: "support-request", supportedPlayerId: ai })
  ).rejects.toMatchObject({ code: "support-request-not-needed" })
  await expect(
    a.execute({ action: "support-request", supportedPlayerId: ci })
  ).rejects.toMatchObject({ code: "player-active" })
  await expect(
    a.execute({ action: "support-join", supportedPlayerId: ci })
  ).rejects.toMatchObject({ code: "player-active" })
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
  expect(f.received).not.toContain("game:getSupportView")
  expect(f.received).not.toContain("game:spectatePlayer")
})

it("keeps pending last-gift hands out of both support joins and views, including queued gifts", async () => {
  const { c, ai, ci, code, game } = await table()
  const gift = {
    id: "pending",
    playerId: ci,
    drawnCardId: "gift-card",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    cards: [card("gift-card")],
  }
  game.lastGifts = [gift]
  f.bumpVersion(code)
  await expect.poll(() => c.status().pending.lastGift?.id).toBe("pending")
  await expect(
    c.execute({ action: "support-join", supportedPlayerId: ai })
  ).rejects.toMatchObject({ code: "last-gift-pending" })
  game.lastGifts = []
  f.bumpVersion(code)
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  game.lastGifts = [gift]
  f.bumpVersion(code)
  await expect.poll(() => c.status().support.canReadSupportView).toBe(false)
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
  game.lastGifts = [{ ...gift, id: "other", playerId: ai }, gift]
  f.bumpVersion(code)
  await expect.poll(() => c.status().pending.lastGift?.id).toBe("other")
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
  expect(c.status().self?.hand).toEqual([])
})

it("restores authorized history through join/resync but clears it during disconnect and after an offline kick", async () => {
  const { a, c, ai, ci, code } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  await a.execute({
    action: "chat-send",
    channel: "squad",
    body: "Reconnect history",
  })
  await expect
    .poll(
      async () =>
        ((await c.execute({ action: "chat-read", channel: "squad" })) as Page)
          .messages.length
    )
    .toBe(1)
  f.controls.holdSocial = true
  await c.execute({ action: "resync" })
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [{ body: "Reconnect history" }] })
  socialSocket(ci).disconnect(true)
  await expect.poll(() => c.status().joined).toBe(false)
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [] })
  await c.execute({ action: "join", code, name: "CLI C" })
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [{ body: "Reconnect history" }] })
  socialSocket(ci).disconnect(true)
  await expect.poll(() => c.status().joined).toBe(false)
  await a.execute({ action: "support-kick", supporterPlayerId: ci })
  await c.execute({ action: "join", code, name: "CLI C" })
  expect(c.status().support.supportingPlayerId).toBeNull()
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [] })
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
})

it("rejects a delayed support hand after membership changes", async () => {
  const { a, c, ai, ci } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  f.controls.holdAckFor = "game:getSupportView"
  const read = c.execute({ action: "support-view" }).catch((error) => error)
  await expect.poll(() => f.heldAcks.length).toBe(1)
  await a.execute({ action: "support-kick", supporterPlayerId: ci })
  f.releaseAck()
  expect(await read).toMatchObject({ code: "stale-support-view" })
  expect(c.status().self?.hand).toEqual([])
})

it("rejects a support hand captured before a newer public version", async () => {
  const { c, ai, code } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  f.controls.holdAckFor = "game:getSupportView"
  const read = c.execute({ action: "support-view" }).catch((error) => error)
  await expect.poll(() => f.heldAcks.length).toBe(1)
  const version = c.status().room!.version
  f.bumpVersion(code)
  await expect.poll(() => c.status().room!.version).toBeGreaterThan(version)
  f.releaseAck()
  expect(await read).toMatchObject({ code: "stale-support-view" })
  expect(c.status().needsResync).toBe(false)
})

it("keeps a timed-out support read retryable without marking a mutation uncertain", async () => {
  const { c, ai } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  f.controls.dropAckFor = "game:getSupportView"
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "connection-timeout",
  })
  expect(c.status().needsResync).toBe(false)
  expect(c.status().self?.hand).toEqual([])
  f.controls.dropAckFor = ""
  await expect(c.execute({ action: "support-view" })).resolves.toMatchObject({
    readOnly: true,
    playerId: ai,
  })
})

it("rejects a server support view from a version not yet reflected in local public state", async () => {
  const { c, ai, ci, code } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  const socket = socialSocket(ci)
  socket.removeAllListeners("game:getSupportView")
  socket.on("game:getSupportView", (ack) => {
    const view = f.manager.getSupportView(code, ci)!
    ack({
      ok: true,
      data: { ...view, roomVersion: c.status().room!.version + 1 },
    })
  })
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "stale-support-view",
  })
  expect(c.status().needsResync).toBe(false)
  expect(c.status().self?.hand).toEqual([])
})

it("rejects foreign and previous-match social packets and a foreign support hand", async () => {
  const { a, c, ai, bi, ci, code } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  await a.execute({
    action: "chat-send",
    channel: "squad",
    body: "Current team",
  })
  await expect
    .poll(
      async () =>
        ((await c.execute({ action: "chat-read", channel: "squad" })) as Page)
          .messages.length
    )
    .toBe(1)
  const real = f.manager.getPlayerSocial(code, ci)!
  for (const bad of [
    {
      ...real,
      squadPlayerId: bi,
      squadChatMessages: real.squadChatMessages.map((m) => ({
        ...m,
        body: "FOREIGN SECRET",
        squadPlayerId: bi,
      })),
    },
    {
      ...real,
      squadChatMessages: real.squadChatMessages.map((m) => ({
        ...m,
        body: "OLD MATCH SECRET",
        matchId: "previous-match",
      })),
    },
  ])
    socialSocket(ci).emit("room:playerSocial", bad)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [{ body: "Current team" }] })
  const socket = socialSocket(ci)
  socket.removeAllListeners("game:getSupportView")
  socket.on("game:getSupportView", (ack) =>
    ack({ ok: true, data: f.manager.getPlayerGame(code, bi) })
  )
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
  expect(JSON.stringify(c.status())).not.toMatch(
    /FOREIGN SECRET|OLD MATCH SECRET|b-private/
  )
})

it("clears squad access on match finish/restart, and discards late social messages after close", async () => {
  const { a, c, ai, bi, ci, code, game, mobile } = await table()
  await c.execute({ action: "support-join", supportedPlayerId: ai })
  await a.execute({
    action: "chat-send",
    channel: "squad",
    body: "Old match history",
  })
  const old = f.manager.getPlayerSocial(code, ci)!
  const oldMatch = game.matchId
  seed(
    game,
    {
      [ai]: [card("finish")],
      [bi]: [card("b-last")],
      [ci]: [],
      [mobile.playerId]: [],
    },
    ai
  )
  game.eliminatedPlayerIds = [ci, mobile.playerId]
  f.bumpVersion(code)
  await expect.poll(() => a.status().self?.hand[0]?.id).toBe("finish")
  await a.execute({ action: "play", cardIds: ["finish"] })
  await expect.poll(() => c.status().room?.status).toBe("finished")
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [] })
  await a.execute({ action: "restart" })
  await expect.poll(() => c.status().room?.game?.matchId).not.toBe(oldMatch)
  socialSocket(ci).emit("room:playerSocial", old)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(
    await c.execute({ action: "chat-read", channel: "squad" })
  ).toMatchObject({ messages: [] })
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "support-view-unavailable",
  })
  c.close()
  expect(c.status().support.supportingPlayerId).toBeNull()
})

it("never replays an unconfirmed support mutation and recovers membership only through explicit resync", async () => {
  const { c, ai } = await table()
  f.controls.dropAckFor = "game:supportPlayer"
  await expect(
    c.execute({ action: "support-join", supportedPlayerId: ai })
  ).rejects.toMatchObject({ code: "outcome-unknown" })
  expect(
    f.received.filter((event) => event === "game:supportPlayer")
  ).toHaveLength(1)
  await expect(c.execute({ action: "support-view" })).rejects.toMatchObject({
    code: "resync-required",
  })
  await c.execute({ action: "resync" })
  expect(c.status().support.supportingPlayerId).toBe(ai)
  expect(await c.execute({ action: "support-view" })).toMatchObject({
    readOnly: true,
    playerId: ai,
  })
})
