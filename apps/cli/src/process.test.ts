import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { mkdtemp, copyFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, beforeEach, expect, it } from "vitest"
import { io } from "socket.io-client"
import type { PlayerGameSnapshot, RoomSnapshot } from "@workspace/game"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const loader = import.meta.resolve("tsx")
const children: ChildProcess[] = []
let serverUrl: string
let portableDir: string
let portableEntry: string
const env = {
  PATH: process.env.PATH,
  NODE_ENV: "test",
  CORS_ORIGIN: "http://127.0.0.1",
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const ended = new Promise<void>((resolve) =>
    child.once("exit", () => resolve())
  )
  child.kill("SIGTERM")
  await ended
}

beforeEach(async () => {
  portableDir = await mkdtemp(join(tmpdir(), "uno-portable-"))
  portableEntry = join(portableDir, "uno-cli.cjs")
  await promisify(execFile)(process.execPath, ["build.mjs"], {
    cwd: join(root, "apps/cli"),
    env,
  })
  await copyFile(join(root, "apps/cli/dist/uno-cli.cjs"), portableEntry)
  const reservation = createServer()
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve)
  )
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  serverUrl = `http://127.0.0.1:${port}`
  const server = spawn(
    process.execPath,
    ["--import", loader, "apps/server/src/index.ts"],
    {
      cwd: root,
      env: { ...env, PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  children.push(server)
  let error = ""
  server.stderr!.on("data", (data) => {
    error += String(data)
  })
  await expect
    .poll(
      async () => {
        if (server.exitCode !== null)
          throw new Error(`Test server exited: ${error}`)
        try {
          return (await fetch(`${serverUrl}/health`)).status
        } catch {
          return 0
        }
      },
      { timeout: 10_000 }
    )
    .toBe(200)
}, 15_000)

afterEach(async () => {
  for (const child of children.splice(0).reverse()) await stop(child)
  await rm(portableDir, { recursive: true, force: true })
})

function cli(args: string[] = []) {
  const child = spawn(
    process.execPath,
    [portableEntry, "--server", serverUrl, ...args],
    {
      cwd: portableDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  children.push(child)
  const messages: Array<Record<string, any>> = []
  let stderr = ""
  child.stderr!.on("data", (data) => {
    stderr += String(data)
  })
  createInterface({ input: child.stdout! }).on("line", (line) => {
    messages.push(JSON.parse(line))
  })
  let id = 0
  async function send(command: Record<string, unknown>) {
    const commandId = ++id
    child.stdin!.write(`${JSON.stringify({ ...command, id: commandId })}\n`)
    await expect
      .poll(
        () => {
          const result = messages.find(
            (message) => message.type === "result" && message.id === commandId
          )
          if (result) return result
          if (child.exitCode !== null)
            throw new Error(`CLI exited early: ${stderr}`)
          return undefined
        },
        { timeout: 10_000 }
      )
      .toBeTruthy()
    return messages.find(
      (message) => message.type === "result" && message.id === commandId
    )!
  }
  return { child, messages, send }
}

it("accepts piped commands during startup, handles malformed input, and exits cleanly", async () => {
  const p = cli(["--create", "--name", "Pipe host"])
  // Input arrives before HTTP creation/join finishes; it must not be dropped.
  const status = await p.send({ action: "status" })
  expect(status.ok).toBe(true)
  expect(status.data.joined).toBe(true)
  expect(status.data.room.players[0].name).toBe("Pipe host")
  p.child.stdin!.write("this is not JSON\n")
  await expect
    .poll(() => p.messages.some((m) => m.error?.code === "invalid-json"))
    .toBe(true)
  const forbidden = await p.send({ action: "game:getSupportView" })
  expect(forbidden.error.code).toBe("unknown-action")
  expect((await p.send({ action: "watch", enabled: false })).ok).toBe(true)
  expect(JSON.stringify(p.messages)).not.toContain("sessionId")
  const exited = new Promise<number | null>((resolve) =>
    p.child.once("exit", resolve)
  )
  await p.send({ action: "quit" })
  expect(await exited).toBe(0)
}, 20_000)

it("uses website support and squad chat through portable CLI processes and real server handlers", async () => {
  const host = cli()
  const created = await host.send({ action: "create", name: "Squad host" })
  expect(created.ok).toBe(true)
  const code = created.data.room.code
  const target = created.data.playerId
  const browser = io(serverUrl, { transports: ["websocket"] })
  try {
    await new Promise<void>((resolve) => browser.once("connect", resolve))
    const joined = await browser.timeout(2_000).emitWithAck("room:join", {
      code,
      playerName: "Browser opponent",
      sessionId: "local-squad-browser",
    })
    expect(joined.ok).toBe(true)
    expect((await host.send({ action: "ready", ready: true })).ok).toBe(true)
    expect(
      (
        await browser
          .timeout(2_000)
          .emitWithAck("room:setReady", { ready: true })
      ).ok
    ).toBe(true)
    expect((await host.send({ action: "start" })).ok).toBe(true)
    const supporter = cli()
    const late = await supporter.send({
      action: "join",
      code,
      name: "Supporter",
    })
    expect(late.ok).toBe(true)
    const supporterId = late.data.playerId
    expect(late.data.self.hand).toEqual([])
    expect(
      (
        await supporter.send({
          action: "support-join",
          supportedPlayerId: target,
        })
      ).ok
    ).toBe(true)
    const view = await supporter.send({ action: "support-view" })
    expect(view.ok).toBe(true)
    const ownHand = (await host.send({ action: "status" })).data.self.hand
    expect(view.data).toMatchObject({
      readOnly: true,
      playerId: target,
      hand: ownHand,
    })
    expect((await supporter.send({ action: "status" })).data.self.hand).toEqual(
      []
    )
    expect(
      (
        await host.send({
          action: "chat-send",
          channel: "squad",
          body: "Private plan",
        })
      ).ok
    ).toBe(true)
    const privateChat = await supporter.send({
      action: "chat-read",
      channel: "squad",
    })
    expect(
      privateChat.data.messages.map((message: { body: string }) => message.body)
    ).toEqual(["Private plan"])
    expect(
      JSON.stringify((await supporter.send({ action: "chat-read" })).data)
    ).not.toContain("Private plan")
    const opponentSocial = await browser
      .timeout(2_000)
      .emitWithAck("room:join", {
        code,
        playerName: "Browser opponent",
        sessionId: "local-squad-browser",
      })
    expect(opponentSocial.ok).toBe(true)
    expect(opponentSocial.data.playerSocial.squadChatMessages).toEqual([])
    expect(
      (
        await host.send({
          action: "support-kick",
          supporterPlayerId: supporterId,
        })
      ).ok
    ).toBe(true)
    expect((await supporter.send({ action: "support-view" })).ok).toBe(false)
    expect(
      (
        await supporter.send({
          action: "support-join",
          supportedPlayerId: target,
        })
      ).error.code
    ).toBe("support-blocked")
    expect(
      (
        await supporter.send({
          action: "support-request",
          supportedPlayerId: target,
        })
      ).ok
    ).toBe(true)
    const requests = (await host.send({ action: "support-read" })).data
    expect(requests.incomingSupportRequests).toEqual([
      expect.objectContaining({
        supporterPlayerId: supporterId,
        supportedPlayerId: target,
      }),
    ])
    expect(
      (
        await host.send({
          action: "support-respond",
          supporterPlayerId: supporterId,
          approve: true,
        })
      ).ok
    ).toBe(true)
    expect((await supporter.send({ action: "support-view" })).ok).toBe(true)
    const afterRejoin = await supporter.send({
      action: "chat-read",
      channel: "squad",
    })
    expect(afterRejoin.data.messages).toEqual([
      expect.objectContaining({ body: "Private plan" }),
    ])
    expect(
      JSON.stringify((await supporter.send({ action: "status" })).data)
    ).not.toContain("Private plan")
  } finally {
    browser.disconnect()
  }
}, 30_000)

it("plays an entire local match alongside a browser-protocol player through real server handlers", async () => {
  const p = cli()
  const created = await p.send({ action: "create", name: "CLI host" })
  expect(created.ok).toBe(true)
  const code = created.data.room.code
  const selfId = created.data.playerId
  const browser = io(serverUrl, {
    transports: ["websocket"],
    autoConnect: false,
  })
  let publicRoom: RoomSnapshot | null = null
  let browserState: PlayerGameSnapshot | null = null
  browser.on("room:snapshot", (room) => {
    publicRoom = room
  })
  browser.on("game:playerState", (state) => {
    browserState = state
  })
  const connected = new Promise<void>((resolve) =>
    browser.once("connect", resolve)
  )
  browser.connect()
  await connected
  try {
    const joined = await browser.timeout(2_000).emitWithAck("room:join", {
      code,
      playerName: "Browser",
      sessionId: "local-e2e-browser",
    })
    expect(joined.ok).toBe(true)
    expect((await p.send({ action: "ready", ready: true })).ok).toBe(true)
    expect(
      (
        await browser
          .timeout(2_000)
          .emitWithAck("room:setReady", { ready: true })
      ).ok
    ).toBe(true)
    expect((await p.send({ action: "start" })).ok).toBe(true)
    let moves = 0
    for (; moves < 1_000; moves++) {
      const status = (await p.send({ action: "status" })).data
      const latestPublic = publicRoom as RoomSnapshot | null
      const room =
        latestPublic && latestPublic.version > status.room.version
          ? latestPublic
          : status.room
      if (room.status === "finished") break
      const actorId = room.game.lastGift?.playerId ?? room.game.turnPlayerId
      const isCli = actorId === selfId
      let own: PlayerGameSnapshot
      if (isCli) {
        if (!status.synchronized || status.room.version < room.version) continue
        own = status.self
      } else {
        await expect.poll(() => browserState?.roomVersion).toBe(room.version)
        own = browserState!
      }
      let command: Record<string, unknown>
      let event: string
      let input: Record<string, unknown> | undefined
      if (room.game.lastGift) {
        command = { action: "gift", giftId: room.game.lastGift.id }
        event = "game:resolveLastGift"
        input = { giftId: room.game.lastGift.id }
      } else if (room.game.pendingChoice) {
        command = { action: "resolve-roulette" }
        event = "game:drawRouletteCard"
      } else if (own.canTakeDrawPenalty) {
        command = { action: "penalty" }
        event = "game:takeDrawPenalty"
      } else {
        const playable = own.hand.find(
          (card) =>
            own.playableCardIds.includes(card.id) &&
            (own.hand.length > 1 ||
              card.face.kind === "number" ||
              card.face.kind === "discard-color")
        )
        if (playable) {
          const extras =
            playable.face.kind === "discard-color"
              ? own.hand
                  .filter(
                    (card) =>
                      card.id !== playable.id && card.color === playable.color
                  )
                  .map((card) => card.id)
              : []
          input = {
            cardIds: [playable.id],
            declaredUno: own.hand.length - 1 - extras.length === 1,
            ...(playable.color === "wild" ? { chosenColor: "red" } : {}),
            ...(extras.length ? { discardCardIds: extras } : {}),
          }
          command = { action: "play", ...input }
          event = "game:playCards"
        } else if (own.canDraw) {
          command = { action: "draw" }
          event = "game:drawOne"
        } else {
          expect(own.canEndTurn).toBe(true)
          command = { action: "pass" }
          event = "game:endTurn"
        }
      }
      if (isCli) {
        const result = await p.send(command)
        expect(result, JSON.stringify(command)).toMatchObject({ ok: true })
      } else {
        const result =
          input === undefined
            ? await browser.timeout(2_000).emitWithAck(event)
            : await browser.timeout(2_000).emitWithAck(event, input)
        expect(result, event).toMatchObject({ ok: true })
        await expect
          .poll(
            async () => (await p.send({ action: "status" })).data.room.version
          )
          .toBeGreaterThanOrEqual(result.data.version)
      }
    }
    expect(moves).toBeLessThan(1_000)
    const final = (await p.send({ action: "status" })).data
    expect(final.room.status).toBe("finished")
    expect(final.room.game.winnerPlacements.length).toBeGreaterThan(0)
    expect(
      p.messages.some(
        (message) => message.type === "state" && message.state.myTurn
      )
    ).toBe(true)
    await p.send({ action: "quit" })
  } finally {
    browser.disconnect()
  }
}, 45_000)

it("keeps quit responsive during a pending quiet wait and shuts the portable process down cleanly", async () => {
  const p = cli(["--create", "--name", "Waiting host"])
  const state = (await p.send({ action: "status" })).data
  await p.send({ action: "watch", enabled: false })
  const wait = p.send({
    action: "wait-for-action",
    afterVersion: state.room.version,
    timeoutMs: 60_000,
  })
  const exited = new Promise<number | null>((resolve) =>
    p.child.once("exit", resolve)
  )
  await p.send({ action: "quit" })
  expect(await wait).toMatchObject({ ok: true, data: { reasons: ["closed"] } })
  expect(await exited).toBe(0)
}, 20_000)

it("wakes a pending wait and exits on SIGTERM", async () => {
  const p = cli(["--create", "--name", "Signal host"])
  const state = (await p.send({ action: "status" })).data
  const wait = p.send({
    action: "wait-for-action",
    afterVersion: state.room.version,
  })
  await p.send({ action: "status" })
  const exited = new Promise<number | null>((resolve) =>
    p.child.once("exit", resolve)
  )
  p.child.kill("SIGTERM")
  expect(await wait).toMatchObject({ ok: true, data: { reasons: ["closed"] } })
  expect(await exited).toBe(0)
}, 20_000)

it("cancels a pending wait on stdin EOF and closes without waiting for its deadline", async () => {
  const p = cli(["--create", "--name", "EOF host"])
  const state = (await p.send({ action: "status" })).data
  const wait = p.send({
    action: "wait-for-action",
    afterVersion: state.room.version,
  })
  await p.send({ action: "status" })
  const exited = new Promise<number | null>((resolve) =>
    p.child.once("exit", resolve)
  )
  p.child.stdin!.end()
  expect(await wait).toMatchObject({
    ok: true,
    data: { reasons: ["cancelled"] },
  })
  expect(await exited).toBe(0)
}, 20_000)

it("round-trips public replies, reactions, mentions and typing through the real server with the portable CLI", async () => {
  const a = cli(["--create", "--name", "Host"])
  const initial = (await a.send({ action: "status" })).data
  const code = initial.room.code
  const ai = initial.playerId
  const b = cli(["--room", code, "--name", "Guest"])
  const bi = (await b.send({ action: "status" })).data.playerId
  expect((await a.send({ action: "chat-typing", typing: true })).ok).toBe(true)
  await expect
    .poll(() =>
      b.messages.some(
        (m) =>
          m.type === "chat-typing" &&
          m.players.some((p: any) => p.playerId === ai)
      )
    )
    .toBe(true)
  const sent = await a.send({
    action: "chat-send",
    body: "@Guest hello",
    mentionPlayerIds: [bi],
  })
  expect(sent.ok).toBe(true)
  const original = sent.data.state.room.chatMessages.at(-1)
  await expect
    .poll(
      () =>
        b.messages.filter(
          (m) =>
            m.type === "chat-message" &&
            m.message.id === original.id &&
            m.mentioned
        ).length
    )
    .toBe(1)
  expect((await b.send({ action: "chat-read" })).data.messages.at(-1).id).toBe(
    original.id
  )
  const reply = await b.send({
    action: "chat-send",
    body: "Reply",
    replyToMessageId: original.id,
  })
  expect(reply.ok).toBe(true)
  expect(reply.data.state.room.chatMessages.at(-1).replyToMessageId).toBe(
    original.id
  )
  const reaction = await a.send({
    action: "chat-react",
    messageId: original.id,
    emoji: "👍",
    active: true,
  })
  expect(reaction.ok).toBe(true)
  expect(
    reaction.data.state.room.chatMessages.find((m: any) => m.id === original.id)
      .reactions
  ).toEqual([{ emoji: "👍", playerIds: [ai] }])
  expect(
    (
      await a.send({ action: "chat-read", afterMessageId: original.id })
    ).data.messages.at(-1).body
  ).toBe("Reply")
  await b.send({ action: "resync" })
  expect(
    b.messages.filter(
      (m) => m.type === "chat-message" && m.message.id === original.id
    )
  ).toHaveLength(1)
  const other = cli(["--create", "--name", "Other room"])
  await other.send({ action: "status" })
  expect(
    (
      await other.send({
        action: "chat-react",
        messageId: original.id,
        emoji: "👍",
        active: true,
      })
    ).error.code
  ).toBe("message-not-found")
  expect(
    (
      await other.send({
        action: "chat-send",
        body: "Cross-room reply",
        replyToMessageId: original.id,
      })
    ).error.code
  ).toBe("reply-not-found")
  await a.send({ action: "quit" })
  await b.send({ action: "quit" })
  await other.send({ action: "quit" })
}, 30_000)
