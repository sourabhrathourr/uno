// @vitest-environment node
import { createServer } from "node:http"
import { once } from "node:events"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { io as connectClient } from "socket.io-client"
import { Server } from "../../../../apps/server/node_modules/socket.io"
import { RoomVoice } from "../../../../apps/server/src/room-voice"
import type { Socket as ClientSocket } from "socket.io-client"

let io: Server
let voice: RoomVoice
let base: string
let clients: Array<ClientSocket> = []

beforeEach(async () => {
  const http = createServer()
  io = new Server(http)
  voice = new RoomVoice(io)
  io.on("connection", (socket) => {
    voice.attach(socket)
    socket.on("test:join", (roomCode, playerId, ack) => {
      voice.release(socket)
      socket.data = { roomCode, playerId }
      socket.join(roomCode)
      ack()
    })
    socket.on("test:barrier", (ack) => ack())
  })
  http.listen(0, "127.0.0.1")
  await once(http, "listening")
  const address = http.address()
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
})
afterEach(async () => {
  for (const client of clients) client.disconnect()
  clients = []
  await new Promise<void>((resolve) => io.close(() => resolve()))
})
async function tab(playerId?: string, room = "room") {
  const client = connectClient(base, {
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
  })
  clients.push(client)
  const ready = new Promise<void>((resolve) =>
    client.once("connect", () => resolve())
  )
  client.connect()
  await ready
  if (playerId)
    await client.timeout(1_000).emitWithAck("test:join", room, playerId)
  return client
}
async function claim(client: ClientSocket) {
  return client.timeout(1_000).emitWithAck("voice:join")
}
async function barrier(client: ClientSocket) {
  await client.timeout(1_000).emitWithAck("test:barrier")
}

describe("voice ownership and routing", () => {
  it("requires a room join before accepting voice", async () => {
    const client = await tab()
    expect((await claim(client)).error.code).toBe("not-joined")
  })

  it("allows only one tab per seat to own voice and receive offers", async () => {
    const sender = await tab("a")
    const first = await tab("b")
    const second = await tab("b")
    await claim(sender)
    const owner = await claim(first)
    expect(owner.ok).toBe(true)
    expect((await claim(second)).error.code).toBe("voice-in-another-tab")
    const duplicate: Array<unknown> = []
    second.on("voice:signal", (e) => duplicate.push(e))
    const signal = new Promise<any>((resolve) =>
      first.once("voice:signal", resolve)
    )
    sender.emit("voice:signal", {
      targetPlayerId: "b",
      targetSessionId: owner.data.sessionId,
      signal: { type: "offer", sdp: "test", exchangeId: "exchange" },
    })
    const received = await signal
    expect(received.targetSessionId).toBe(owner.data.sessionId)
    expect(received.signal.exchangeId).toBe("exchange")
    await barrier(second)
    expect(duplicate).toEqual([])
  })

  it("rejects state changes and signals from a non-owner tab", async () => {
    const owner = await tab("a")
    const duplicate = await tab("a")
    const target = await tab("b")
    await claim(owner)
    await claim(target)
    owner.emit("voice:setState", {
      enabled: true,
      muted: false,
      speaking: true,
    })
    await barrier(owner)
    const denied = new Promise<void>((resolve) =>
      duplicate.once("voice:unavailable", () => resolve())
    )
    duplicate.emit("voice:setState", {
      enabled: true,
      muted: true,
      speaking: false,
    })
    await denied
    duplicate.emit("voice:setState", {
      enabled: false,
      muted: true,
      speaking: false,
    })
    const received: Array<unknown> = []
    target.on("voice:signal", (e) => received.push(e))
    duplicate.emit("voice:signal", {
      targetPlayerId: "b",
      signal: { type: "answer", sdp: "wrong-tab" },
    })
    await barrier(duplicate)
    await barrier(target)
    expect(
      voice.states("room").find((state) => state.playerId === "a")?.muted
    ).toBe(false)
    expect(received).toEqual([])
  })

  it("releases the owner's voice even when another game tab remains connected", async () => {
    const owner = await tab("a")
    const other = await tab("a")
    await claim(owner)
    const ended = new Promise<{ enabled: boolean }>((resolve) => {
      const handler = (state: { enabled: boolean }) => {
        if (!state.enabled) {
          other.off("voice:state", handler)
          resolve(state)
        }
      }
      other.on("voice:state", handler)
    })
    owner.disconnect()
    expect((await ended).enabled).toBe(false)
    expect((await claim(other)).ok).toBe(true)
  })

  it("rejects a signal addressed to an old voice session", async () => {
    const sender = await tab("a")
    const target = await tab("b")
    await claim(sender)
    const old = await claim(target)
    target.emit("voice:setState", {
      enabled: false,
      muted: true,
      speaking: false,
    })
    await barrier(target)
    const current = await claim(target)
    expect(current.data.sessionId).not.toBe(old.data.sessionId)
    const received: Array<unknown> = []
    target.on("voice:signal", (e) => received.push(e))
    sender.emit("voice:signal", {
      targetPlayerId: "b",
      targetSessionId: old.data.sessionId,
      signal: { type: "offer", sdp: "stale" },
    })
    await barrier(sender)
    await barrier(target)
    expect(received).toEqual([])
  })

  it("does not let an abandoned join release a newer session", async () => {
    const client = await tab("a")
    const old = await claim(client)
    const current = await claim(client)
    client.emit("voice:setState", {
      enabled: false,
      muted: true,
      speaking: false,
      voiceSessionId: old.data.sessionId,
    })
    await barrier(client)
    expect(voice.states("room")[0].voiceSessionId).toBe(current.data.sessionId)
  })

  it("releases ownership when changing rooms and isolates targets by room", async () => {
    const client = await tab("a")
    const target = await tab("b")
    await claim(client)
    await claim(target)
    await client.timeout(1_000).emitWithAck("test:join", "another-room", "a")
    await claim(client)
    expect(voice.states("room").map((state) => state.playerId)).toEqual(["b"])
    const received: Array<unknown> = []
    target.on("voice:signal", (e) => received.push(e))
    client.emit("voice:signal", {
      targetPlayerId: "b",
      signal: { type: "offer", sdp: "wrong-room" },
    })
    await barrier(client)
    await barrier(target)
    expect(received).toEqual([])
  })
  it("ends voice ownership when the room expires", async () => {
    const client = await tab("a")
    await claim(client)
    const expired = new Promise<{ code: string }>((resolve) =>
      client.once("voice:unavailable", resolve)
    )
    voice.clearRoom("room")
    expect((await expired).code).toBe("room-expired")
    expect(voice.states("room")).toEqual([])
  })
})
