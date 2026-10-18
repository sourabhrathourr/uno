import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fixture, card, seed } from "./test-fixture"
import type { UnoClient } from "./client"

let f: Awaited<ReturnType<typeof fixture>>
beforeEach(async () => {
  f = await fixture()
})
afterEach(async () => {
  await f.close()
  vi.useRealTimers()
})

async function players(third = false) {
  const a = f.client(700)
  await a.execute({ action: "create", name: "CLI A" })
  const code = a.status().room!.code
  const b = f.client(700)
  await b.execute({ action: "join", code, name: "CLI B" })
  const browser = third ? await f.browser(code) : null
  await a.execute({ action: "ready", ready: true })
  await b.execute({ action: "ready", ready: true })
  if (browser)
    await browser.socket
      .timeout(1_000)
      .emitWithAck("room:setReady", { ready: true })
  await a.execute({ action: "start" })
  return {
    a,
    b,
    code,
    ai: a.status().playerId!,
    bi: b.status().playerId!,
    browser,
    game: f.game(code),
  }
}
async function synced(...clients: UnoClient[]) {
  for (const client of clients)
    await expect.poll(() => client.status().synchronized).toBe(true)
}

async function pendingGift() {
  const context = await players(true)
  const { a, b, ai, bi, game, code, browser } = context
  const ci = browser!.playerId
  seed(
    game,
    {
      [ai]: [
        card("roulette", "wild", { kind: "wild-color-roulette" }),
        card("a-spare"),
      ],
      [bi]: Array.from({ length: 24 }, (_, i) => card(`b-${i}`)),
      [ci]: [card("c1"), card("c2")],
    },
    ai
  )
  game.drawPile = [card("yellow-hit", "yellow"), card("blue-hit", "blue")]
  f.publish(code)
  await expect.poll(() => a.status().self?.hand[0]?.id).toBe("roulette")
  await a.execute({
    action: "play",
    cardIds: ["roulette"],
    chosenColor: "green",
    declaredUno: true,
  })
  await b.execute({ action: "roulette" })
  await b.execute({ action: "roulette" })
  return { ...context, ci, giftId: b.status().pending.lastGift!.id }
}

describe("persistent client against the real room manager", () => {
  it("allows correcting the room and name after a definitive first-join rejection", async () => {
    const a = f.client(700)
    await expect(
      a.execute({ action: "join", code: "BAD123", name: "Wrong name" })
    ).rejects.toMatchObject({ code: "room-not-found" })
    expect(a.status().joined).toBe(false)
    const host = f.client(700)
    await host.execute({ action: "create", name: "Host" })
    await a.execute({
      action: "join",
      code: host.status().room!.code,
      name: "Correct name",
    })
    expect(a.status().joined).toBe(true)
    expect(a.status().room!.players).toContainEqual(
      expect.objectContaining({ id: a.status().playerId, name: "Correct name" })
    )
    await expect(
      a.execute({ action: "join", code: "OTHER1", name: "Another seat" })
    ).rejects.toMatchObject({ code: "seat-locked" })
  })

  it("preserves an uncertain first-join target until the same seat is recovered", async () => {
    const host = f.client(700)
    await host.execute({ action: "create", name: "Host" })
    const code = host.status().room!.code
    const a = f.client(150)
    f.controls.dropAckFor = "room:join"
    await expect(
      a.execute({ action: "join", code, name: "Recover me" })
    ).rejects.toMatchObject({ code: expect.stringMatching(/timeout/) })
    await expect(
      a.execute({ action: "join", code: "OTHER1", name: "Another seat" })
    ).rejects.toMatchObject({ code: "seat-locked" })
    f.controls.dropAckFor = ""
    await a.execute({ action: "resync" })
    expect(a.status().joined).toBe(true)
    expect(a.status().room!.players).toHaveLength(2)
  })

  it("isolates each hand, ignores foreign/stale private state, and coexists with a browser client", async () => {
    const { a, b, ai, bi, code, game, browser } = await players(true)
    const ci = browser!.playerId
    seed(
      game,
      {
        [ai]: [card("a-private"), card("a-spare", "blue")],
        [bi]: [card("b-secret"), card("b-spare")],
        [ci]: [card("browser-secret"), card("browser-spare")],
      },
      ai
    )
    f.publish(code)
    await synced(a, b)
    await expect.poll(() => a.status().self?.hand[0]?.id).toBe("a-private")
    expect(JSON.stringify(a.status())).not.toMatch(/b-secret|browser-secret/)
    expect(JSON.stringify(b.status())).not.toMatch(/a-private|browser-secret/)
    expect(JSON.stringify(a.status())).not.toContain("sessionId")
    const serverSocket = [...f.io.sockets.sockets.values()].find(
      (socket) => socket.data.playerId === ai
    )!
    serverSocket.emit("game:playerState", f.manager.getPlayerGame(code, bi))
    serverSocket.emit("game:playerState", {
      ...a.status().self!,
      roomVersion: -1,
      hand: [card("stale-secret")],
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(a.status().self!.hand[0]!.id).toBe("a-private")
    const copy = a.status()
    copy.self!.hand.length = 0
    expect(a.status().self!.hand).toHaveLength(2)
    await expect(
      a.execute({ action: "play", cardIds: ["b-secret"] })
    ).rejects.toMatchObject({ code: "card-not-owned" })
    expect(f.received).not.toContain("voice:join")
    expect(f.received).not.toContain("game:getSupportView")
  })

  it("plays legal multi-card groups, rejects illegal moves, declares UNO, draws and passes", async () => {
    const { a, b, ai, bi, code, game } = await players()
    seed(
      game,
      {
        [ai]: [
          card("r5"),
          card("b5", "blue"),
          card("g2", "green", { kind: "number", value: 2 }),
        ],
        [bi]: [
          card("b3", "blue", { kind: "number", value: 3 }),
          card("b-spare", "yellow"),
        ],
      },
      ai
    )
    f.publish(code)
    await expect.poll(() => a.status().self?.hand.length).toBe(3)
    await expect(a.execute({ action: "pass" })).rejects.toMatchObject({
      code: "draw-before-ending",
    })
    await expect(
      a.execute({ action: "play", cardIds: ["g2"] })
    ).rejects.toMatchObject({ code: "not-playable" })
    await expect(
      b.execute({ action: "play", cardIds: ["b3"] })
    ).rejects.toMatchObject({ code: "not-your-turn" })
    await a.execute({
      action: "play",
      cardIds: ["r5", "b5"],
      declaredUno: true,
    })
    expect(a.status().self!.hand.map((card) => card.id)).toEqual(["g2"])
    expect(
      a.status().room!.game!.players.find((player) => player.playerId === ai)!
        .declaredUno
    ).toBe(true)
    await b.execute({ action: "play", cardIds: ["b3"], declaredUno: true })
    await a.execute({ action: "draw" })
    expect(a.status().self!.canEndTurn).toBe(true)
    await expect(a.execute({ action: "draw" })).rejects.toMatchObject({
      code: "already-drew",
    })
    await a.execute({ action: "pass" })
    expect(a.status().room!.game!.turnPlayerId).toBe(bi)
  })

  it("stages Discard All extras, suppresses their action effects, and can finish/restart", async () => {
    const { a, b, ai, bi, code, game } = await players()
    const d = card("discard", "red", { kind: "discard-color" })
    const d2 = card("discard-2", "red", { kind: "discard-color" })
    const draw = card("discarded-plus", "red", { kind: "draw", count: 4 })
    const reverse = card("discarded-reverse", "red", { kind: "reverse" })
    seed(
      game,
      {
        [ai]: [d, d2, draw, reverse, card("spare", "blue")],
        [bi]: [card("b1"), card("b2")],
      },
      ai
    )
    f.publish(code)
    await expect.poll(() => a.status().self?.hand.length).toBe(5)
    await a.execute({
      action: "stage",
      cardIds: [d.id, d2.id, draw.id, reverse.id],
    })
    expect(a.status().self!.hand).toHaveLength(5)
    await a.execute({
      action: "play",
      cardIds: [d.id],
      discardCardIds: [d2.id, draw.id, reverse.id],
      topCardId: reverse.id,
      declaredUno: true,
    })
    expect(a.status().self!.hand.map((card) => card.id)).toEqual(["spare"])
    expect(a.status().room!.game).toMatchObject({
      drawStack: null,
      direction: 1,
      turnPlayerId: bi,
      topDiscard: { id: reverse.id },
    })
    seed(game, { [ai]: [d, d2], [bi]: [card("b1"), card("b2")] }, ai)
    f.publish(code)
    await expect.poll(() => a.status().self?.hand.length).toBe(2)
    await a.execute({
      action: "play",
      cardIds: [d.id],
      discardCardIds: [d2.id],
    })
    expect(a.status().room!.game!.winnerPlacements[0]!.playerId).toBe(ai)
    expect(a.status().room!.status).toBe("finished")
    await a.execute({ action: "restart" })
    expect(a.status().room!.status).toBe("playing")
    expect(a.status().self!.hand).toHaveLength(7)
    await synced(a, b)
  })

  it.each([0, 7] as const)(
    "supports optional single %i hand transfers",
    async (value) => {
      const { a, ai, bi, code, game } = await players()
      seed(
        game,
        {
          [ai]: [
            card("special", "red", { kind: "number", value }),
            card("mine-1"),
            card("mine-2"),
          ],
          [bi]: [
            card("received-1", "green"),
            card("received-2", "blue"),
            card("received-3", "yellow"),
          ],
        },
        ai
      )
      f.publish(code)
      await expect.poll(() => a.status().self?.hand[0]?.id).toBe("special")
      await a.execute({
        action: "play",
        cardIds: ["special"],
        ...(value === 0 ? { rotateHands: true } : { swapWithPlayerId: bi }),
      })
      expect(a.status().self!.hand.map((card) => card.id)).toEqual([
        "received-1",
        "received-2",
        "received-3",
      ])
    }
  )

  it("stacks draw groups, requires a color for wilds, and takes the accumulated penalty", async () => {
    const { a, b, ai, bi, code, game } = await players()
    seed(
      game,
      {
        [ai]: [
          card("r2", "red", { kind: "draw", count: 2 }),
          card("b2", "blue", { kind: "draw", count: 2 }),
          card("low", "red", { kind: "draw", count: 2 }),
          card("spare", "green"),
        ],
        [bi]: [
          card("wild4", "wild", { kind: "wild-draw", count: 4 }),
          card("b-spare"),
        ],
      },
      ai
    )
    f.publish(code)
    await expect.poll(() => a.status().self?.hand.length).toBe(4)
    await a.execute({ action: "play", cardIds: ["r2", "b2"] })
    expect(a.status().room!.game!.drawStack!.amount).toBe(4)
    await expect(
      b.execute({ action: "play", cardIds: ["wild4"] })
    ).rejects.toMatchObject({ code: "missing-color" })
    await b.execute({
      action: "play",
      cardIds: ["wild4"],
      chosenColor: "red",
      declaredUno: true,
    })
    expect(b.status().room!.game!.drawStack!.amount).toBe(8)
    await expect(
      a.execute({ action: "play", cardIds: ["low"] })
    ).rejects.toMatchObject({ code: "draw-stack-too-low" })
    await a.execute({ action: "penalty" })
    expect(a.status().self!.hand).toHaveLength(10)
    expect(a.status().room!.game!.drawStack).toBeNull()
  })

  it("catches a missing UNO declaration using only public/own action flags", async () => {
    const { a, b, ai, bi, code, game } = await players()
    seed(
      game,
      {
        [ai]: [card("a1"), card("a2")],
        [bi]: [card("b5"), card("b-spare", "blue")],
      },
      bi
    )
    f.publish(code)
    await expect.poll(() => b.status().self?.hand[0]?.id).toBe("b5")
    await b.execute({ action: "play", cardIds: ["b5"] })
    await expect.poll(() => a.status().self!.catchablePlayerIds).toContain(bi)
    await a.execute({ action: "catch-uno", targetPlayerId: bi })
    expect(
      a.status().room!.game!.players.find((player) => player.playerId === bi)!
        .handCount
    ).toBe(3)
  })

  it.each([
    { kind: "skip", count: 1, next: "c", direction: 1, draw: null },
    { kind: "skip", count: 2, next: "a", direction: 1, draw: null },
    { kind: "skip-everyone", count: 1, next: "a", direction: 1, draw: null },
    { kind: "reverse", count: 1, next: "c", direction: -1, draw: null },
    { kind: "reverse", count: 2, next: "b", direction: 1, draw: null },
    { kind: "draw", count: 1, next: "b", direction: 1, draw: 4 },
    { kind: "wild", count: 1, next: "b", direction: 1, draw: null },
    { kind: "wild-draw", count: 1, next: "b", direction: 1, draw: 6 },
    { kind: "wild-draw", count: 1, next: "b", direction: 1, draw: 10 },
    { kind: "wild-reverse-draw", count: 1, next: "c", direction: -1, draw: 4 },
    { kind: "wild-reverse-draw", count: 1, next: "c", direction: -1, draw: 10 },
  ] as const)(
    "preserves $kind x$count effects (draw=$draw)",
    async (scenario) => {
      const { a, ai, bi, code, game, browser } = await players(true)
      const ci = browser!.playerId
      const face =
        scenario.draw === null
          ? { kind: scenario.kind }
          : { kind: scenario.kind, count: scenario.draw }
      const cards = Array.from({ length: scenario.count }, (_, i) =>
        card(
          `action-${i}`,
          scenario.kind.startsWith("wild") ? "wild" : "red",
          face as import("@workspace/game").Card["face"]
        )
      )
      seed(
        game,
        {
          [ai]: [...cards, card("spare", "green")],
          [bi]: [card("b1"), card("b2")],
          [ci]: [card("c1"), card("c2")],
        },
        ai
      )
      f.publish(code)
      await expect.poll(() => a.status().self?.hand[0]?.id).toBe("action-0")
      await a.execute({
        action: "play",
        cardIds: cards.map((card) => card.id),
        ...(scenario.kind.startsWith("wild") ? { chosenColor: "blue" } : {}),
        declaredUno: true,
      })
      const next = { a: ai, b: bi, c: ci }[scenario.next]
      expect(a.status().room!.game!.turnPlayerId).toBe(next)
      expect(a.status().room!.game!.direction).toBe(scenario.direction)
      expect(a.status().room!.game!.drawStack?.amount ?? null).toBe(
        scenario.draw
      )
      if (scenario.kind.startsWith("wild"))
        expect(a.status().room!.game!.currentColor).toBe("blue")
    }
  )

  it("rejects mixed groups and forbidden power-card finishes, and supports the draw-stack final-card escape", async () => {
    const { a, ai, bi, code, game } = await players()
    seed(
      game,
      {
        [ai]: [card("r5"), card("r6", "red", { kind: "number", value: 6 })],
        [bi]: [card("b1"), card("b2")],
      },
      ai
    )
    f.publish(code)
    await expect.poll(() => a.status().self?.hand[0]?.id).toBe("r5")
    await expect(
      a.execute({ action: "play", cardIds: ["r5", "r6"] })
    ).rejects.toMatchObject({ code: "multi-card-group-mismatch" })
    const wild = card("last-power", "wild", { kind: "wild-draw", count: 4 })
    seed(game, { [ai]: [wild], [bi]: [card("b1"), card("b2")] }, ai)
    f.publish(code)
    await expect.poll(() => a.status().self?.hand.length).toBe(1)
    await expect(
      a.execute({ action: "play", cardIds: [wild.id], chosenColor: "red" })
    ).rejects.toMatchObject({ code: "power-card-finish" })
    game.drawStack = { amount: 4, minimum: 4, targetPlayerId: ai }
    game.discardPile = [card("table-plus4", "red", { kind: "draw", count: 4 })]
    f.publish(code)
    await a.execute({ action: "draw" })
    await a.execute({
      action: "play",
      cardIds: [wild.id],
      chosenColor: "red",
      declaredUno: true,
    })
    expect(a.status().room!.game!.drawStack!.amount).toBe(8)
  })

  it.each([true, false])(
    "handles blind trade response (accept=%s) without exposing offered cards",
    async (accept) => {
      const { a, b, ai, bi, code, game } = await players()
      seed(
        game,
        {
          [ai]: [card("a-offer"), card("a-spare")],
          [bi]: [card("b-offer", "blue"), card("b-spare")],
        },
        ai
      )
      f.publish(code)
      await expect.poll(() => a.status().self?.hand[0]?.id).toBe("a-offer")
      await a.execute({
        action: "trade-offer",
        cardId: "a-offer",
        targetPlayerId: bi,
      })
      await expect.poll(() => b.status().room!.game!.tradeOffer).not.toBeNull()
      expect(JSON.stringify(b.status())).not.toContain("a-offer")
      const offerId = b.status().room!.game!.tradeOffer!.id
      await b.execute({
        action: "trade-respond",
        offerId,
        accept,
        ...(accept ? { cardId: "b-offer" } : {}),
      })
      await synced(a, b)
      await expect.poll(() => a.status().room!.game!.tradeOffer).toBeNull()
      expect(a.status().self!.hand.some((card) => card.id === "b-offer")).toBe(
        accept
      )
    }
  )

  it("cancels its own pending trade", async () => {
    const { a, ai, bi, code, game } = await players()
    seed(
      game,
      {
        [ai]: [card("a-offer"), card("a-spare")],
        [bi]: [card("b1"), card("b2")],
      },
      ai
    )
    f.publish(code)
    await expect.poll(() => a.status().self?.hand[0]?.id).toBe("a-offer")
    await a.execute({
      action: "trade-offer",
      cardId: "a-offer",
      targetPlayerId: bi,
    })
    await a.execute({
      action: "trade-cancel",
      offerId: a.status().room!.game!.tradeOffer!.id,
    })
    expect(a.status().room!.game!.tradeOffer).toBeNull()
    expect(a.status().self!.hand).toHaveLength(2)
  })

  it("resolves roulette, mercy elimination and the eliminated player's last gift", async () => {
    const { a, b, ai, bi, code, game, browser } = await players(true)
    const ci = browser!.playerId
    seed(
      game,
      {
        [ai]: [
          card("roulette", "wild", { kind: "wild-color-roulette" }),
          card("a-spare"),
        ],
        [bi]: Array.from({ length: 24 }, (_, i) => card(`b-${i}`)),
        [ci]: [card("c1"), card("c2")],
      },
      ai
    )
    game.drawPile = [card("yellow-hit", "yellow"), card("blue-hit", "blue")]
    f.publish(code)
    await expect.poll(() => a.status().self?.hand[0]?.id).toBe("roulette")
    await a.execute({
      action: "play",
      cardIds: ["roulette"],
      chosenColor: "green",
      declaredUno: true,
    })
    await b.execute({ action: "roulette" })
    await b.execute({ action: "roulette" })
    expect(
      b.status().room!.game!.players.find((player) => player.playerId === bi)!
        .eliminated
    ).toBe(true)
    expect(b.status().self!.lastGiftCards).toHaveLength(26)
    await expect(a.execute({ action: "draw" })).rejects.toMatchObject({
      code: "last-gift-pending",
    })
    await b.execute({
      action: "gift",
      giftId: b.status().room!.game!.lastGift!.id,
      cardId: "b-0",
      targetPlayerId: ci,
    })
    expect(b.status().room!.game!.lastGift).toBeNull()
    expect(
      b.status().room!.game!.players.find((player) => player.playerId === ci)!
        .handCount
    ).toBe(3)
  })

  it("reports server gift recipients/countdown, rejects full recipients and confirms a valid gift", async () => {
    const { a, b, ai, bi, ci, game, code, giftId } = await pendingGift()
    game.handsByPlayerId[ci] = Array.from({ length: 25 }, (_, i) =>
      card(`full-${i}`)
    )
    f.publish(code)
    await expect
      .poll(() => b.status().pending.lastGift?.eligibleRecipientIds)
      .toEqual([ai])
    expect(b.status().pending.lastGift).toMatchObject({
      id: giftId,
      playerId: bi,
      isMine: true,
    })
    expect(b.status().pending.lastGift!.remainingMs).toBeGreaterThan(0)
    expect(b.status().pending.lastGift!.remainingMs).toBeLessThanOrEqual(10_000)
    await expect(
      b.execute({ action: "gift", giftId, cardId: "b-0", targetPlayerId: ci })
    ).rejects.toMatchObject({ code: "invalid-gift-target" })
    expect(b.status().pending.lastGift!.id).toBe(giftId)
    expect(b.status().self!.lastGiftCards).toHaveLength(26)
    await expect(
      b.execute({
        action: "gift",
        giftId,
        cardId: "not-mine",
        targetPlayerId: ai,
      })
    ).rejects.toMatchObject({ code: "card-not-owned" })
    const response = await b.execute({
      action: "gift",
      giftId,
      cardId: "b-0",
      targetPlayerId: ai,
    })
    expect(response).toMatchObject({ confirmed: true })
    expect(b.status().pending.lastGift).toBeNull()
    await expect.poll(() => a.status().self!.hand.length).toBe(2)
  })

  it("allows an explicit last-gift skip without changing another hand", async () => {
    const { b, ci, giftId } = await pendingGift()
    await b.execute({ action: "gift", giftId })
    expect(b.status().pending.lastGift).toBeNull()
    expect(
      b.status().room!.game!.players.find((player) => player.playerId === ci)!
        .handCount
    ).toBe(2)
  })

  it("does not extend gift expiry or submit an expired choice successfully", async () => {
    const { b, giftId } = await pendingGift()
    const expiresAt = b.status().pending.lastGift!.expiresAt!
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(expiresAt + 1)
    expect(b.status().pending.lastGift!.remainingMs).toBe(0)
    await expect(b.execute({ action: "gift", giftId })).rejects.toMatchObject({
      code: "gift-not-found",
    })
    await expect.poll(() => b.status().pending.lastGift).toBeNull()
  })

  it("resyncs a pending gift without extending it, but respects the server's skip-on-disconnect rule", async () => {
    const { b, bi, giftId } = await pendingGift()
    const expiresAt = b.status().pending.lastGift!.expiresAt
    await b.execute({ action: "resync" })
    expect(b.status().pending.lastGift).toMatchObject({ id: giftId, expiresAt })
    const socket = [...f.io.sockets.sockets.values()].find(
      (socket) => socket.data.playerId === bi
    )!
    socket.conn.close()
    await expect.poll(() => b.status().joined).toBe(false)
    await expect.poll(() => b.status().joined, { timeout: 4_000 }).toBe(true)
    expect(b.status().playerId).toBe(bi)
    expect(b.status().pending.lastGift).toBeNull()
    expect(b.status().self!.lastGiftCards).toHaveLength(0)
    await expect(b.execute({ action: "gift", giftId })).rejects.toMatchObject({
      code: "gift-not-found",
    })
  })

  it("serializes commands and blocks queued mutations after an uncertain send without replaying", async () => {
    const { a, ai, bi, code, game } = await players()
    seed(
      game,
      { [ai]: [card("a1"), card("a2")], [bi]: [card("b1"), card("b2")] },
      ai
    )
    f.publish(code)
    await synced(a)
    f.controls.dropAckFor = "game:drawOne"
    const outcomes = await Promise.allSettled([
      a.execute({ action: "draw" }),
      a.execute({ action: "pass" }),
    ])
    expect(outcomes[0]).toMatchObject({
      status: "rejected",
      reason: { code: "outcome-unknown" },
    })
    expect(outcomes[1]).toMatchObject({
      status: "rejected",
      reason: { code: "resync-required" },
    })
    expect(f.received.filter((event) => event === "game:drawOne")).toHaveLength(
      1
    )
    expect(f.received).not.toContain("game:endTurn")
    expect(a.status().self!.hand).toHaveLength(3)
    expect(a.status().needsResync).toBe(true)
    await a.execute({ action: "resync" })
    expect(a.status().needsResync).toBe(false)
    await a.execute({ action: "pass" })
  })

  it("serializes successful mutations rather than sending them concurrently", async () => {
    const a = f.client()
    await a.execute({ action: "create", name: "Host" })
    f.controls.delayAckMs = 50
    const first = a.execute({ action: "ready", ready: true })
    const second = a.execute({ action: "ready", ready: false })
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(
      f.received.filter((event) => event === "room:setReady")
    ).toHaveLength(1)
    await Promise.all([first, second])
    expect(
      f.received.filter((event) => event === "room:setReady")
    ).toHaveLength(2)
    expect(a.status().room!.players[0]!.ready).toBe(false)
  })

  it("restores the same seat after transport loss, rejects offline sends and stale decisions", async () => {
    const { a, ai, code } = await players()
    const oldVersion = a.status().room!.version
    await a.execute({ action: "resync" })
    await expect(
      a.execute({ action: "draw", expectedVersion: oldVersion })
    ).rejects.toMatchObject({ code: "stale-version" })
    const socket = [...f.io.sockets.sockets.values()].find(
      (socket) => socket.data.playerId === ai
    )!
    socket.conn.close()
    await expect.poll(() => a.status().connected).toBe(false)
    await expect(a.execute({ action: "draw" })).rejects.toMatchObject({
      code: "not-connected",
    })
    await expect.poll(() => a.status().joined, { timeout: 4_000 }).toBe(true)
    expect(a.status().playerId).toBe(ai)
    expect(a.status().room!.players).toHaveLength(2)
    expect(f.received).not.toContain("game:drawOne")
    await a.execute({ action: "resync" })
    expect(a.status().room!.code).toBe(code)
  })
})
