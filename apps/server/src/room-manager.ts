import { randomBytes, randomUUID } from "node:crypto"

import {
  ROOM_CODE_LENGTH,
  addWaitingPlayer,
  CHAT_EMOJIS,
  CHAT_GIFS,
  CHAT_PRESETS,
  catchUno,
  createDefaultHouseRules,
  createGame,
  drawRouletteCard,
  drawOne,
  endTurn,
  incomingSupportRequests,
  normalizeRoomCode,
  outgoingSupportRequest,
  playCards,
  projectPlayerGame,
  projectPublicGame,
  projectSpectatorView,
  projectSupportView,
  kickSupporter as kickSupportLink,
  releaseInactiveSupportLinks,
  requestSupport as createSupportRequest,
  respondToSupportRequest as resolveSupportRequest,
  sendAvatarEmojiReaction as applyAvatarEmojiReaction,
  settleTurnClock,
  stageCards,
  supportPlayer as createSupportLink,
  supportSquadMemberIds,
  supportSquadPlayerIdFor,
  takeDrawPenalty,
  voteKickPlayer as applyVoteKickPlayer,
  type AnalysisRoomsResponse,
  type CatchUnoInput,
  type ChatMessage,
  type CommandResult,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type GameState,
  type GifProvider,
  type HouseRules,
  type JoinRoomInput,
  type Player,
  type PlayerGameSnapshot,
  type PlayerSocialSnapshot,
  type PlayCardsInput,
  type RoomSnapshot,
  type SendChatMessageInput,
  type SendAvatarEmojiReactionInput,
  type SetSeatOrderInput,
  type StageCardsInput,
  type VoteKickChoice,
  type VoteKickPoll,
} from "@workspace/game"

type ManagedRoom = RoomSnapshot & {
  gameState: GameState | null
  matchStartedAt: string | null
  matchFinishedAt: string | null
  sessionToPlayerId: Map<string, string>
  connectionIdsByPlayerId: Map<string, Set<string>>
  lastChatAtByPlayerId: Map<string, number>
  lastAvatarEmojiReactionAtByPlayerId: Map<string, number>
  activeVoteKickId: string | null
  lobbyVoteKickedPlayerIds: Set<string>
  voteKickCooldownExpiresAtByTargetId: Map<string, number>
  voteKickTimersById: Map<string, ReturnType<typeof setTimeout>>
}

type JoinRoomResult = {
  room: RoomSnapshot
  player: Player
  isNewPlayer: boolean
}

type ResolvedGif = {
  body: string
  label: string
}

type RoomManagerOptions = {
  resolveGif?: (provider: GifProvider, id: string) => ResolvedGif | null
  onRoomUpdated?: (code: string, room: RoomSnapshot) => void
  onRoomExpired?: (code: string) => void
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CHAT_HISTORY_LIMIT = 250
const CHAT_RATE_LIMIT_MS = 650
const AVATAR_EMOJI_REACTION_RATE_LIMIT_MS = 1_200
const VOTE_KICK_DURATION_MS = 25_000
const VOTE_KICK_COOLDOWN_MS = 60_000
export const ROOM_MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const ROOM_MEMORY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export class RoomManager {
  private readonly rooms = new Map<string, ManagedRoom>()
  private readonly resolveGif?: RoomManagerOptions["resolveGif"]
  private readonly onRoomUpdated?: RoomManagerOptions["onRoomUpdated"]
  private readonly onRoomExpired?: RoomManagerOptions["onRoomExpired"]

  constructor(options: RoomManagerOptions = {}) {
    this.resolveGif = options.resolveGif
    this.onRoomUpdated = options.onRoomUpdated
    this.onRoomExpired = options.onRoomExpired
  }

  createRoom(input: CreateRoomRequest): CommandResult<CreateRoomResponse> {
    this.pruneExpiredRooms()

    const playerName = cleanPlayerName(input.playerName)
    if (!playerName) {
      return fail(
        "invalid-player-name",
        "Enter a player name to create a room."
      )
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
      connected: false,
      now,
    })

    const room: ManagedRoom = {
      code,
      status: "lobby",
      hostPlayerId: host.id,
      crownPlayerId: null,
      nextMatchDirection: 1,
      players: [host],
      chatMessages: [],
      voteKick: {
        activeVoteKickId: null,
        lobbyVoteKickedPlayerIds: [],
        cooldowns: [],
      },
      houseRules,
      game: null,
      gameState: null,
      matchStartedAt: null,
      matchFinishedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      sessionToPlayerId: new Map([[sessionId, host.id]]),
      connectionIdsByPlayerId: new Map(),
      lastChatAtByPlayerId: new Map(),
      lastAvatarEmojiReactionAtByPlayerId: new Map(),
      activeVoteKickId: null,
      lobbyVoteKickedPlayerIds: new Set(),
      voteKickCooldownExpiresAtByTargetId: new Map(),
      voteKickTimersById: new Map(),
    }

    this.rooms.set(code, room)

    return ok({
      room: snapshot(room),
      player: host,
    })
  }

  getRoom(code: string): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    return ok(snapshot(room))
  }

  hasPlayerSession(code: string, sessionId: string): boolean {
    const room = this.getManagedRoom(code)
    const normalizedSessionId = cleanSessionId(sessionId)
    return Boolean(
      room &&
      normalizedSessionId &&
      room.sessionToPlayerId.has(normalizedSessionId)
    )
  }

  getAnalysisRooms(now = new Date()): AnalysisRoomsResponse {
    this.pruneExpiredRooms(now)
    const nowMs = now.getTime()
    const rooms = Array.from(this.rooms.values()).map((room) =>
      analysisRoomSummary(room, nowMs)
    )

    return {
      generatedAt: now.toISOString(),
      totals: {
        rooms: rooms.length,
        playing: rooms.filter((room) => room.status === "playing").length,
        lobby: rooms.filter((room) => room.status === "lobby").length,
        finished: rooms.filter((room) => room.status === "finished").length,
        totalPlayers: rooms.reduce(
          (total, room) => total + room.playerCount,
          0
        ),
        onlinePlayers: rooms.reduce(
          (total, room) => total + room.connectedPlayerCount,
          0
        ),
      },
      rooms,
    }
  }

  pruneExpiredRooms(now = new Date()): string[] {
    const nowMs = now.getTime()
    const expiredCodes: string[] = []

    for (const [code, room] of this.rooms) {
      if (!isExpiredRoom(room, nowMs)) continue
      this.deleteRoom(code, room)
      expiredCodes.push(code)
    }

    return expiredCodes
  }

  joinRoom(input: JoinRoomInput): CommandResult<JoinRoomResult> {
    const code = normalizeRoomCode(input.code)
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    const playerName = cleanPlayerName(input.playerName)
    if (!playerName) {
      return fail(
        "invalid-player-name",
        "Enter a player name to join the room."
      )
    }

    const sessionId = cleanSessionId(input.sessionId)
    if (!sessionId) {
      return fail("invalid-session", "Missing player session.")
    }

    const existingPlayerId = room.sessionToPlayerId.get(sessionId)
    if (existingPlayerId) {
      const player = room.players.find(
        (candidate) => candidate.id === existingPlayerId
      )
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

    if (room.players.length >= room.houseRules.maxPlayers) {
      return fail("room-full", "This room is full.")
    }
    if (room.status === "playing" && !room.gameState) {
      return fail("game-not-started", "Start the game first.")
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
    if (room.status === "playing" && room.gameState) {
      const waiting = addWaitingPlayer(
        room.gameState,
        gameContext(room),
        player.id
      )
      if (!waiting.ok) {
        room.players = room.players.filter(
          (candidate) => candidate.id !== player.id
        )
        room.sessionToPlayerId.delete(sessionId)
        return fail(waiting.error.code, waiting.error.message)
      }
    }
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
    ready: boolean
  ): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    if (room.status !== "lobby") {
      return fail(
        "room-not-lobby",
        "Readiness can only change before the game starts."
      )
    }

    const player = findPlayer(room, playerId)
    if (!player) {
      return fail("player-not-found", "You are not seated in this room.")
    }
    if (room.lobbyVoteKickedPlayerIds.has(playerId)) {
      return fail(
        "vote-kicked-player",
        "Vote-kicked players do not ready up for this match."
      )
    }

    player.ready = ready
    player.lastSeenAt = new Date().toISOString()
    touch(room, player.lastSeenAt)

    return ok(snapshot(room))
  }

  startRoom(code: string, playerId: string): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    if (room.status !== "lobby") {
      return fail("room-not-lobby", "This room has already started.")
    }

    if (room.hostPlayerId !== playerId) {
      return fail("host-only", "Only the host can start the game.")
    }
    if (room.activeVoteKickId) {
      return fail(
        "vote-kick-open",
        "Resolve the open vote-kick before starting."
      )
    }

    const activeLobbyPlayers = room.players.filter(
      (player) => !room.lobbyVoteKickedPlayerIds.has(player.id)
    )
    if (activeLobbyPlayers.length < 2) {
      return fail(
        "not-enough-players",
        "At least two players are needed to start."
      )
    }

    const everyoneReady = activeLobbyPlayers.every(
      (player) => player.id === room.hostPlayerId || player.ready
    )
    if (!everyoneReady) {
      return fail("players-not-ready", "Every non-host player must be ready.")
    }

    const now = new Date().toISOString()
    room.status = "playing"
    room.gameState = createGame(gameContext(room), {
      direction: room.nextMatchDirection,
      voteKickedPlayerIds: [...room.lobbyVoteKickedPlayerIds],
    })
    room.lobbyVoteKickedPlayerIds.clear()
    room.lastAvatarEmojiReactionAtByPlayerId.clear()
    room.matchStartedAt = now
    room.matchFinishedAt = null
    touch(room, now)

    return ok(snapshot(room))
  }

  restartRoom(code: string, playerId: string): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }

    if (!findPlayer(room, playerId)) {
      return fail("player-not-found", "You are not seated in this room.")
    }

    if (room.status !== "finished" || room.gameState?.turnPlayerId !== null) {
      return fail(
        "game-not-finished",
        "Finish this match before starting another."
      )
    }

    if (room.players.length < 2) {
      return fail(
        "not-enough-players",
        "At least two players are needed to restart."
      )
    }

    const starterPlayerId = nextMatchStarterId(room)
    if (starterPlayerId && starterPlayerId !== playerId) {
      return fail(
        room.crownPlayerId === starterPlayerId ? "crown-only" : "host-only",
        room.crownPlayerId === starterPlayerId
          ? "Only the last winner can start the next match."
          : "Only the host can start the next match."
      )
    }

    const now = new Date().toISOString()
    room.status = "playing"
    room.gameState = createGame(gameContext(room), {
      direction: room.nextMatchDirection,
    })
    room.lastAvatarEmojiReactionAtByPlayerId.clear()
    room.matchStartedAt = now
    room.matchFinishedAt = null
    touch(room, now)

    return ok(snapshot(room))
  }

  /**
   * The crown holder redraws the table before the next match: who sits where,
   * and which way play runs.
   */
  setSeatOrder(
    code: string,
    playerId: string,
    input: SetSeatOrderInput
  ): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }
    if (!findPlayer(room, playerId)) {
      return fail("player-not-found", "You are not seated in this room.")
    }
    if (room.status === "playing") {
      return fail(
        "game-in-progress",
        "Seating can only change between matches."
      )
    }

    const organiserPlayerId = nextMatchStarterId(room)
    if (organiserPlayerId && organiserPlayerId !== playerId) {
      return fail(
        room.crownPlayerId === organiserPlayerId ? "crown-only" : "host-only",
        room.crownPlayerId === organiserPlayerId
          ? "Only the last winner can rearrange the table."
          : "Only the host can rearrange the table."
      )
    }

    const requestedOrder = uniquePlayerIds(input?.playerOrder ?? [])
    const seatedIds = room.players.map((player) => player.id)
    const isPermutation =
      requestedOrder.length === seatedIds.length &&
      requestedOrder.every((candidateId) => seatedIds.includes(candidateId))
    if (!isPermutation) {
      return fail(
        "invalid-seat-order",
        "List every seated player exactly once."
      )
    }

    requestedOrder.forEach((orderedPlayerId, index) => {
      const player = findPlayer(room, orderedPlayerId)
      if (player) player.seat = index + 1
    })
    room.players.sort((a, b) => a.seat - b.seat)
    room.nextMatchDirection = input?.direction === -1 ? -1 : 1
    touch(room)

    return ok(snapshot(room))
  }

  sendChatMessage(
    code: string,
    playerId: string,
    input: SendChatMessageInput
  ): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
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
      return fail(
        "chat-too-fast",
        "Give the table a beat before sending again."
      )
    }

    const prepared = prepareChatMessage(input, this.resolveGif)
    if (!prepared.ok) return prepared

    const channel = input.channel ?? "public"
    const squadPlayerId =
      channel === "squad" && room.gameState
        ? supportSquadPlayerIdFor(room.gameState, playerId)
        : null
    if (channel === "squad" && !squadPlayerId) {
      return fail(
        "squad-chat-unavailable",
        "Join or receive a support squad first."
      )
    }

    const mentionPlayerIds = uniquePlayerIds(input.mentionPlayerIds ?? [])
    const eligibleMentionPlayerIds =
      channel === "public"
        ? new Set(room.players.map((candidate) => candidate.id))
        : new Set(
            supportSquadMemberIds(
              room.gameState as GameState,
              squadPlayerId as string
            )
          )
    if (
      mentionPlayerIds.some(
        (mentionedId) => !eligibleMentionPlayerIds.has(mentionedId)
      )
    ) {
      return fail(
        "mention-not-in-channel",
        "You can only mention players who can read this chat."
      )
    }
    if (
      mentionPlayerIds.length > 0 &&
      (input.kind !== "text" ||
        mentionPlayerIds.some((mentionedId) => {
          const mentioned = findPlayer(room, mentionedId)
          return (
            !mentioned || !prepared.data.body.includes(`@${mentioned.name}`)
          )
        }))
    ) {
      return fail(
        "invalid-mention",
        "Every mention must appear in the message."
      )
    }

    const now = new Date(nowMs).toISOString()
    const message: ChatMessage = {
      id: randomUUID(),
      playerId,
      playerName: player.name,
      channel,
      squadPlayerId: squadPlayerId ?? undefined,
      matchId: channel === "squad" ? room.gameState?.matchId : undefined,
      kind: input.kind,
      body: prepared.data.body,
      mentionPlayerIds,
      label: prepared.data.label,
      createdAt: now,
    }

    room.chatMessages = [...room.chatMessages, message].slice(
      -CHAT_HISTORY_LIMIT
    )
    room.lastChatAtByPlayerId.set(playerId, nowMs)
    touch(room, now)

    return ok(snapshot(room))
  }

  startVoteKick(
    code: string,
    initiatorPlayerId: string,
    targetPlayerId: string
  ): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }
    if (room.status !== "lobby" && room.status !== "playing") {
      return fail(
        "vote-kick-unavailable",
        "Vote-kicks are available in the lobby or during a match."
      )
    }
    if (room.activeVoteKickId) {
      return fail(
        "vote-kick-open",
        "There is already a vote-kick open in this room."
      )
    }

    const initiator = findPlayer(room, initiatorPlayerId)
    if (!initiator) {
      return fail("player-not-found", "You are not seated in this room.")
    }
    const target = findPlayer(room, targetPlayerId)
    if (!target) {
      return fail("player-not-found", "That player is not seated here.")
    }
    if (initiatorPlayerId === targetPlayerId) {
      return fail("cannot-vote-kick-self", "Choose another player.")
    }
    if (isVoteKicked(room, initiatorPlayerId)) {
      return fail(
        "vote-kicked-player",
        "Vote-kicked players cannot start vote-kicks."
      )
    }

    const cooldownExpiresAt =
      room.voteKickCooldownExpiresAtByTargetId.get(targetPlayerId) ?? 0
    if (cooldownExpiresAt > Date.now()) {
      return fail(
        "vote-kick-cooldown",
        "That player is cooling down from the last vote-kick."
      )
    }

    const targetValidation = validateVoteKickTarget(room, targetPlayerId)
    if (!targetValidation.ok) return targetValidation

    const eligibleVoterIds = eligibleVoteKickVoterIds(room, targetPlayerId)
    if (!eligibleVoterIds.includes(initiatorPlayerId)) {
      return fail(
        "vote-kick-not-eligible",
        "You cannot vote in this vote-kick."
      )
    }

    const nowMs = Date.now()
    const createdAt = new Date(nowMs).toISOString()
    const closesAt = new Date(nowMs + VOTE_KICK_DURATION_MS).toISOString()
    const id = randomUUID()
    const poll = projectVoteKickPoll({
      id,
      initiatorPlayerId,
      initiatorPlayerName: initiator.name,
      targetPlayerId,
      targetPlayerName: target.name,
      status: "open",
      result: null,
      eligibleVoterIds,
      votes: [
        {
          playerId: initiatorPlayerId,
          choice: "yes",
          votedAt: createdAt,
        },
      ],
      createdAt,
      closesAt,
      resolvedAt: null,
    })
    const message: ChatMessage = {
      id,
      playerId: initiatorPlayerId,
      playerName: initiator.name,
      channel: "public",
      kind: "vote-kick",
      body: `Kick ${target.name}?`,
      mentionPlayerIds: [],
      voteKick: poll,
      createdAt,
    }

    room.activeVoteKickId = id
    room.chatMessages = [...room.chatMessages, message].slice(
      -CHAT_HISTORY_LIMIT
    )
    scheduleVoteKickResolution(room, id, () => {
      const resolved = this.resolveVoteKick(code, id)
      if (resolved.ok) this.onRoomUpdated?.(resolved.data.code, resolved.data)
    })
    touch(room, createdAt)
    return ok(snapshot(room))
  }

  castVoteKick(
    code: string,
    voterPlayerId: string,
    voteKickId: string,
    choice: VoteKickChoice
  ): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) {
      return fail("room-not-found", "That room code does not exist.")
    }
    const player = findPlayer(room, voterPlayerId)
    if (!player) {
      return fail("player-not-found", "You are not seated in this room.")
    }
    if (choice !== "yes" && choice !== "no") {
      return fail("invalid-vote-kick-choice", "Choose Yes or No.")
    }

    const message = voteKickMessage(room, voteKickId)
    const poll = message?.voteKick
    if (!message || !poll) {
      return fail("vote-kick-not-found", "That vote-kick is not open.")
    }
    if (poll.status !== "open" || Date.now() >= Date.parse(poll.closesAt)) {
      return fail("vote-kick-closed", "That vote-kick has closed.")
    }
    if (!poll.eligibleVoterIds.includes(voterPlayerId)) {
      return fail(
        "vote-kick-not-eligible",
        "You cannot vote in this vote-kick."
      )
    }

    const votedAt = new Date().toISOString()
    const votes = [
      ...poll.votes.filter((vote) => vote.playerId !== voterPlayerId),
      { playerId: voterPlayerId, choice, votedAt },
    ]
    message.voteKick = projectVoteKickPoll({ ...poll, votes })
    touch(room, votedAt)
    return ok(snapshot(room))
  }

  playCards(
    code: string,
    playerId: string,
    input: PlayCardsInput
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the game first.")
      const result = playCards(
        room.gameState,
        gameContext(room),
        playerId,
        input
      )
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  stageCards(
    code: string,
    playerId: string,
    input: StageCardsInput
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the game first.")
      const result = stageCards(
        room.gameState,
        gameContext(room),
        playerId,
        input
      )
      if (!result.ok) return result
      touch(room)
      return ok(snapshot(room))
    })
  }

  drawOne(code: string, playerId: string): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the game first.")
      const result = drawOne(room.gameState, gameContext(room), playerId)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  endTurn(code: string, playerId: string): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the game first.")
      const result = endTurn(room.gameState, gameContext(room), playerId)
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  takeDrawPenalty(code: string, playerId: string): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the game first.")
      const result = takeDrawPenalty(
        room.gameState,
        gameContext(room),
        playerId
      )
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  drawRouletteCard(
    code: string,
    playerId: string
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the game first.")
      const result = drawRouletteCard(
        room.gameState,
        gameContext(room),
        playerId
      )
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  catchUno(
    code: string,
    playerId: string,
    input: CatchUnoInput
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the game first.")
      const result = catchUno(
        room.gameState,
        gameContext(room),
        playerId,
        input
      )
      if (!result.ok) return result
      syncRoomStatus(room)
      touch(room)
      return ok(snapshot(room))
    })
  }

  getPlayerGame(code: string, playerId: string): PlayerGameSnapshot | null {
    const room = this.getManagedRoom(code)
    if (!room?.gameState) return null
    if (!findPlayer(room, playerId)) return null
    return {
      ...projectPlayerGame(room.gameState, gameContext(room), playerId),
      roomVersion: room.version,
    }
  }

  supportPlayer(
    code: string,
    supporterPlayerId: string,
    supportedPlayerId: string
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the match first.")
      const result = createSupportLink(
        room.gameState,
        gameContext(room),
        supporterPlayerId,
        supportedPlayerId
      )
      if (!result.ok) return result
      touch(room)
      return ok(snapshot(room))
    })
  }

  kickSupporter(
    code: string,
    supportedPlayerId: string,
    supporterPlayerId: string
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the match first.")
      const result = kickSupportLink(
        room.gameState,
        gameContext(room),
        supportedPlayerId,
        supporterPlayerId
      )
      if (!result.ok) return result
      touch(room)
      return ok(snapshot(room))
    })
  }

  requestSupport(
    code: string,
    supporterPlayerId: string,
    supportedPlayerId: string
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the match first.")
      const result = createSupportRequest(
        room.gameState,
        gameContext(room),
        supporterPlayerId,
        supportedPlayerId
      )
      if (!result.ok) return result
      touch(room)
      return ok(snapshot(room))
    })
  }

  respondToSupportRequest(
    code: string,
    supportedPlayerId: string,
    supporterPlayerId: string,
    approve: boolean
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the match first.")
      const result = resolveSupportRequest(
        room.gameState,
        gameContext(room),
        supportedPlayerId,
        supporterPlayerId,
        approve
      )
      if (!result.ok) return result
      touch(room)
      return ok(snapshot(room))
    })
  }

  sendAvatarEmojiReaction(
    code: string,
    playerId: string,
    input: SendAvatarEmojiReactionInput
  ): CommandResult<RoomSnapshot> {
    return this.applyGameCommand(code, (room) => {
      if (!room.gameState)
        return fail("game-not-started", "Start the match first.")
      const nowMs = Date.now()
      const lastAvatarEmojiReactionAt =
        room.lastAvatarEmojiReactionAtByPlayerId.get(playerId)
      if (
        lastAvatarEmojiReactionAt !== undefined &&
        nowMs - lastAvatarEmojiReactionAt < AVATAR_EMOJI_REACTION_RATE_LIMIT_MS
      ) {
        return fail(
          "avatar-emoji-reaction-too-fast",
          "Give the avatar emoji reaction a moment to land."
        )
      }
      const result = applyAvatarEmojiReaction(
        room.gameState,
        gameContext(room),
        playerId,
        input
      )
      if (!result.ok) return result
      room.lastAvatarEmojiReactionAtByPlayerId.set(playerId, nowMs)
      touch(room)
      return ok(snapshot(room))
    })
  }

  getSupportView(
    code: string,
    supporterPlayerId: string
  ): PlayerGameSnapshot | null {
    const room = this.getManagedRoom(code)
    if (!room?.gameState || !findPlayer(room, supporterPlayerId)) return null
    return projectSupportView(
      room.gameState,
      gameContext(room),
      supporterPlayerId
    )
  }

  getSpectatorView(
    code: string,
    spectatorPlayerId: string,
    targetPlayerId: string
  ): PlayerGameSnapshot | null {
    const room = this.getManagedRoom(code)
    if (!room?.gameState) return null
    if (!findPlayer(room, spectatorPlayerId)) return null
    if (!findPlayer(room, targetPlayerId)) return null
    return projectSpectatorView(
      room.gameState,
      gameContext(room),
      spectatorPlayerId,
      targetPlayerId
    )
  }

  getPlayerSocial(code: string, playerId: string): PlayerSocialSnapshot | null {
    const room = this.getManagedRoom(code)
    if (!room || !findPlayer(room, playerId)) return null
    const squadPlayerId = room.gameState
      ? supportSquadPlayerIdFor(room.gameState, playerId)
      : null
    return {
      squadPlayerId,
      squadChatMessages: squadPlayerId
        ? room.chatMessages
            .filter(
              (message) =>
                message.channel === "squad" &&
                message.squadPlayerId === squadPlayerId &&
                message.matchId === room.gameState?.matchId
            )
            .map(cloneChatMessage)
        : [],
      blockedSupportedPlayerIds:
        room.gameState?.supportBlocks
          .filter((block) => block.supporterPlayerId === playerId)
          .map((block) => block.supportedPlayerId) ?? [],
      incomingSupportRequests: room.gameState
        ? incomingSupportRequests(room.gameState, playerId)
        : [],
      outgoingSupportRequest: room.gameState
        ? outgoingSupportRequest(room.gameState, playerId)
        : null,
    }
  }

  registerConnection(
    code: string,
    playerId: string,
    socketId: string
  ): RoomSnapshot | null {
    const room = this.getManagedRoom(code)
    if (!room || !findPlayer(room, playerId)) return null

    const connectionIds =
      room.connectionIdsByPlayerId.get(playerId) ?? new Set<string>()
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
    socketId: string
  ): RoomSnapshot | null {
    const room = this.getManagedRoom(code)
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

  private resolveVoteKick(
    code: string,
    voteKickId: string
  ): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) return fail("room-not-found", "That room code does not exist.")

    const message = voteKickMessage(room, voteKickId)
    const poll = message?.voteKick
    if (!message || !poll || poll.status !== "open") return ok(snapshot(room))

    const yesCount = poll.votes.filter((vote) => vote.choice === "yes").length
    const passed = yesCount > poll.eligibleVoterIds.length / 2
    const resolvedAtMs = Date.now()
    const resolvedAt = new Date(resolvedAtMs).toISOString()

    if (passed) {
      if (room.status === "lobby") {
        room.lobbyVoteKickedPlayerIds.add(poll.targetPlayerId)
        const target = findPlayer(room, poll.targetPlayerId)
        if (target) target.ready = false
      } else if (room.gameState) {
        const result = applyVoteKickPlayer(
          room.gameState,
          gameContext(room),
          poll.targetPlayerId
        )
        if (!result.ok) return result
        syncRoomStatus(room)
      }
    } else {
      room.voteKickCooldownExpiresAtByTargetId.set(
        poll.targetPlayerId,
        resolvedAtMs + VOTE_KICK_COOLDOWN_MS
      )
    }

    message.voteKick = projectVoteKickPoll({
      ...poll,
      status: passed ? "passed" : "failed",
      result: passed ? "kicked" : "not-kicked",
      resolvedAt,
    })
    room.activeVoteKickId =
      room.activeVoteKickId === voteKickId ? null : room.activeVoteKickId
    const timer = room.voteKickTimersById.get(voteKickId)
    if (timer) clearTimeout(timer)
    room.voteKickTimersById.delete(voteKickId)
    touch(room, resolvedAt)
    return ok(snapshot(room))
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
    command: (room: ManagedRoom) => CommandResult<RoomSnapshot>
  ): CommandResult<RoomSnapshot> {
    const room = this.getManagedRoom(code)
    if (!room) return fail("room-not-found", "That room code does not exist.")
    if (room.status !== "playing") {
      return fail("game-not-playing", "This room is not currently playing.")
    }
    return command(room)
  }

  private getManagedRoom(code: string): ManagedRoom | undefined {
    this.pruneExpiredRooms()
    return this.rooms.get(normalizeRoomCode(code))
  }

  private deleteRoom(code: string, room: ManagedRoom): void {
    for (const timer of room.voteKickTimersById.values()) {
      clearTimeout(timer)
    }
    room.voteKickTimersById.clear()
    this.rooms.delete(code)
    this.onRoomExpired?.(code)
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

function mergeHouseRules(
  overrides: Partial<HouseRules> | undefined
): HouseRules {
  const defaults = createDefaultHouseRules()
  return {
    ...defaults,
    ...overrides,
    maxPlayers: clampInteger(overrides?.maxPlayers, 2, 8, defaults.maxPlayers),
    startingHandSize: clampInteger(
      overrides?.startingHandSize,
      1,
      20,
      defaults.startingHandSize
    ),
    mercyHandLimit: clampInteger(
      overrides?.mercyHandLimit,
      5,
      50,
      defaults.mercyHandLimit
    ),
  }
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
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
  resolveGif?: RoomManagerOptions["resolveGif"]
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
      if (input.gifProvider === "giphy") {
        const gif = resolveGif?.("giphy", body)
        if (!gif) return fail("invalid-chat-gif", "Choose a GIF from search.")
        return ok({ body: gif.body, label: gif.label })
      }
      if (input.gifProvider && input.gifProvider !== "curated") {
        return fail("invalid-chat-gif", "Choose a supported GIF provider.")
      }
      const gif = CHAT_GIFS.find((candidate) => candidate.url === body)
      if (!gif) return fail("invalid-chat-gif", "Choose one of the room GIFs.")
      return ok({ body: gif.url, label: gif.label })
    }
    default:
      return fail(
        "invalid-chat-kind",
        "That chat message type is not supported."
      )
  }
}

function findPlayer(room: ManagedRoom, playerId: string): Player | undefined {
  return room.players.find((player) => player.id === playerId)
}

function isVoteKicked(room: ManagedRoom, playerId: string): boolean {
  return room.status === "lobby"
    ? room.lobbyVoteKickedPlayerIds.has(playerId)
    : Boolean(room.gameState?.voteKickedPlayerIds.includes(playerId))
}

function validateVoteKickTarget(
  room: ManagedRoom,
  targetPlayerId: string
): CommandResult<null> {
  if (room.status === "lobby") {
    if (room.lobbyVoteKickedPlayerIds.has(targetPlayerId)) {
      return fail(
        "vote-kick-target-ineligible",
        "That player is already vote-kicked."
      )
    }
    return ok(null)
  }

  if (!room.gameState?.playerOrder.includes(targetPlayerId)) {
    return fail("player-not-found", "That player is not part of this match.")
  }
  const publicTarget = projectPublicGame(
    room.gameState,
    gameContext(room)
  ).players.find((playerState) => playerState.playerId === targetPlayerId)
  if (!publicTarget)
    return fail("player-not-found", "That player is not part of this match.")
  if (
    publicTarget.eliminated ||
    publicTarget.winnerPlacement ||
    publicTarget.waiting ||
    publicTarget.voteKicked
  ) {
    return fail(
      "vote-kick-target-ineligible",
      "Choose an active player to vote-kick."
    )
  }
  return ok(null)
}

function eligibleVoteKickVoterIds(
  room: ManagedRoom,
  targetPlayerId: string
): string[] {
  const voteKickedPlayerIds =
    room.status === "lobby"
      ? room.lobbyVoteKickedPlayerIds
      : new Set(room.gameState?.voteKickedPlayerIds ?? [])
  return room.players
    .filter(
      (player) =>
        player.id !== targetPlayerId && !voteKickedPlayerIds.has(player.id)
    )
    .map((player) => player.id)
}

function voteKickMessage(
  room: ManagedRoom,
  voteKickId: string
): ChatMessage | undefined {
  return room.chatMessages.find(
    (message) =>
      message.kind === "vote-kick" && message.voteKick?.id === voteKickId
  )
}

function projectVoteKickPoll(
  poll: Omit<VoteKickPoll, "yesCount" | "noCount"> & {
    yesCount?: number
    noCount?: number
  }
): VoteKickPoll {
  const yesCount = poll.votes.filter((vote) => vote.choice === "yes").length
  const noCount = poll.votes.filter((vote) => vote.choice === "no").length
  return {
    ...poll,
    yesCount,
    noCount,
    eligibleVoterIds: [...poll.eligibleVoterIds],
    votes: poll.votes.map((vote) => ({ ...vote })),
  }
}

function scheduleVoteKickResolution(
  room: ManagedRoom,
  voteKickId: string,
  resolve: () => void
) {
  const message = voteKickMessage(room, voteKickId)
  const closesAt = message?.voteKick?.closesAt
  if (!closesAt) return

  const delay = Math.max(0, Date.parse(closesAt) - Date.now())
  const existing = room.voteKickTimersById.get(voteKickId)
  if (existing) clearTimeout(existing)
  room.voteKickTimersById.set(voteKickId, setTimeout(resolve, delay))
}

function isExpiredRoom(room: ManagedRoom, nowMs: number): boolean {
  const updatedAtMs = Date.parse(room.updatedAt)
  return (
    Number.isFinite(updatedAtMs) && nowMs - updatedAtMs >= ROOM_MEMORY_TTL_MS
  )
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
    crownPlayerId: room.crownPlayerId,
    nextMatchDirection: room.nextMatchDirection,
    players: room.players.map((player) => ({ ...player })),
    chatMessages: room.chatMessages
      .filter((message) => message.channel === "public")
      .map(cloneChatMessage),
    voteKick: {
      activeVoteKickId: room.activeVoteKickId,
      lobbyVoteKickedPlayerIds: [...room.lobbyVoteKickedPlayerIds],
      cooldowns: Array.from(room.voteKickCooldownExpiresAtByTargetId.entries())
        .filter(([, expiresAt]) => expiresAt > Date.now())
        .map(([targetPlayerId, expiresAt]) => ({
          targetPlayerId,
          expiresAt: new Date(expiresAt).toISOString(),
        })),
    },
    houseRules: { ...room.houseRules },
    game: room.gameState
      ? projectPublicGame(room.gameState, gameContext(room))
      : null,
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

function analysisRoomSummary(
  room: ManagedRoom,
  nowMs: number
): AnalysisRoomsResponse["rooms"][number] {
  const createdAtMs = Date.parse(room.createdAt)
  const updatedAtMs = Date.parse(room.updatedAt)
  const durationEndMs = room.status === "finished" ? updatedAtMs : nowMs
  const players = room.players.map((player) => ({
    name: player.name,
    seat: player.seat,
    isHost: player.id === room.hostPlayerId,
    ready: player.ready,
    connected: player.connected,
    joinedAt: player.joinedAt,
    lastSeenAt: player.lastSeenAt,
  }))
  const connectedPlayerCount = players.filter(
    (player) => player.connected
  ).length

  return {
    code: room.code,
    status: room.status,
    version: room.version,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    durationMs: Math.max(0, durationEndMs - createdAtMs),
    idleDurationMs: Math.max(0, nowMs - updatedAtMs),
    playerCount: players.length,
    connectedPlayerCount,
    awayPlayerCount: players.length - connectedPlayerCount,
    players,
    game: room.gameState
      ? {
          currentTurnPlayer: playerName(room, room.gameState.turnPlayerId),
          winner: playerName(room, room.gameState.winnerPlayerId),
          eventCount: room.gameState.events.length,
          matchStartedAt: room.matchStartedAt,
          matchFinishedAt: room.matchFinishedAt,
        }
      : null,
  }
}

function syncRoomStatus(room: ManagedRoom) {
  if (room.gameState) {
    // Every game command lands here before its snapshot is built, which makes
    // it the one place that reliably knows a turn may just have changed hands.
    settleTurnClock(room.gameState)
    releaseInactiveSupportLinks(room.gameState, gameContext(room))
  }
  if (room.gameState?.turnPlayerId === null) {
    room.status = "finished"
    // First place takes the crown: they pick the seating and start the next match.
    const winnerPlayerId = room.gameState.winnerPlayerId
    if (winnerPlayerId && findPlayer(room, winnerPlayerId)) {
      room.crownPlayerId = winnerPlayerId
    }
    room.matchFinishedAt ??= new Date().toISOString()
  }
}

/**
 * Who is allowed to arrange and start the next match: the reigning crown
 * holder while they are still seated, otherwise the host.
 */
function nextMatchStarterId(room: ManagedRoom): string | null {
  // A crown holder who has dropped off would otherwise deadlock the table, so
  // the right to arrange the next match falls back to the host.
  const crownHolder = room.crownPlayerId
    ? findPlayer(room, room.crownPlayerId)
    : undefined
  if (crownHolder?.connected) return crownHolder.id
  return room.hostPlayerId
}

function playerName(room: ManagedRoom, playerId: string | null): string | null {
  if (!playerId) return null
  return findPlayer(room, playerId)?.name ?? null
}

function cloneChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    mentionPlayerIds: [...message.mentionPlayerIds],
    voteKick: message.voteKick
      ? projectVoteKickPoll(message.voteKick)
      : undefined,
  }
}

function uniquePlayerIds(playerIds: string[]): string[] {
  return Array.from(new Set(playerIds.filter(Boolean)))
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
