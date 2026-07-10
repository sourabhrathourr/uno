import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"

import { Server, type Socket } from "socket.io"

import type {
  ClientToServerEvents,
  CreateRoomRequest,
  InterServerEvents,
  RoomSnapshot,
  ServerToClientEvents,
  SocketData,
  VoiceSignal,
} from "@workspace/game"

import { RoomManager } from "./room-manager"

type IceServerConfig = {
  urls: string | string[]
  username?: string
  credential?: string
  credentialType?: "password" | "oauth"
}

const port = Number.parseInt(process.env.PORT ?? "4001", 10)
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
const voiceDebugEnabled =
  process.env.VOICE_DEBUG === "1" || process.env.VOICE_DEBUG === "true"
const voiceIceServers = getConfiguredIceServers()

const rooms = new RoomManager()
const voiceStatesByRoomCode = new Map<
  string,
  Map<string, { enabled: boolean; muted: boolean; speaking: boolean }>
>()

const httpServer = createServer(async (req, res) => {
  setCorsHeaders(req, res)

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`
  )

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(req, res, 200, { ok: true })
    return
  }

  if (req.method === "GET" && url.pathname === "/voice/ice-servers") {
    sendJson(req, res, 200, { iceServers: voiceIceServers })
    return
  }

  const roomMatch = url.pathname.match(/^\/rooms\/([A-Za-z0-9]{6})$/)
  if (req.method === "GET" && roomMatch) {
    const result = rooms.getRoom(roomMatch[1] ?? "")
    sendJson(req, res, result.ok ? 200 : 404, result)
    return
  }

  if (req.method === "POST" && url.pathname === "/rooms") {
    const body = await readJson<CreateRoomRequest>(req)
    if (!body.ok) {
      sendJson(req, res, 400, {
        ok: false,
        error: {
          code: "invalid-json",
          message: "Request body must be valid JSON.",
        },
      })
      return
    }

    const result = rooms.createRoom(body.data)
    sendJson(req, res, result.ok ? 201 : 400, result)
    return
  }

  sendJson(req, res, 404, {
    ok: false,
    error: { code: "not-found", message: "Route not found." },
  })
})

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
})

io.on("connection", (socket) => {
  socket.on("room:join", (input, ack) => {
    const result = rooms.joinRoom(input)
    if (!result.ok) {
      ack(result)
      return
    }

    const previousRoomCode = socket.data.roomCode
    const previousPlayerId = socket.data.playerId
    const changedSeat =
      previousRoomCode &&
      previousPlayerId &&
      (previousRoomCode !== result.data.room.code ||
        previousPlayerId !== result.data.player.id)

    if (changedSeat) {
      const previousSnapshot = rooms.unregisterConnection(
        previousRoomCode,
        previousPlayerId,
        socket.id
      )
      if (previousRoomCode !== result.data.room.code)
        socket.leave(previousRoomCode)
      if (previousSnapshot)
        void emitRoomState(previousRoomCode, previousSnapshot)
    }

    socket.data.roomCode = result.data.room.code
    socket.data.playerId = result.data.player.id
    socket.data.sessionId = input.sessionId
    socket.join(result.data.room.code)

    const snapshot = rooms.registerConnection(
      result.data.room.code,
      result.data.player.id,
      socket.id
    )

    const room = snapshot ?? result.data.room
    const playerGame = rooms.getPlayerGame(room.code, result.data.player.id)
    const playerSocial = rooms.getPlayerSocial(room.code, result.data.player.id)
    emitVoiceStates(socket, room.code)
    ack({
      ok: true,
      data: {
        room,
        player: result.data.player,
        isNewPlayer: result.data.isNewPlayer,
        playerGame,
        playerSocial,
      },
    })
    void emitRoomState(room.code, room)

    if (result.data.isNewPlayer) {
      io.to(room.code).emit("room:event", {
        type: "player-joined",
        playerId: result.data.player.id,
        playerName: result.data.player.name,
      })
    }
  })

  socket.on("room:setReady", (input, ack) => {
    const roomCode = socket.data.roomCode
    const playerId = socket.data.playerId
    if (!roomCode || !playerId) {
      ack({
        ok: false,
        error: {
          code: "not-joined",
          message: "Join a room before changing readiness.",
        },
      })
      return
    }

    const result = rooms.setReady(roomCode, playerId, input.ready)
    ack(result)
    if (result.ok) {
      void emitRoomState(roomCode, result.data)
      io.to(roomCode).emit("room:event", {
        type: "player-ready-changed",
        playerId,
        ready: input.ready,
      })
    }
  })

  socket.on("room:start", (ack) => {
    const roomCode = socket.data.roomCode
    const playerId = socket.data.playerId
    if (!roomCode || !playerId) {
      ack({
        ok: false,
        error: { code: "not-joined", message: "Join a room before starting." },
      })
      return
    }

    const result = rooms.startRoom(roomCode, playerId)
    ack(result)
    if (result.ok) {
      void emitRoomState(roomCode, result.data)
      io.to(roomCode).emit("room:event", { type: "room-started" })
    }
  })

  socket.on("room:restart", (ack) => {
    const roomCode = socket.data.roomCode
    const playerId = socket.data.playerId
    if (!roomCode || !playerId) {
      ack({
        ok: false,
        error: {
          code: "not-joined",
          message: "Join a room before restarting.",
        },
      })
      return
    }

    const result = rooms.restartRoom(roomCode, playerId)
    ack(result)
    if (result.ok) {
      void emitRoomState(roomCode, result.data)
      io.to(roomCode).emit("room:event", { type: "room-restarted" })
    }
  })

  socket.on("room:sendChatMessage", (input, ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.sendChatMessage(roomCode, playerId, input)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("voice:requestStates", () => {
    const roomCode = socket.data.roomCode
    if (!roomCode) return
    logVoiceDebug("states requested", {
      roomCode,
      socketId: socket.id,
      playerId: socket.data.playerId,
    })
    emitVoiceStates(socket, roomCode)
  })

  socket.on("voice:setState", (input) => {
    const roomCode = socket.data.roomCode
    const playerId = socket.data.playerId
    if (!roomCode || !playerId) return

    const enabled = Boolean(input.enabled)
    const muted = Boolean(input.muted)
    const speaking = Boolean(enabled && !muted && input.speaking)
    writeVoiceState(roomCode, playerId, { enabled, muted, speaking })
    logVoiceDebug("state broadcast", {
      roomCode,
      playerId,
      enabled,
      muted,
      speaking,
    })
    io.to(roomCode).emit("voice:state", { playerId, enabled, muted, speaking })
  })

  socket.on("voice:signal", (input) => {
    const roomCode = socket.data.roomCode
    const playerId = socket.data.playerId
    if (!roomCode || !playerId) return
    if (!input.targetPlayerId || input.targetPlayerId === playerId) return

    logVoiceDebug("signal relayed", {
      roomCode,
      fromPlayerId: playerId,
      targetPlayerId: input.targetPlayerId,
      signal: describeVoiceSignal(input.signal),
    })
    io.to(roomCode).emit("voice:signal", {
      fromPlayerId: playerId,
      targetPlayerId: input.targetPlayerId,
      signal: input.signal,
    })
  })

  socket.on("game:playCards", (input, ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.playCards(roomCode, playerId, input)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:stageCards", (input, ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.stageCards(roomCode, playerId, input)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:drawOne", (ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.drawOne(roomCode, playerId)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:endTurn", (ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.endTurn(roomCode, playerId)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:takeDrawPenalty", (ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.takeDrawPenalty(roomCode, playerId)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:drawRouletteCard", (ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.drawRouletteCard(roomCode, playerId)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:catchUno", (input, ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.catchUno(roomCode, playerId, input)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:supportPlayer", (input, ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.supportPlayer(roomCode, playerId, input.supportedPlayerId)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:kickSupporter", (input, ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.kickSupporter(roomCode, playerId, input.supporterPlayerId)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:sendReaction", (input, ack) => {
    const result = withJoinedPlayer(socket.data, (roomCode, playerId) =>
      rooms.sendTableReaction(roomCode, playerId, input)
    )
    ack(result)
    if (result.ok) void emitRoomState(result.data.code, result.data)
  })

  socket.on("game:getSupportView", (ack) => {
    const roomCode = socket.data.roomCode
    const playerId = socket.data.playerId
    if (!roomCode || !playerId) {
      ack({
        ok: false,
        error: { code: "not-joined", message: "Join a room first." },
      })
      return
    }
    ack({ ok: true, data: rooms.getSupportView(roomCode, playerId) })
  })

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode
    const playerId = socket.data.playerId
    if (!roomCode || !playerId) return

    const snapshot = rooms.unregisterConnection(roomCode, playerId, socket.id)
    if (snapshot) {
      const playerSnapshot = snapshot.players.find(
        (candidate) => candidate.id === playerId
      )
      if (!playerSnapshot?.connected) {
        writeVoiceState(roomCode, playerId, {
          enabled: false,
          muted: true,
          speaking: false,
        })
        io.to(roomCode).emit("voice:state", {
          playerId,
          enabled: false,
          muted: true,
          speaking: false,
        })
      }
      void emitRoomState(roomCode, snapshot)
    }
  })
})

httpServer.listen(port, () => {
  console.log(`UNO No Mercy server listening on http://localhost:${port}`)
})

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  const allowedOrigin =
    origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]

  res.setHeader(
    "Access-Control-Allow-Origin",
    allowedOrigin ?? "http://localhost:3000"
  )
  res.setHeader("Vary", "Origin")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  data: unknown
) {
  setCorsHeaders(req, res)
  res.writeHead(statusCode, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

async function readJson<T>(req: IncomingMessage): Promise<
  | {
      ok: true
      data: T
    }
  | {
      ok: false
    }
> {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const raw = Buffer.concat(chunks).toString("utf8")
    return {
      ok: true,
      data: raw ? (JSON.parse(raw) as T) : ({} as T),
    }
  } catch {
    return { ok: false }
  }
}

async function emitRoomState(roomCode: string, room?: RoomSnapshot) {
  const snapshot = room ?? rooms.getRoom(roomCode)
  if ("ok" in snapshot && !snapshot.ok) return

  const roomSnapshot = "ok" in snapshot ? snapshot.data : snapshot
  io.to(roomCode).emit("room:snapshot", roomSnapshot)

  const sockets = await io.in(roomCode).fetchSockets()
  for (const client of sockets) {
    const playerId = client.data.playerId
    if (!playerId) continue

    const playerGame = rooms.getPlayerGame(roomCode, playerId)
    if (playerGame) client.emit("game:playerState", playerGame)
    const playerSocial = rooms.getPlayerSocial(roomCode, playerId)
    if (playerSocial) client.emit("room:playerSocial", playerSocial)
  }
}

function emitVoiceStates(
  socket: Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >,
  roomCode: string
) {
  const roomVoiceStates = voiceStatesByRoomCode.get(roomCode)
  if (!roomVoiceStates) return

  for (const [playerId, state] of roomVoiceStates) {
    socket.emit("voice:state", { playerId, ...state })
  }
}

function writeVoiceState(
  roomCode: string,
  playerId: string,
  state: { enabled: boolean; muted: boolean; speaking: boolean }
) {
  const roomVoiceStates = voiceStatesByRoomCode.get(roomCode) ?? new Map()

  if (!state.enabled) {
    roomVoiceStates.delete(playerId)
  } else {
    roomVoiceStates.set(playerId, state)
  }

  if (roomVoiceStates.size === 0) {
    voiceStatesByRoomCode.delete(roomCode)
  } else {
    voiceStatesByRoomCode.set(roomCode, roomVoiceStates)
  }
}

function logVoiceDebug(event: string, details: Record<string, unknown>) {
  if (!voiceDebugEnabled) return
  console.log(`[uno voice] ${event}`, details)
}

function describeVoiceSignal(signal: VoiceSignal) {
  if (signal.type === "offer" || signal.type === "answer") {
    return { type: signal.type, sdpLength: signal.sdp.length }
  }

  if (signal.type === "leave") {
    return { type: signal.type }
  }

  return {
    type: signal.type,
    candidate: describeVoiceCandidate(signal.candidate),
  }
}

function describeVoiceCandidate(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return null

  const candidateValue =
    "candidate" in candidate && typeof candidate.candidate === "string"
      ? candidate.candidate
      : ""

  return {
    type: candidateValue.match(/ typ ([a-z]+)/i)?.[1] ?? "unknown",
    protocol:
      candidateValue.match(/ (udp|tcp) /i)?.[1]?.toLowerCase() ?? "unknown",
  }
}

function getConfiguredIceServers(): IceServerConfig[] {
  const rawServers = (
    process.env.RTC_ICE_SERVERS ?? process.env.VITE_RTC_ICE_SERVERS
  )?.trim()
  if (rawServers) {
    try {
      const parsedServers = normalizeIceServers(JSON.parse(rawServers))
      if (parsedServers.length > 0) return parsedServers
    } catch (cause) {
      console.error("Invalid RTC_ICE_SERVERS value", cause)
    }
  }

  const meteredUsername = process.env.METERED_TURN_USERNAME?.trim()
  const meteredCredential = process.env.METERED_TURN_CREDENTIAL?.trim()
  if (meteredUsername && meteredCredential) {
    const host = (
      process.env.METERED_TURN_HOST ?? "global.relay.metered.ca"
    ).trim()
    return [
      { urls: "stun:stun.relay.metered.ca:80" },
      {
        urls: `turn:${host}:80`,
        username: meteredUsername,
        credential: meteredCredential,
      },
      {
        urls: `turn:${host}:80?transport=tcp`,
        username: meteredUsername,
        credential: meteredCredential,
      },
      {
        urls: `turn:${host}:443`,
        username: meteredUsername,
        credential: meteredCredential,
      },
      {
        urls: `turns:${host}:443?transport=tcp`,
        username: meteredUsername,
        credential: meteredCredential,
      },
    ]
  }

  return [{ urls: "stun:stun.l.google.com:19302" }]
}

function normalizeIceServers(value: unknown): IceServerConfig[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((server) => {
    if (!server || typeof server !== "object" || !("urls" in server)) return []

    const urls = server.urls
    const normalizedUrls =
      typeof urls === "string"
        ? urls
        : Array.isArray(urls) && urls.every((url) => typeof url === "string")
          ? urls
          : null
    if (!normalizedUrls) return []

    const username =
      "username" in server && typeof server.username === "string"
        ? server.username
        : undefined
    const credential =
      "credential" in server && typeof server.credential === "string"
        ? server.credential
        : undefined
    const credentialType =
      "credentialType" in server &&
      (server.credentialType === "password" ||
        server.credentialType === "oauth")
        ? server.credentialType
        : undefined

    return [{ urls: normalizedUrls, username, credential, credentialType }]
  })
}

function withJoinedPlayer<T>(
  data: SocketData,
  command: (roomCode: string, playerId: string) => T
): T | { ok: false; error: { code: string; message: string } } {
  const roomCode = data.roomCode
  const playerId = data.playerId
  if (!roomCode || !playerId) {
    return {
      ok: false,
      error: { code: "not-joined", message: "Join a room first." },
    }
  }

  return command(roomCode, playerId)
}
