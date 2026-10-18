import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fixture, card, seed } from "./test-fixture"
import { parseCommand } from "./commands"
import type { ChatMessage } from "@workspace/game"

let f: Awaited<ReturnType<typeof fixture>>
beforeEach(async () => {
  f = await fixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

async function seats(playing = false) {
  const a = f.client(700)
  await a.execute({ action: "create", name: "CLI A" })
  const code = a.status().room!.code
  const b = f.client(700)
  await b.execute({ action: "join", code, name: "CLI B" })
  const ai = a.status().playerId!
  const bi = b.status().playerId!
  if (playing) {
    await a.execute({ action: "ready", ready: true })
    await b.execute({ action: "ready", ready: true })
    await a.execute({ action: "start" })
    seed(
      f.game(code),
      {
        [ai]: [
          card("red-five"),
          card("blue-five", "blue"),
          card("spare", "green"),
        ],
        [bi]: [card("other-one"), card("other-two")],
      },
      ai
    )
    f.bumpVersion(code)
    await expect.poll(() => a.status().self?.hand[0]?.id).toBe("red-five")
  }
  return { a, b, ai, bi, code }
}

function capture(playerId: string) {
  const inputs: Array<{ event: string; input: unknown }> = []
  const socket = [...f.io.sockets.sockets.values()].find(
    (s) => s.data.playerId === playerId
  )!
  socket.onAny((event, input) => inputs.push({ event, input }))
  return inputs
}

type ChatPage = {
  messages: ChatMessage[]
  gap: boolean
  nextMessageId: string | null
}

it("stage-play waits for staging acknowledgement, then commits the full group without endTurn", async () => {
  const { a, b, ai } = await seats(true)
  const inputs = capture(ai)
  f.controls.holdAckFor = "game:stageCards"
  const result = a.execute({
    action: "stage-play",
    cardIds: ["red-five", "blue-five"],
    declaredUno: true,
    previewMs: 0,
  })
  await expect.poll(() => f.heldAcks.length).toBe(1)
  await expect
    .poll(() => b.status().room?.game?.stagedPlay?.cards.map((c) => c.id))
    .toEqual(["red-five", "blue-five"])
  expect(inputs.map((i) => i.event)).toEqual(["game:stageCards"])
  expect(a.status().self?.hand).toHaveLength(3)
  f.releaseAck()
  await expect(result).resolves.toMatchObject({ confirmed: true, staged: true })
  expect(inputs.map((i) => i.event)).toEqual([
    "game:stageCards",
    "game:playCards",
  ])
  expect(inputs[1]!.input).toEqual({
    cardIds: ["red-five", "blue-five"],
    declaredUno: true,
  })
  expect(a.status().self?.hand.map((c) => c.id)).toEqual(["spare"])
  expect(f.received).not.toContain("game:endTurn")
})

it("stage-play previews Discard All extras while preserving primary/extras/topCard commit fields", async () => {
  const { a, ai, bi, code } = await seats(true)
  seed(
    f.game(code),
    {
      [ai]: [
        card("discard", "red", { kind: "discard-color" }),
        card("plus", "red", { kind: "draw", count: 4 }),
        card("reverse", "red", { kind: "reverse" }),
        card("spare", "blue"),
      ],
      [bi]: [card("other-one"), card("other-two")],
    },
    ai
  )
  f.bumpVersion(code)
  await expect.poll(() => a.status().self?.hand[0]?.id).toBe("discard")
  const inputs = capture(ai)
  await a.execute({
    action: "stage-play",
    cardIds: ["discard"],
    discardCardIds: ["plus", "reverse"],
    topCardId: "reverse",
    declaredUno: true,
    previewMs: 0,
  })
  expect(inputs[0]).toEqual({
    event: "game:stageCards",
    input: { cardIds: ["discard", "plus", "reverse"], declaredUno: true },
  })
  expect(inputs[1]).toEqual({
    event: "game:playCards",
    input: {
      cardIds: ["discard"],
      discardCardIds: ["plus", "reverse"],
      topCardId: "reverse",
      declaredUno: true,
    },
  })
  expect(a.status().room?.game).toMatchObject({
    topDiscard: { id: "reverse" },
    drawStack: null,
    direction: 1,
    turnPlayerId: bi,
  })
  expect(a.status().self?.hand.map((c) => c.id)).toEqual(["spare"])
})

it("uncertain staging sends no commit and requires explicit recovery", async () => {
  const { a } = await seats(true)
  f.controls.dropAckFor = "game:stageCards"
  await expect(
    a.execute({ action: "stage-play", cardIds: ["red-five"], previewMs: 0 })
  ).rejects.toMatchObject({ code: "outcome-unknown" })
  expect(a.status().needsResync).toBe(true)
  expect(f.received.filter((e) => e === "game:stageCards")).toHaveLength(1)
  expect(f.received).not.toContain("game:playCards")
  await expect(
    a.execute({ action: "play", cardIds: ["red-five"] })
  ).rejects.toMatchObject({ code: "resync-required" })
})

it("disconnect after a stage acknowledgement blocks the macro commit", async () => {
  const { a, ai } = await seats(true)
  f.controls.holdAckFor = "game:stageCards"
  const result = a.execute({
    action: "stage-play",
    cardIds: ["red-five"],
    previewMs: 500,
  })
  const outcome = result.catch((cause) => cause)
  await expect.poll(() => f.heldAcks.length).toBe(1)
  f.releaseAck()
  await expect
    .poll(() => a.status().room?.game?.stagedPlay?.cards[0]?.id)
    .toBe("red-five")
  const socket = [...f.io.sockets.sockets.values()].find(
    (s) => s.data.playerId === ai
  )!
  socket.conn.close()
  expect(await outcome).toMatchObject({
    code: expect.stringMatching(/^stage-/),
  })
  expect(f.received).not.toContain("game:playCards")
})

it("default presentation pause is bounded and protocol payloads omit controller-only fields", async () => {
  const { a, ai } = await seats(true)
  const inputs = capture(ai)
  const begin = performance.now()
  await a.execute({
    id: "local-correlation",
    action: "stage-play",
    expectedVersion: a.status().room!.version,
    cardIds: ["red-five"],
  })
  const elapsed = performance.now() - begin
  expect(elapsed).toBeGreaterThanOrEqual(120)
  expect(elapsed).toBeLessThan(1500)
  expect(inputs.map((i) => i.event)).toEqual([
    "game:stageCards",
    "game:playCards",
  ])
  expect(
    inputs.every(
      (i) =>
        !JSON.stringify(i.input).match(
          /previewMs|expectedVersion|local-correlation|stage-play/
        )
    )
  ).toBe(true)
})

it.each([-1, 501, 1.5, "180"])(
  "rejects invalid previewMs %s without sending anything",
  async (previewMs) => {
    const { a } = await seats(true)
    await expect(
      a.execute({ action: "stage-play", cardIds: ["red-five"], previewMs })
    ).rejects.toMatchObject({ code: "invalid-command" })
    expect(f.received).not.toContain("game:stageCards")
  }
)

it("rejects undeclared social capabilities and malformed public fields", () => {
  for (const input of [
    { action: "chat-send", body: "hello", channel: "squad" },
    { action: "chat-send", body: "hello", kind: "gif" },
    { action: "chat-send", body: "x".repeat(241) },
    { action: "chat-react", messageId: "id", emoji: "💀", active: true },
    { action: "chat-typing", typing: "yes" },
    { action: "chat-read", limit: 101 },
    { action: "stage-play", cardIds: ["x"], endTurn: true },
  ])
    expect(() => parseCommand(input)).toThrow()
})

it("sends and reads public text, replies, toggles reactions, and broadcasts bounded typing", async () => {
  const { a, b, ai, bi } = await seats()
  await a.execute({ action: "chat-typing", typing: true })
  await expect
    .poll(() => b.status().chat.typing.map((p) => p.playerId))
    .toContain(ai)
  const expiresAt = b
    .status()
    .chat.typing.find((p) => p.playerId === ai)!.expiresAt
  expect(expiresAt - Date.now()).toBeGreaterThan(0)
  expect(expiresAt - Date.now()).toBeLessThanOrEqual(3000)
  await a.execute({ action: "chat-send", body: "Hello table" })
  await expect.poll(() => b.status().room?.chatMessages.length).toBe(1)
  await expect.poll(() => b.status().chat.typing).toEqual([])
  const first = ((await b.execute({ action: "chat-read" })) as ChatPage)
    .messages[0]!
  expect(first).toMatchObject({
    playerId: ai,
    channel: "public",
    kind: "text",
    body: "Hello table",
  })
  await b.execute({
    action: "chat-send",
    body: "Reply from B",
    replyToMessageId: first.id,
  })
  const page = (await b.execute({
    action: "chat-read",
    afterMessageId: first.id,
  })) as ChatPage
  expect(page.messages).toHaveLength(1)
  expect(page.messages[0]).toMatchObject({
    body: "Reply from B",
    replyToMessageId: first.id,
    playerId: bi,
  })
  await b.execute({
    action: "chat-react",
    messageId: first.id,
    emoji: "👍",
    active: true,
  })
  await b.execute({
    action: "chat-react",
    messageId: first.id,
    emoji: "👍",
    active: true,
  })
  expect(b.status().room?.chatMessages[0]?.reactions).toEqual([
    { emoji: "👍", playerIds: [bi] },
  ])
  await new Promise((resolve) => setTimeout(resolve, 310))
  await b.execute({
    action: "chat-react",
    messageId: first.id,
    emoji: "👍",
    active: false,
  })
  expect(b.status().room?.chatMessages[0]?.reactions).toEqual([])
  await a.execute({ action: "chat-typing", typing: true })
  await a.execute({ action: "chat-typing", typing: false })
  await expect.poll(() => b.status().chat.typing).toEqual([])
})

it("deduplicates mention notices with watch disabled and consumes them only when read", async () => {
  const { a, b, ai, code } = await seats()
  await a.execute({ action: "watch", enabled: false })
  const notices: Array<{ type: string }> = []
  a.on("notice", (notice) => notices.push(notice))
  const waking = a.execute({
    action: "wait-for-action",
    afterVersion: a.status().room!.version,
    timeoutMs: 1000,
  })
  await b.execute({
    action: "chat-send",
    body: "@CLI A your turn to chat",
    mentionPlayerIds: [ai],
  })
  await expect(waking).resolves.toMatchObject({
    timedOut: false,
    reasons: ["mention"],
  })
  const id = b.status().room!.chatMessages[0]!.id
  f.publish(code)
  await a.execute({ action: "resync" })
  expect(a.status().chat.pendingMentionIds).toEqual([id])
  expect(notices.filter((n) => n.type === "chat-message")).toHaveLength(1)
  expect(notices.filter((n) => n.type === "state")).toHaveLength(0)
  const page = (await a.execute({ action: "chat-read", limit: 1 })) as ChatPage
  expect(page).toMatchObject({ nextMessageId: id, gap: false })
  expect(page.messages.map((m) => m.id)).toEqual([id])
  expect(a.status().chat.pendingMentionIds).toEqual([])
  await expect(
    a.execute({ action: "wait-for-action", timeoutMs: 25 })
  ).resolves.toMatchObject({ timedOut: true, reasons: [] })
  expect(
    ((await a.execute({ action: "chat-read", afterMessageId: id })) as ChatPage)
      .messages
  ).toEqual([])
  expect(
    await a.execute({ action: "chat-read", afterMessageId: "evicted-cursor" })
  ).toMatchObject({ gap: true, nextMessageId: id })
})

it("chat-watch suppresses notices while preserving mention wakeups", async () => {
  const { a, b, ai } = await seats()
  await a.execute({ action: "watch", enabled: false })
  await a.execute({ action: "chat-watch", enabled: false })
  const notices: unknown[] = []
  a.on("notice", (n) => notices.push(n))
  const wait = a.execute({ action: "wait-for-action", timeoutMs: 1000 })
  await b.execute({
    action: "chat-send",
    body: "@CLI A hello",
    mentionPlayerIds: [ai],
  })
  await expect(wait).resolves.toMatchObject({ reasons: ["mention"] })
  expect(notices).toEqual([])
  expect(
    ((await a.execute({ action: "chat-read" })) as ChatPage).messages
  ).toHaveLength(1)
})

it("a limited chat read consumes only returned mentions and advances its cursor", async () => {
  const { a, b, ai, code } = await seats()
  const browser = await f.browser(code)
  await b.execute({
    action: "chat-send",
    body: "@CLI A first",
    mentionPlayerIds: [ai],
  })
  const sent = await browser.socket
    .timeout(1000)
    .emitWithAck("room:sendChatMessage", {
      kind: "text",
      body: "@CLI A second",
      mentionPlayerIds: [ai],
    })
  expect(sent.ok).toBe(true)
  await expect.poll(() => a.status().chat.pendingMentionIds.length).toBe(2)
  const pendingIds = [...a.status().chat.pendingMentionIds]
  const first = (await a.execute({ action: "chat-read", limit: 1 })) as ChatPage
  expect(first.messages.map((m) => m.id)).toEqual([pendingIds[0]])
  expect(first.nextMessageId).toBe(pendingIds[0])
  expect(a.status().chat.pendingMentionIds).toEqual([pendingIds[1]])
  const second = (await a.execute({
    action: "chat-read",
    afterMessageId: first.nextMessageId,
    limit: 1,
  })) as ChatPage
  expect(second.messages.map((m) => m.id)).toEqual([pendingIds[1]])
  expect(a.status().chat.pendingMentionIds).toEqual([])
})

it("initial join baselines historical chat without emitting old messages", async () => {
  const host = f.client(700)
  await host.execute({ action: "create", name: "Host" })
  await host.execute({ action: "chat-send", body: "Old public history" })
  const newcomer = f.client(700)
  const notices: Array<{ type: string }> = []
  newcomer.on("notice", (n) => notices.push(n))
  await newcomer.execute({
    action: "join",
    code: host.status().room!.code,
    name: "Newcomer",
  })
  expect(notices.filter((n) => n.type === "chat-message")).toEqual([])
  expect(newcomer.status().chat.pendingMentionIds).toEqual([])
  expect(
    ((await newcomer.execute({ action: "chat-read" })) as ChatPage).messages[0]
      ?.body
  ).toBe("Old public history")
})

it("reconnect retains consumed cursors and does not replay mention notifications", async () => {
  const { a, b, ai, code } = await seats()
  const notices: Array<{ type: string }> = []
  a.on("notice", (n) => notices.push(n))
  await b.execute({
    action: "chat-send",
    body: "@CLI A reconnect test",
    mentionPlayerIds: [ai],
  })
  await expect.poll(() => a.status().chat.pendingMentionIds.length).toBe(1)
  await a.execute({ action: "chat-read" })
  const socket = [...f.io.sockets.sockets.values()].find(
    (s) => s.data.playerId === ai
  )!
  socket.conn.close()
  await expect.poll(() => a.status().joined).toBe(false)
  await expect.poll(() => a.status().joined, { timeout: 5000 }).toBe(true)
  f.publish(code)
  await a.execute({ action: "resync" })
  expect(a.status().chat.pendingMentionIds).toEqual([])
  expect(notices.filter((n) => n.type === "chat-message")).toHaveLength(1)
})

it("metrics are bounded timing-only records with cloned output and no hand/chat/session content", async () => {
  const { a } = await seats(true)
  await a.execute({ action: "chat-send", body: "private-log-marker" })
  const initial = (await a.execute({ action: "metrics" })) as {
    samples: Array<Record<string, unknown>>
  }
  expect(initial.samples).toContainEqual(
    expect.objectContaining({
      action: "chat-send",
      ackMs: expect.any(Number),
      syncMs: expect.any(Number),
    })
  )
  expect(initial.samples).toContainEqual(
    expect.objectContaining({
      action: "chat-send",
      queueMs: expect.any(Number),
      totalMs: expect.any(Number),
    })
  )
  expect(JSON.stringify(initial)).not.toMatch(
    /red-five|private-log-marker|sessionId|playerId|body|room/
  )
  expect(
    initial.samples.every((sample) =>
      Object.keys(sample).every((key) =>
        ["action", "queueMs", "ackMs", "syncMs", "totalMs"].includes(key)
      )
    )
  ).toBe(true)
  for (let i = 0; i < 110; i++)
    await a.execute({ action: "watch", enabled: false })
  const metrics = (await a.execute({ action: "metrics" })) as {
    samples: Array<Record<string, unknown>>
  }
  expect(metrics.samples).toHaveLength(100)
  for (const sample of metrics.samples) {
    expect(
      Object.keys(sample).every((key) =>
        ["action", "queueMs", "ackMs", "syncMs", "totalMs"].includes(key)
      )
    ).toBe(true)
    for (const [key, value] of Object.entries(sample))
      if (key !== "action") {
        expect(typeof value).toBe("number")
        expect(Number.isFinite(value)).toBe(true)
        expect(value as number).toBeGreaterThanOrEqual(0)
      }
  }
  expect(JSON.stringify(metrics)).not.toMatch(
    /red-five|private-log-marker|sessionId|playerId|body|room/
  )
  metrics.samples.length = 0
  expect(
    ((await a.execute({ action: "metrics" })) as typeof metrics).samples
  ).toHaveLength(100)
})

it("hydrates existing typing on join without needing a fresh typing event", async () => {
  const { a, ai, code } = await seats()
  await a.execute({ action: "chat-typing", typing: true })
  const newcomer = f.client(700)
  await newcomer.execute({ action: "join", code, name: "Newcomer" })
  expect(newcomer.status().chat.typing).toEqual([
    expect.objectContaining({ playerId: ai }),
  ])
})

it("stops roulette if a confirmed interleaved chat loses its connection before synchronization", async () => {
  const { a, b, ai, bi, code } = await seats(true)
  const game = f.game(code)
  seed(
    game,
    {
      [ai]: [
        card("roulette", "wild", { kind: "wild-color-roulette" }),
        card("spare"),
      ],
      [bi]: [card("b1"), card("b2")],
    },
    ai
  )
  game.drawPile = [
    card("miss", "blue"),
    card("match", "green"),
    card("unused", "yellow"),
  ]
  f.bumpVersion(code)
  await expect.poll(() => a.status().self?.hand[0]?.id).toBe("roulette")
  await a.execute({
    action: "play",
    cardIds: ["roulette"],
    chosenColor: "green",
    declaredUno: true,
  })
  await expect.poll(() => b.status().pending.roulette?.playerId).toBe(bi)
  f.controls.holdAckFor = "game:drawRouletteCard"
  const resolving = b.execute({ action: "resolve-roulette" })
  await expect.poll(() => f.heldAcks.length).toBe(1)
  const chatting = b.execute({ action: "chat-send", body: "Still drawing" })
  f.controls.holdPrivate = true
  f.controls.disconnectFor = "room:sendChatMessage"
  f.releaseAck()
  expect(await chatting).toMatchObject({ confirmed: true })
  expect(await resolving).toMatchObject({
    complete: false,
    confirmedDraws: 1,
    stopReason: "disconnected",
  })
  expect(
    f.received.filter((event) => event === "game:drawRouletteCard")
  ).toHaveLength(1)
})

it("returns pending mentions alongside the current turn and preserves the version gate", async () => {
  const { a, b, ai } = await seats(true)
  await b.execute({
    action: "chat-send",
    body: "@CLI A hello",
    mentionPlayerIds: [ai],
  })
  await expect.poll(() => a.status().chat.pendingMentionIds.length).toBe(1)
  await expect(
    a.execute({ action: "wait-for-action", timeoutMs: 100 })
  ).resolves.toMatchObject({ reasons: ["mention", "turn"] })
  await expect(
    a.execute({
      action: "wait-for-action",
      afterVersion: a.status().room!.version,
      timeoutMs: 100,
    })
  ).resolves.toMatchObject({ reasons: ["mention"] })
  await a.execute({ action: "chat-read" })
  await expect(
    a.execute({ action: "wait-for-action", timeoutMs: 100 })
  ).resolves.toMatchObject({ reasons: ["turn"] })
})

it.each([-86_400_000, 86_400_000])(
  "anchors live typing to the local clock with server skew %i",
  async (skew) => {
    const { a, bi, code } = await seats()
    const before = Date.now()
    f.io
      .to(code)
      .emit("room:chatTyping", [{ playerId: bi, expiresAt: before + skew }])
    await expect.poll(() => a.status().chat.typing.length).toBe(1)
    const expiry = a.status().chat.typing[0]!.expiresAt
    expect(expiry).toBeGreaterThan(before)
    expect(expiry).toBeLessThanOrEqual(Date.now() + 3_000)
    const clock = vi.spyOn(Date, "now").mockReturnValue(expiry + 1)
    expect(a.status().chat.typing).toEqual([])
    clock.mockRestore()
  }
)

it.each([-86_400_000, 86_400_000])(
  "anchors typing hydration to the local clock with server skew %i",
  async (skew) => {
    const { ai, code } = await seats()
    const before = Date.now()
    vi.spyOn(f.manager, "getChatTyping").mockReturnValue([
      { playerId: ai, expiresAt: before + skew },
    ])
    const newcomer = f.client(700)
    await newcomer.execute({ action: "join", code, name: "Skew newcomer" })
    const typing = newcomer.status().chat.typing
    expect(typing).toHaveLength(1)
    expect(typing[0]!.expiresAt).toBeGreaterThan(before)
    expect(typing[0]!.expiresAt).toBeLessThanOrEqual(Date.now() + 3_000)
  }
)
