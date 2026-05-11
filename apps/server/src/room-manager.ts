import { randomBytes, randomUUID } from "node:crypto"

import {
  ROOM_CODE_LENGTH,
  CHAT_EMOJIS,
  CHAT_GIFS,
  CHAT_PRESETS,
  catchUno,
  createDefaultHouseRules,
  createGame,
  drawRouletteCard,
  drawOne,
  endTurn,
  normalizeRoomCode,
  playCards,
  projectPlayerGame,
  projectPublicGame,
  stageCards,
  takeDrawPenalty,
  type CatchUnoInput,
  type ChatMessage,
  type CommandResult,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type GameState,
  type HouseRules,
  type JoinRoomInput,
  type Player,
  type PlayerGameSnapshot,
  type PlayCardsInput,
  type RoomSnapshot,
  type SendChatMessageInput,
  type StageCardsInput,
} from "@workspace/game"

type ManagedRoom = RoomSnapshot & {
  gameState: GameState | null
  sessionToPlayerId: Map<string, string>
  connectionIdsByPlayerId: Map<string, Set<string>>
  lastChatAtByPlayerId: Map<string, number>
}

type JoinRoomResult = {
  room: RoomSnapshot
  player: Player
  isNewPlayer: boolean
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CHAT_HISTORY_LIMIT = 50
const CHAT_RATE_LIMIT_MS = 650

export class RoomManager {
  private readonly rooms = new Map<string, ManagedRoom>()

  createRoom(input: CreateRoomRequest): CommandResult<CreateRoomResponse> {
    const playerName = cleanPlayerName(input.playerName)
    if (!playerName) {
      return fail("invalid-player-name", "Enter a player name to create a room.")
    }

    const sessionId = cleanSessionId(input.sessionId)
    if (!sessionId) {
      return fail("invalid-session", "Missing player session.")
    }

    const code = this.createUniqueCode()
    const now = new Date().toISOString()
    const houseRules = mergeHouseRules(input.houseRules)
    const host = createPlayer({
      name: playerName,
      seat: 1,
      connected: true,
      now,
    })

    const room: ManagedRoom = {
      code,
      status: "lobby",
      hostPlayerId: host.id,
      players: [host],
      chatMessages: [],
      houseRules,
      game: null,
      gameState: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      sessionToPlayerId: new Map([[sessionId, host.id]]),
      connectionIdsByPlayerId: new Map(),
      lastChatAtByPlayerId: new Map(),
    }

    this.rooms.set(code, room)

    return ok({
      room: snapshot(room),
      player: host,
    })
  }

  getRoom(code: string): CommandResult<RoomSnapshot> {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    return ok(snapshot(room))
  }

  joinRoom(input: JoinRoomInput): CommandResult<JoinRoomResult> {
    const code = normalizeRoomCode(input.code)
    const room = this.rooms.get(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    const playerName = cleanPlayerName(input.playerName)
    if (!playerName) {
      return fail("invalid-player-name", "Enter a player name to join the room.")
    }

    const sessionId = cleanSessionId(input.sessionId)
    if (!sessionId) {
      return fail("invalid-session", "Missing player session.")
    }

    const existingPlayerId = room.sessionToPlayerId.get(sessionId)
    if (existingPlayerId) {
      const player = room.players.find((candidate) => candidate.id === existingPlayerId)
      if (!player) {
        return fail("player-not-found", "Your seat could not be restored.")
      }

      const now = new Date().toISOString()
      player.name = playerName
      player.connected = true
      player.lastSeenAt = now
      touch(room, now)

      return ok({
        room: snapshot(room),
        player,
        isNewPlayer: false,
      })
    }

    if (room.status !== "lobby") {
      return fail("room-in-progress", "This game has already started.")
    }

    if (room.players.length >= room.houseRules.maxPlayers) {
      return fail("room-full", "This room is full.")
    }

    const now = new Date().toISOString()
    const player = createPlayer({
      name: playerName,
      seat: nextSeat(room),
      connected: true,
      now,
    })

    room.players.push(player)
    room.sessionToPlayerId.set(sessionId, player.id)
    touch(room, now)

    return ok({
      room: snapshot(room),
      player,
      isNewPlayer: true,
    })
  }

  setReady(
    code: string,
    playerId: string,
    ready: boolean,
  ): CommandResult<RoomSnapshot> {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    if (room.status !== "lobby") {
      return fail("room-not-lobby", "Readiness can only change before the game starts.")
    }

    const player = findPlayer(room, playerId)
    if (!player) {
      return fail("player-not-found", "You are not seated in this room.")
    }

    player.ready = ready
    player.lastSeenAt = new Date().toISOString()
    touch(room, player.lastSeenAt)

    return ok(snapshot(room))
  }

  startRoom(code: string, playerId: string): CommandResult<RoomSnapshot> {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    if (room.status !== "lobby") {
      return fail("room-not-lobby", "This room has already started.")
    }

    if (room.hostPlayerId !== playerId) {
      return fail("host-only", "Only the host can start the game.")
    }

    if (room.players.length < 2) {
      return fail("not-enough-players", "At least two players are needed to start.")
    }

    const everyoneReady = room.players.every(
      (player) => player.id === room.hostPlayerId || player.ready,
    )
    if (!everyoneReady) {
      return fail("players-not-ready", "Every non-host player must be ready.")
    }

    room.status = "playing"
    room.gameState = createGame({ players: room.players, houseRules: room.houseRules })
    touch(room)

    return ok(snapshot(room))
  }

  sendChatMessage(
    code: string,
    playerId: string,
    input: SendChatMessageInput,
  ): CommandResult<RoomSnapshot> {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    const player = findPlayer(room, playerId)
    if (!player) {
      return fail("player-not-found", "You are not seated in this room.")
    }

    const nowMs = Date.now()
    const lastSentAt = room.lastChatAtByPlayerId.get(playerId) ?? 0
    if (nowMs - lastSentAt < CHAT_RATE_LIMIT_MS) {
      return fail("chat-too-fast", "Give the table a beat before sending again.")
    }

    const prepared = prepareChatMessage(input)
    if (!prepared.ok) return prepared

    const now = new Date(nowMs).toISOString()
    const message: ChatMessage = {
      id: randomUUID(),
      playerId,
      playerName: player.name,
      kind: input.kind,
      body: prepared.data.body,
      label: prepared.data.label,
      createdAt: now,
    }

    room.chatMessages = [...room.chatMessages, message].slice(-CHAT_HISTORY_LIMIT)
    room.lastChatAtByPlayerId.set(playerId, nowMs)
    touch(room, now)

    return ok(snapshot(room))
  }

  playCards(
    code: string,
    playerId: string,
    input: PlayCardsInput,
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState) return fail("game-not-started", "Start the game first.")
      const result = playCards(room.gameState, gameContext(room), playerId, input)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  stageCards(
    code: string,
    playerId: string,
    input: StageCardsInput,
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState) return fail("game-not-started", "Start the game first.")
      const result = stageCards(room.gameState, gameContext(room), playerId, input)
      if (!result.ok) return result
      touch(room)
      return ok(snapshot(room))
    })
  }

  drawOne(code: string, playerId: string): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState) return fail("game-not-started", "Start the game first.")
      const result = drawOne(room.gameState, gameContext(room), playerId)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  endTurn(code: string, playerId: string): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState) return fail("game-not-started", "Start the game first.")
      const result = endTurn(room.gameState, gameContext(room), playerId)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  takeDrawPenalty(code: string, playerId: string): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState) return fail("game-not-started", "Start the game first.")
      const result = takeDrawPenalty(room.gameState, gameContext(room), playerId)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  drawRouletteCard(code: string, playerId: string): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState) return fail("game-not-started", "Start the game first.")
      const result = drawRouletteCard(room.gameState, gameContext(room), playerId)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  catchUno(
    code: string,
    playerId: string,
    input: CatchUnoInput,
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState) return fail("game-not-started", "Start the game first.")
      const result = catchUno(room.gameState, gameContext(room), playerId, input)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  getPlayerGame(code: string, playerId: string): PlayerGameSnapshot | null {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room?.gameState) return null
    if (!findPlayer(room, playerId)) return null
    return projectPlayerGame(room.gameState, gameContext(room), playerId)
  }

  registerConnection(code: string, playerId: string, socketId: string): RoomSnapshot | null {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room || !findPlayer(room, playerId)) return null

    const connectionIds = room.connectionIdsByPlayerId.get(playerId) ?? new Set<string>()
    connectionIds.add(socketId)
    room.connectionIdsByPlayerId.set(playerId, connectionIds)

    const player = findPlayer(room, playerId)
    if (player && !player.connected) {
      player.connected = true
      player.lastSeenAt = new Date().toISOString()
      touch(room, player.lastSeenAt)
    }

    return snapshot(room)
  }

  unregisterConnection(
    code: string,
    playerId: string,
    socketId: string,
  ): RoomSnapshot | null {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room) return null

    const connectionIds = room.connectionIdsByPlayerId.get(playerId)
    if (!connectionIds) return snapshot(room)

    connectionIds.delete(socketId)
    if (connectionIds.size > 0) return snapshot(room)

    room.connectionIdsByPlayerId.delete(playerId)

    const player = findPlayer(room, playerId)
    if (player) {
      player.connected = false
      player.lastSeenAt = new Date().toISOString()
      touch(room, player.lastSeenAt)
    }

    return snapshot(room)
  }

  private createUniqueCode(): string {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const code = createRoomCode()
      if (!this.rooms.has(code)) return code
    }

    throw new Error("Unable to create a unique room code.")
  }

  private applyGameCommand(
    code: string,
    command: (room: ManagedRoom) => CommandResult<RoomSnapshot>,
  ): CommandResult<RoomSnapshot> {
    const room = this.rooms.get(normalizeRoomCode(code))
    if (!room) return fail("room-not-found", "That room code does not exist.")
    if (room.status !== "playing") {
      return fail("game-not-playing", "This room is not currently playing.")
    }
    return command(room)
  }
}

function createRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH)
  let code = ""
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  }
  return code
}

function createPlayer(input: {
  name: string
  seat: number
  connected: boolean
  now: string
}): Player {
  return {
    id: randomUUID(),
    name: input.name,
    seat: input.seat,
    ready: false,
    connected: input.connected,
    joinedAt: input.now,
    lastSeenAt: input.now,
  }
}

function mergeHouseRules(overrides: Partial<HouseRules> | undefined): HouseRules {
  const defaults = createDefaultHouseRules()
  return {
    ...defaults,
    ...overrides,
    maxPlayers: clampInteger(overrides?.maxPlayers, 2, 8, defaults.maxPlayers),
    startingHandSize: clampInteger(
      overrides?.startingHandSize,
      1,
      20,
      defaults.startingHandSize,
    ),
    mercyHandLimit: clampInteger(
      overrides?.mercyHandLimit,
      5,
      50,
      defaults.mercyHandLimit,
    ),
  }
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function nextSeat(room: ManagedRoom): number {
  const usedSeats = new Set(room.players.map((player) => player.seat))
  for (let seat = 1; seat <= room.houseRules.maxPlayers; seat += 1) {
    if (!usedSeats.has(seat)) return seat
  }
  return room.players.length + 1
}

function prepareChatMessage(
  input: SendChatMessageInput,
): CommandResult<{ body: string; label?: string }> {
  if (!input || typeof input.body !== "string") {
    return fail("invalid-chat-message", "Send a valid chat message.")
  }

  const body = input.body.trim().replace(/\s+/g, " ")

  switch (input.kind) {
    case "text":
      if (!body) return fail("empty-chat-message", "Write a message first.")
      return ok({ body: body.slice(0, 240) })
    case "preset":
      if (!CHAT_PRESETS.includes(body as (typeof CHAT_PRESETS)[number])) {
        return fail("invalid-chat-preset", "Choose one of the preset messages.")
      }
      return ok({ body })
    case "emoji":
      if (!CHAT_EMOJIS.includes(body as (typeof CHAT_EMOJIS)[number])) {
        return fail("invalid-chat-emoji", "Choose one of the room emojis.")
      }
      return ok({ body })
    case "gif": {
      const gif = CHAT_GIFS.find((candidate) => candidate.url === body)
      if (!gif) return fail("invalid-chat-gif", "Choose one of the room GIFs.")
      return ok({ body: gif.url, label: gif.label })
    }
    default:
      return fail("invalid-chat-kind", "That chat message type is not supported.")
  }
}

function findPlayer(room: ManagedRoom, playerId: string): Player | undefined {
  return room.players.find((player) => player.id === playerId)
}

function touch(room: ManagedRoom, now = new Date().toISOString()) {
  room.version += 1
  room.updatedAt = now
}

function snapshot(room: ManagedRoom): RoomSnapshot {
  return {
    code: room.code,
    status: room.status,
    hostPlayerId: room.hostPlayerId,
    players: room.players.map((player) => ({ ...player })),
    chatMessages: room.chatMessages.map((message) => ({ ...message })),
    houseRules: { ...room.houseRules },
    game: room.gameState ? projectPublicGame(room.gameState, gameContext(room)) : null,
    version: room.version,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  }
}

function gameContext(room: ManagedRoom) {
  return {
    players: room.players,
    houseRules: room.houseRules,
  }
}

function syncRoomStatus(room: ManagedRoom) {
  if (room.gameState?.turnPlayerId === null) {
    room.status = "finished"
  }
}

function cleanPlayerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 24)
}

function cleanSessionId(value: string): string {
  return value.trim()
}

function ok<T>(data: T): CommandResult<T> {
  return { ok: true, data }
}

function fail<T>(code: string, message: string): CommandResult<T> {
  return {
    ok: false,
    error: { code, message },
  }
}
