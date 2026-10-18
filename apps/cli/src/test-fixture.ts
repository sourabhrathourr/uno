// Local test infrastructure only. Seeded hands never come from a live room.
import { createServer } from "node:http"
import { once } from "node:events"
import { Server } from "socket.io"
import { io as connectBrowser } from "socket.io-client"
import type {
  Card,
  CommandResult,
  GameState,
  RoomSnapshot,
} from "@workspace/game"
import { RoomManager } from "../../server/src/room-manager"
import { registerPartyHandlers } from "../../server/src/party-handlers"
import { UnoClient } from "./client"

export async function fixture() {
  const manager = new RoomManager({
    onRoomUpdated: (code, room) => publish(code, room),
  })
  const http = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const result = manager.createRoom(
      JSON.parse(Buffer.concat(chunks).toString())
    )
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(result))
  })
  const io = new Server(http)
  const clients: UnoClient[] = []
  const browsers: ReturnType<typeof connectBrowser>[] = []
  const received: string[] = []
  const controls = {
    dropAckFor: "",
    delayAckMs: 0,
    holdPrivate: false,
    disconnectFor: "",
  }

  function publish(code: string, room?: RoomSnapshot) {
    const result = manager.getRoom(code)
    if (!room && !result.ok) throw new Error("Missing test room")
    const snapshot = room ?? (result as { ok: true; data: RoomSnapshot }).data
    io.to(code).emit("room:snapshot", snapshot)
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.roomCode !== code) continue
      const state = manager.getPlayerGame(code, socket.data.playerId)
      if (state && !controls.holdPrivate) socket.emit("game:playerState", state)
    }
  }
  io.on("connection", (socket) => {
    socket.onAny((event) => received.push(event))
    socket.on("room:join", (input, ack) => {
      const joined = manager.joinRoom(input)
      if (!joined.ok) {
        ack(joined)
        return
      }
      const { code } = joined.data.room
      socket.data.roomCode = code
      socket.data.playerId = joined.data.player.id
      socket.join(code)
      const room =
        manager.registerConnection(code, joined.data.player.id, socket.id) ??
        joined.data.room
      if (controls.dropAckFor !== "room:join")
        ack({
          ok: true,
          data: {
            ...joined.data,
            room,
            playerGame: manager.getPlayerGame(code, joined.data.player.id),
          },
        })
      publish(code, room)
    })
    function run(
      event: string,
      command: (code: string, id: string) => CommandResult<RoomSnapshot>,
      ack: (result: CommandResult<RoomSnapshot>) => void
    ) {
      const result = command(socket.data.roomCode, socket.data.playerId)
      if (controls.dropAckFor !== event) {
        if (controls.delayAckMs)
          setTimeout(() => ack(result), controls.delayAckMs)
        else ack(result)
      }
      if (result.ok) publish(result.data.code, result.data)
      if (controls.disconnectFor === event) socket.conn.close()
    }
    socket.on("room:setReady", (input, ack) =>
      run(
        "room:setReady",
        (code, id) => manager.setReady(code, id, input.ready),
        ack
      )
    )
    socket.on("room:start", (ack) =>
      run("room:start", (code, id) => manager.startRoom(code, id), ack)
    )
    socket.on("room:restart", (ack) =>
      run("room:restart", (code, id) => manager.restartRoom(code, id), ack)
    )
    socket.on("game:playCards", (input, ack) =>
      run(
        "game:playCards",
        (code, id) => manager.playCards(code, id, input),
        ack
      )
    )
    socket.on("game:stageCards", (input, ack) =>
      run(
        "game:stageCards",
        (code, id) => manager.stageCards(code, id, input),
        ack
      )
    )
    socket.on("game:drawOne", (ack) =>
      run("game:drawOne", (code, id) => manager.drawOne(code, id), ack)
    )
    socket.on("game:endTurn", (ack) =>
      run("game:endTurn", (code, id) => manager.endTurn(code, id), ack)
    )
    socket.on("game:takeDrawPenalty", (ack) =>
      run(
        "game:takeDrawPenalty",
        (code, id) => manager.takeDrawPenalty(code, id),
        ack
      )
    )
    socket.on("game:drawRouletteCard", (ack) =>
      run(
        "game:drawRouletteCard",
        (code, id) => manager.drawRouletteCard(code, id),
        ack
      )
    )
    socket.on("game:catchUno", (input, ack) =>
      run("game:catchUno", (code, id) => manager.catchUno(code, id, input), ack)
    )
    registerPartyHandlers(socket, manager, publish)
    socket.on("disconnect", () => {
      const room = manager.unregisterConnection(
        socket.data.roomCode,
        socket.data.playerId,
        socket.id
      )
      if (room) publish(room.code, room)
    })
  })
  http.listen(0, "127.0.0.1")
  await once(http, "listening")
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  function client(timeoutMs = 1_000) {
    const next = new UnoClient({ serverUrl: url, timeoutMs, proxyEnv: {} })
    clients.push(next)
    return next
  }
  async function browser(code: string) {
    const socket = connectBrowser(url, {
      transports: ["websocket"],
      autoConnect: false,
    })
    browsers.push(socket)
    const connected = new Promise<void>((resolve) =>
      socket.once("connect", resolve)
    )
    socket.connect()
    await connected
    const result = await socket.timeout(1_000).emitWithAck("room:join", {
      code,
      playerName: "Browser",
      sessionId: `test-browser-${browsers.length}`,
    })
    return { socket, playerId: result.data.player.id as string }
  }
  function game(code: string) {
    return (
      manager as unknown as { rooms: Map<string, { gameState: GameState }> }
    ).rooms.get(code)!.gameState
  }
  return {
    url,
    manager,
    io,
    controls,
    received,
    client,
    browser,
    publish,
    game,
    bumpVersion(code: string) {
      const room = (
        manager as unknown as { rooms: Map<string, { version: number }> }
      ).rooms.get(code)!
      room.version++
      publish(code)
    },
    async close() {
      clients.forEach((client) => client.close())
      browsers.forEach((socket) => socket.disconnect())
      await new Promise<void>((resolve) => io.close(() => resolve()))
    },
  }
}

export const card = (
  id: string,
  color: Card["color"] = "red",
  face: Card["face"] = { kind: "number", value: 5 }
): Card => ({ id, color, face })

export function seed(
  game: GameState,
  hands: Record<string, Card[]>,
  turn: string
) {
  game.handsByPlayerId = hands
  game.turnPlayerId = turn
  game.currentColor = "red"
  game.discardPile = [card("table-red", "red", { kind: "number", value: 9 })]
  game.drawPile = Array.from({ length: 100 }, (_, i) =>
    card(`deck-${i}`, "yellow", { kind: "number", value: 8 })
  )
  game.drawStack = null
  game.drawnThisTurnPlayerId = null
  game.pendingChoice = null
  game.stagedPlay = null
}
