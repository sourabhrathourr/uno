import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { io } from "socket.io-client"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { HttpsProxyAgent } from "https-proxy-agent"
import { proxyForServer } from "./proxy"
import type { Socket } from "socket.io-client"
import type {
  ChatTypingPlayer,
  ClientToServerEvents,
  CommandResult,
  CreateRoomResponse,
  JoinRoomResponse,
  Player,
  PlayerGameSnapshot,
  RoomSnapshot,
  ServerToClientEvents,
} from "@workspace/game"
import { CliError, COMMANDS, parseCommand } from "./commands"
import type { CliCommand } from "./commands"
import { SquadState } from "./squad-state"

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>
type Target = { code: string; name: string }
type Ack<T> = (cause: Error | null, result?: CommandResult<T>) => void

export function validateServerUrl(value: string): string {
  const url = new URL(value)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new CliError(
      "invalid-server",
      "Use an http(s) server origin without credentials, query, or path."
    )
  return url.origin
}

/** A single in-memory seat with explicit, server-authorized support reads. */
export class UnoClient extends EventEmitter {
  private readonly socket: GameSocket
  private readonly sessionId = randomUUID()
  private readonly lifetime = new AbortController()
  private readonly serverUrl: string
  private readonly timeoutMs: number
  private readonly proxyAgent?: HttpsProxyAgent<string>
  private target: Target | null = null
  private room: RoomSnapshot | null = null
  private roomClock: { serverMs: number; receivedAt: number } | null = null
  private player: Player | null = null
  private self: PlayerGameSnapshot | null = null
  private joinedSocketId: string | null = null
  private joining: Promise<void> | null = null
  private joinError: CliError | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private watching = true
  private uncertainAction: string | null = null
  private connectionEpoch = 0
  private waitingForAction = false
  private waitEpoch = 0
  private chatWatching = true
  private seenChat: Set<string> | null = null
  private mentions = new Set<string>()
  private typingPlayers: ChatTypingPlayer[] = []
  private readonly squad = new SquadState((value) => this.emit("notice", value))
  private macroActive = false
  private priorityChat: Array<{
    command: CliCommand
    queuedAt: number
    resolve: (value: unknown) => void
    reject: (cause: unknown) => void
  }> = []
  private metrics: Array<{
    action: string
    queueMs?: number
    ackMs?: number
    syncMs?: number
    totalMs?: number
  }> = []

  constructor(options: {
    serverUrl: string
    timeoutMs?: number
    proxyEnv?: NodeJS.ProcessEnv
  }) {
    super()
    this.serverUrl = validateServerUrl(options.serverUrl)
    this.timeoutMs = options.timeoutMs ?? 8_000
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1)
      throw new CliError("invalid-timeout", "Timeout must be positive.")
    const proxy = proxyForServer(
      this.serverUrl,
      options.proxyEnv ?? process.env
    )
    if (proxy) this.proxyAgent = new HttpsProxyAgent(proxy)
    this.socket = io(this.serverUrl, {
      transportOptions: {
        websocket: { agent: this.proxyAgent },
        polling: { agent: this.proxyAgent },
      },
      autoConnect: false,
      transports: ["websocket", "polling"],
      tryAllTransports: true,
      retries: 0,
      timeout: this.timeoutMs,
    })
    this.socket.on("connect", () => {
      this.changed("connection")
      void this.restoreSeat().catch((cause: unknown) => this.report(cause))
    })
    this.socket.on("disconnect", () => {
      this.connectionEpoch++
      this.squad.reset()
      this.typingPlayers = []
      this.joinedSocketId = null
      this.joining = null
      this.changed("connection")
    })
    this.socket.on("room:chatTyping", (players) => {
      if (!this.isJoined()) return
      this.applyChatTyping(players)
      if (this.chatWatching)
        this.emit("notice", {
          type: "chat-typing",
          players: structuredClone(this.typingPlayers),
        })
    })
    this.socket.on("connect_error", () => {
      this.emit("notice", {
        type: "connection-error",
        message: "Could not connect to the game server; retrying.",
      })
    })
    this.socket.on("room:snapshot", (snapshot) => {
      if (!this.isJoined() || snapshot.code !== this.target?.code) return
      this.applyRoom(snapshot)
    })
    this.socket.on("game:playerState", (snapshot) => {
      if (!this.isJoined() || snapshot.playerId !== this.player?.id) return
      const version = snapshot.roomVersion ?? 0
      if (
        version < (this.room?.version ?? 0) ||
        version < (this.self?.roomVersion ?? 0)
      )
        return
      this.self = structuredClone(snapshot)
      this.changed("state")
    })
    this.socket.on("room:playerSocial", (snapshot) => {
      if (!this.isJoined() || !this.isSynchronized()) return
      this.squad.apply(snapshot)
      this.changed("state")
    })
    this.socket.on("room:error", (error) =>
      this.emit("notice", { type: "server-error", error })
    )
  }

  private isJoined() {
    return Boolean(
      this.socket.connected &&
      this.joinedSocketId &&
      this.joinedSocketId === this.socket.id
    )
  }

  private isSynchronized() {
    return (
      this.isJoined() &&
      Boolean(this.room) &&
      (!this.room!.game ||
        (this.self?.playerId === this.player?.id &&
          this.self?.roomVersion === this.room!.version))
    )
  }

  private voteKickState(voteKickId = this.room?.voteKick.activeVoteKickId) {
    const poll = this.room?.chatMessages.find(
      (message) => message.voteKick?.id === voteKickId
    )?.voteKick
    if (!poll) return null
    const serverNow = this.roomClock
      ? this.roomClock.serverMs + performance.now() - this.roomClock.receivedAt
      : Date.now()
    const remainingMs = Math.max(0, Date.parse(poll.closesAt) - serverNow)
    const open =
      poll.id === this.room?.voteKick.activeVoteKickId &&
      poll.status === "open" &&
      remainingMs > 0
    const eligible = poll.eligibleVoterIds.includes(this.player?.id ?? "")
    const myChoice =
      poll.votes.find((vote) => vote.playerId === this.player?.id)?.choice ??
      null
    const actionable =
      open &&
      eligible &&
      this.isSynchronized() &&
      !this.uncertainAction &&
      !this.closed
    return structuredClone({
      poll,
      remainingMs,
      open,
      eligible,
      myChoice,
      actionable,
      yesCommand: actionable
        ? { action: "vote-cast", voteKickId: poll.id, choice: "yes" }
        : null,
      noCommand: actionable
        ? { action: "vote-cast", voteKickId: poll.id, choice: "no" }
        : null,
    })
  }

  status() {
    const gift = this.room?.game?.lastGift
    const trade = this.room?.game?.tradeOffer
    const canGift = Boolean(
      gift &&
      gift.playerId === this.player?.id &&
      this.isSynchronized() &&
      !this.uncertainAction &&
      !this.closed &&
      (gift.expiresAt === null || gift.expiresAt > Date.now())
    )
    const remainingMs = (expiresAt: number | null) =>
      expiresAt === null ? null : Math.max(0, expiresAt - Date.now())
    return structuredClone({
      connected: this.socket.connected,
      joined: this.isJoined(),
      synchronized: this.isSynchronized(),
      closed: this.closed,
      watching: this.watching,
      chat: {
        watching: this.chatWatching,
        pendingMentionIds: [...this.mentions],
        typing: this.typingPlayers.filter(
          (player) => player.expiresAt > Date.now()
        ),
      },
      squadChat: this.squad.chatStatus(),
      support: this.squad.summary(),
      needsResync: this.uncertainAction !== null,
      uncertainAction: this.uncertainAction,
      pending: {
        voteKick: this.voteKickState(),
        lastGift: gift
          ? {
              ...gift,
              isMine: gift.playerId === this.player?.id,
              remainingMs: remainingMs(gift.expiresAt),
              actionable: canGift,
              eligibleCardIds: canGift
                ? (this.self?.lastGiftCards ?? []).map((card) => card.id)
                : [],
              eligibleRecipientIds: canGift
                ? (this.self?.giftTargetPlayerIds ?? [])
                : [],
              skipCommand: canGift ? { action: "gift", giftId: gift.id } : null,
            }
          : null,
        trade: trade
          ? { ...trade, remainingMs: remainingMs(trade.expiresAt) }
          : null,
        roulette: this.room?.game?.pendingChoice ?? null,
      },
      playerId: this.player?.id ?? null,
      myTurn:
        this.isSynchronized() &&
        Boolean(
          this.player && this.room?.game?.turnPlayerId === this.player.id
        ),
      room: this.room,
      self: this.self,
    })
  }

  private changed(type: "connection" | "state") {
    this.emit("change")
    if (this.watching) this.emit("notice", { type, state: this.status() })
  }

  private report(cause: unknown) {
    const error =
      cause instanceof CliError
        ? cause
        : new CliError("connection-error", "Could not restore the room seat.")
    this.emit("notice", {
      type: "client-error",
      error: { code: error.code, message: error.message },
    })
  }

  private applyRoom(room: RoomSnapshot) {
    if (this.room && room.version < this.room.version) return
    // Use server time plus monotonic elapsed time, not the device wall clock.
    // Repeated snapshots of the same version must not extend a poll's lease.
    if (!this.room || room.version > this.room.version) {
      this.anchorRoomClock(room)
    }
    this.room = structuredClone(room)
    if (this.player) this.squad.update(this.room, this.player.id)
    this.observeChat()
    this.changed("state")
  }

  private anchorRoomClock(room: RoomSnapshot) {
    const serverMs = Date.parse(room.updatedAt)
    this.roomClock = Number.isFinite(serverMs)
      ? { serverMs, receivedAt: performance.now() }
      : null
  }

  private applyChatTyping(players: ChatTypingPlayer[]) {
    const ids = new Set(this.room?.players.map((player) => player.id))
    // Server wall-clock timestamps cannot be compared to this device's clock.
    const expiresAt = Date.now() + 3_000
    this.typingPlayers = players
      .filter((player) => ids.has(player.playerId))
      .map((player) => ({ playerId: player.playerId, expiresAt }))
  }

  private observeChat() {
    const messages = this.room?.chatMessages ?? []
    if (!this.seenChat) {
      this.seenChat = new Set(messages.map((message) => message.id))
      return
    }
    for (const message of messages) {
      if (this.seenChat.has(message.id)) continue
      this.seenChat.add(message.id)
      const mentioned =
        message.playerId !== this.player?.id &&
        message.mentionPlayerIds.includes(this.player?.id ?? "")
      if (mentioned) this.mentions.add(message.id)
      if (this.chatWatching)
        this.emit("notice", {
          type: "chat-message",
          message: structuredClone(message),
          mentioned,
        })
    }
    const retained = new Set(messages.map((message) => message.id))
    this.seenChat = retained
    this.mentions = new Set([...this.mentions].filter((id) => retained.has(id)))
  }

  private readChat(command: Extract<CliCommand, { action: "chat-read" }>) {
    if (command.channel === "squad")
      return this.squad.read(command.afterMessageId, command.limit)
    const all = this.room?.chatMessages ?? []
    const index = command.afterMessageId
      ? all.findIndex((message) => message.id === command.afterMessageId)
      : -1
    const gap = Boolean(command.afterMessageId && index < 0)
    const messages = (
      command.afterMessageId && index >= 0 ? all.slice(index + 1) : all
    ).slice(0, command.limit ?? 100)
    for (const message of messages) this.mentions.delete(message.id)
    return structuredClone({
      messages,
      gap,
      nextMessageId: messages.at(-1)?.id ?? command.afterMessageId ?? null,
    })
  }

  private recordMetric(value: (typeof this.metrics)[number]) {
    this.metrics.push(value)
    if (this.metrics.length > 100) this.metrics.shift()
  }

  private waitFor(
    predicate: () => boolean,
    timeoutMs = this.timeoutMs
  ): Promise<boolean> {
    if (predicate()) return Promise.resolve(true)
    return new Promise((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer)
        this.off("change", check)
        resolve(value)
      }
      const check = () => {
        if (predicate()) finish(true)
        else if (this.closed) finish(false)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      this.on("change", check)
    })
  }

  private async restoreSeat() {
    if (!this.target || !this.socket.connected || this.closed) return
    if (this.joining) return this.joining
    const socketId = this.socket.id
    const target = this.target
    this.squad.reset()
    const attempt = (async () => {
      const result = await this.ack<JoinRoomResponse>((ack) => {
        this.socket.timeout(this.timeoutMs).volatile.emit(
          "room:join",
          {
            code: target.code,
            playerName: target.name,
            sessionId: this.sessionId,
          },
          ack
        )
      }, false)
      if (this.closed || !this.socket.connected || this.socket.id !== socketId)
        return
      this.player = structuredClone(result.player)
      this.anchorRoomClock(result.room)
      this.room = structuredClone(result.room)
      this.self =
        result.playerGame?.playerId === this.player.id
          ? structuredClone(result.playerGame)
          : null
      this.joinedSocketId = socketId ?? null
      this.squad.update(this.room, this.player.id)
      if (result.playerSocial) this.squad.apply(result.playerSocial)
      this.applyChatTyping(result.chatTyping ?? [])
      this.observeChat()
      this.changed("state")
    })()
    this.joining = attempt
    try {
      await attempt
    } catch (cause) {
      if (
        this.joining === attempt &&
        this.socket.id === socketId &&
        this.target === target &&
        cause instanceof CliError
      ) {
        this.joinError = cause
        // A rejected first join did not bind a seat. An unacknowledged join
        // may have bound one, so retain its target for safe recovery.
        if (!this.player && cause.code !== "connection-timeout")
          this.target = null
        this.changed("connection")
      }
      throw cause
    } finally {
      if (this.joining === attempt) this.joining = null
    }
  }

  private ack<T>(send: (ack: Ack<T>) => void, mutation: boolean): Promise<T> {
    return new Promise((resolve, reject) => {
      let complete = false
      const finish = (result?: CommandResult<T>, disconnected = false) => {
        if (complete) return
        complete = true
        clearTimeout(timer)
        this.socket.off("disconnect", onDisconnect)
        if (!result) {
          if (mutation) this.uncertainAction = this.currentAction
          this.changed("connection")
          reject(
            new CliError(
              mutation ? "outcome-unknown" : "connection-timeout",
              mutation
                ? "No confirmed acknowledgement. The action may have applied. Inspect status and explicitly resync before another mutation; do not replay it blindly."
                : disconnected
                  ? "Disconnected before the request completed."
                  : "Timed out waiting for the server."
            )
          )
        } else if (!result.ok)
          reject(new CliError(result.error.code, result.error.message))
        else resolve(result.data)
      }
      const onDisconnect = () => finish(undefined, true)
      const timer = setTimeout(() => finish(), this.timeoutMs)
      this.socket.once("disconnect", onDisconnect)
      // Never put mutations in Socket.IO's offline send buffer or retry queue.
      send((_cause, result) => finish(result))
    })
  }

  private currentAction = ""

  /** Calls are serialized, including failures. Unknown outcomes block queued mutations. */
  execute(input: unknown): Promise<unknown> {
    let command: CliCommand
    try {
      command = parseCommand(input)
    } catch (cause) {
      return Promise.reject(cause)
    }
    // Read-only waits never hold the mutation queue. Quit must wake outstanding waits.
    if (command.action === "wait-for-action") return this.waitForAction(command)
    if (command.action === "quit") {
      this.close()
      return Promise.resolve(this.status())
    }
    if (command.action === "status") return Promise.resolve(this.status())
    if (command.action === "metrics")
      return Promise.resolve({ samples: structuredClone(this.metrics) })
    if (command.action === "chat-read")
      return Promise.resolve(this.readChat(command))
    if (command.action === "support-read")
      return Promise.resolve(this.squad.summary())
    if (command.action === "vote-read")
      return Promise.resolve(this.voteKickState(command.voteKickId))
    if (command.action === "chat-watch") {
      if (command.channel === "squad") this.squad.watching = command.enabled
      else this.chatWatching = command.enabled
      return Promise.resolve(this.status())
    }
    const queuedAt = performance.now()
    const run = async () => {
      const startedAt = performance.now()
      try {
        return await this.dispatch(command)
      } finally {
        this.recordMetric({
          action: command.action,
          queueMs: startedAt - queuedAt,
          totalMs: performance.now() - queuedAt,
        })
      }
    }
    if (
      this.macroActive &&
      ["chat-send", "chat-react", "chat-typing"].includes(command.action)
    ) {
      if (this.priorityChat.length >= 4)
        return Promise.reject(
          new CliError(
            "chat-busy",
            "Wait for pending chat requests before sending more."
          )
        )
      return new Promise((resolve, reject) =>
        this.priorityChat.push({ command, queuedAt, resolve, reject })
      )
    }
    const task = this.queue.then(run)
    this.queue = task.catch(() => {})
    return task
  }

  private async join(code: string, name: string) {
    if (this.closed)
      throw new CliError("closed", "This client has been closed.")
    const target = { code: code.toUpperCase(), name: name.trim() }
    if (
      this.target &&
      (this.target.code !== target.code || this.target.name !== target.name)
    )
      throw new CliError(
        "seat-locked",
        "This process owns one seat. Quit and start another process for a different room or name."
      )
    this.target ??= target
    this.joinError = null
    if (this.socket.connected) await this.restoreSeat()
    else this.socket.connect()
    const completed = await this.waitFor(
      () => this.isJoined() || this.joinError !== null
    )
    // Connection establishment can consume part of the outer wait. Finish the
    // active join attempt before returning, so a resync never reuses its ack.
    if (!completed && this.joining) await this.joining
    if (this.joinError) throw this.joinError
    if (!completed && !this.isJoined())
      throw new CliError(
        "join-timeout",
        "Room join did not complete. Check connection notices, then resync or retry joining the same seat."
      )
    return this.status()
  }

  private async dispatch(command: CliCommand): Promise<unknown> {
    if (command.action === "help") return { commands: COMMANDS }
    if (command.action === "status") return this.status()
    if (command.action === "quit") {
      this.close()
      return this.status()
    }
    if (this.closed)
      throw new CliError("closed", "This client has been closed.")
    if (command.action === "watch") {
      this.watching = command.enabled
      return this.status()
    }
    if (command.action === "join") return this.join(command.code, command.name)
    if (command.action === "create") {
      if (this.target)
        throw new CliError(
          "seat-locked",
          "This process already has a room. Quit to create another."
        )
      let result: CommandResult<CreateRoomResponse>
      try {
        result = await this.createRoom(command.name.trim())
      } catch {
        // No safe way to discover a created room after losing the HTTP reply.
        this.close()
        throw new CliError(
          "create-outcome-unknown",
          "Room creation was not confirmed. No retry was sent; this client is closed."
        )
      }
      if (!result.ok)
        throw new CliError(result.error.code, result.error.message)
      return this.join(result.data.room.code, command.name)
    }
    if (command.action === "resync") {
      if (!this.target)
        throw new CliError("not-joined", "Join or create a room first.")
      this.joinedSocketId = null
      this.squad.reset()
      await this.join(this.target.code, this.target.name)
      this.uncertainAction = null
      this.changed("state")
      return this.status()
    }
    if (!this.isJoined())
      throw new CliError(
        "not-connected",
        "Wait for the seat to reconnect, or resync. Commands are not buffered offline."
      )
    if (this.uncertainAction)
      throw new CliError(
        "resync-required",
        "The previous action has an unknown outcome. Inspect status and explicitly resync first."
      )
    if (
      !this.isSynchronized() &&
      !(await this.waitFor(() => this.isSynchronized()))
    )
      throw new CliError(
        "stale-state",
        "Private and public snapshots are not synchronized. Resync first."
      )
    if (
      command.expectedVersion !== undefined &&
      command.expectedVersion !== this.room?.version
    )
      throw new CliError(
        "stale-version",
        "Room state changed before this command was sent. Inspect status before choosing again."
      )
    if (command.action === "chat-typing") {
      await this.ack<null>(
        (ack) =>
          this.socket
            .timeout(this.timeoutMs)
            .volatile.emit(
              "room:setChatTyping",
              { typing: command.typing },
              ack
            ),
        false
      )
      return { confirmed: true }
    }
    if (command.action === "support-view") return this.readSupportView()
    if (command.action === "vote-cast") {
      const vote = this.voteKickState(command.voteKickId)
      if (!vote)
        throw new CliError(
          "vote-kick-not-found",
          "That vote-kick is not in this room's retained public history."
        )
      if (!vote.open)
        throw new CliError("vote-kick-closed", "That vote-kick has closed.")
      if (!vote.eligible)
        throw new CliError(
          "vote-kick-not-eligible",
          "You cannot vote in this vote-kick."
        )
      if (vote.myChoice === command.choice)
        return { confirmed: true, alreadyVoted: true, state: this.status() }
    }
    if (
      command.action === "resolve-roulette" ||
      command.action === "stage-play"
    ) {
      this.macroActive = true
      try {
        return command.action === "stage-play"
          ? await this.stagePlay(command)
          : await this.resolveRoulette()
      } finally {
        this.macroActive = false
        while (this.priorityChat.length) await this.drainChat()
      }
    }
    await this.mutate(command)
    return { confirmed: true, state: this.status() }
  }

  private async mutate(command: CliCommand) {
    this.assertOwnCards(command)
    this.currentAction = command.action
    const sentAt = performance.now()
    const room = await this.ack<RoomSnapshot>(
      (ack) => this.sendCommand(command, ack),
      true
    )
    const ackAt = performance.now()
    this.applyRoom(room)
    // An acknowledgement confirms the action even if its private snapshot is delayed.
    await this.waitFor(() => this.isSynchronized() || !this.isJoined())
    this.recordMetric({
      action: command.action,
      ackMs: ackAt - sentAt,
      syncMs: performance.now() - ackAt,
    })
    return room
  }

  private async readSupportView() {
    const target = this.squad.target()
    if (!target)
      throw new CliError(
        "support-view-unavailable",
        "Join an eligible player's squad after resolving your last gift before reading their hand."
      )
    const epoch = this.connectionEpoch,
      version = this.room!.version,
      matchId = this.room!.game!.matchId
    const view = await this.ack<PlayerGameSnapshot | null>(
      (ack) =>
        this.socket
          .timeout(this.timeoutMs)
          .volatile.emit("game:getSupportView", ack),
      false
    )
    if (
      !this.isJoined() ||
      this.closed ||
      epoch !== this.connectionEpoch ||
      version !== this.room?.version ||
      (view?.roomVersion !== undefined && view.roomVersion !== version) ||
      matchId !== this.room?.game?.matchId ||
      target !== this.squad.target()
    )
      throw new CliError(
        "stale-support-view",
        "The match, connection or squad changed while reading. Request a fresh support view."
      )
    if (!view || view.playerId !== target)
      throw new CliError(
        "support-view-unavailable",
        "That support view is no longer available."
      )
    // Never assign this hand to self or make it available to gameplay commands.
    return structuredClone({
      readOnly: true,
      playerId: target,
      roomVersion: version,
      matchId,
      hand: view.hand,
    })
  }

  private async drainChat() {
    const task = this.priorityChat.shift()
    if (!task) return
    const startedAt = performance.now()
    try {
      task.resolve(await this.dispatch(task.command))
    } catch (cause) {
      task.reject(cause)
    } finally {
      this.recordMetric({
        action: task.command.action,
        queueMs: startedAt - task.queuedAt,
        totalMs: performance.now() - task.queuedAt,
      })
    }
  }

  private async stagePlay(
    command: Extract<CliCommand, { action: "stage-play" }>
  ) {
    const {
      action: _action,
      id: _id,
      expectedVersion: _version,
      previewMs = 180,
      ...play
    } = command
    const stage = {
      action: "stage" as const,
      cardIds: [...play.cardIds, ...(play.discardCardIds ?? [])],
      chosenColor: play.chosenColor,
      declaredUno: play.declaredUno,
      rotateHands: play.rotateHands,
      swapWithPlayerId: play.swapWithPlayerId,
    }
    const epoch = this.connectionEpoch
    const staged = await this.mutate(stage)
    if (
      !this.isSynchronized() ||
      !this.isJoined() ||
      epoch !== this.connectionEpoch
    )
      throw new CliError(
        "stage-interrupted",
        "Staging was acknowledged, but commit was not sent. Inspect status and resync before choosing again."
      )
    await this.waitFor(() => !this.isJoined() || this.closed, previewMs)
    const game = this.room?.game
    if (
      !this.isSynchronized() ||
      !this.isJoined() ||
      epoch !== this.connectionEpoch ||
      !game ||
      game.turnPlayerId !== this.player?.id ||
      game.matchId !== staged.game?.matchId ||
      game.stagedPlay?.playerId !== this.player?.id ||
      game.stagedPlay.cards.map((card) => card.id).join() !==
        stage.cardIds.join()
    )
      throw new CliError(
        "stage-changed",
        "The staged selection changed; commit was not sent."
      )
    // One bounded presentation pause; no per-card requests or extra controller roundtrip.
    await this.mutate({ action: "play", ...play })
    return { confirmed: true, staged: true, state: this.status() }
  }

  private async createRoom(
    name: string
  ): Promise<CommandResult<CreateRoomResponse>> {
    const url = new URL("/rooms", this.serverUrl)
    const request = url.protocol === "https:" ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: "POST",
          agent: this.proxyAgent,
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.any([
            this.lifetime.signal,
            AbortSignal.timeout(this.timeoutMs),
          ]),
        },
        (response) => {
          const chunks: Buffer[] = []
          let bytes = 0
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 1_048_576) {
              response.destroy()
              reject(new Error("Room response too large"))
              return
            }
            chunks.push(chunk)
          })
          response.on("error", reject)
          response.on("end", () => {
            try {
              resolve(
                JSON.parse(
                  Buffer.concat(chunks).toString()
                ) as CommandResult<CreateRoomResponse>
              )
            } catch {
              reject(new Error("Invalid room response"))
            }
          })
        }
      )
      req.on("error", reject)
      req.end(JSON.stringify({ playerName: name, sessionId: this.sessionId }))
    })
  }

  cancelWaits() {
    this.waitEpoch++
    this.emit("change")
  }

  private actionReasons(afterVersion?: number): string[] {
    if (this.closed) return ["closed"]
    if (!this.target) return ["join-required"]
    if (!this.isJoined()) return ["disconnected"]
    if (this.uncertainAction) return ["resync-required"]
    if (!this.isSynchronized()) return []
    const mentions = [
      ...(this.mentions.size ? ["mention"] : []),
      ...(this.squad.watching && this.squad.mentions.size
        ? ["squad-mention"]
        : []),
    ]
    if (afterVersion !== undefined && (this.room?.version ?? 0) <= afterVersion)
      return mentions
    return [...mentions, ...this.gameplayReasons()]
  }

  private gameplayReasons(): string[] {
    if (this.room?.status === "finished") return ["finished"]
    const game = this.room?.game
    if (!game) return []
    // Gift and trade choices pause ordinary play. Expired choices are never actionable.
    if (game.lastGift)
      return this.status().pending.lastGift?.actionable ? ["gift"] : []
    if (game.tradeOffer)
      return game.tradeOffer.targetPlayerId === this.player?.id &&
        (game.tradeOffer.expiresAt === null ||
          game.tradeOffer.expiresAt > Date.now())
        ? ["trade-response"]
        : []
    const reasons: string[] = []
    if (this.self?.catchablePlayerIds.length) reasons.push("catch-uno")
    if (game.turnPlayerId === this.player?.id)
      reasons.push(game.pendingChoice ? "roulette" : "turn")
    if (
      game.players.find((player) => player.playerId === this.player?.id)
        ?.eliminated
    )
      reasons.push("eliminated")
    return reasons
  }

  private async waitForAction(
    command: Extract<CliCommand, { action: "wait-for-action" }>
  ) {
    if (this.waitingForAction)
      throw new CliError(
        "wait-in-progress",
        "Only one wait-for-action may be outstanding per seat."
      )
    this.waitingForAction = true
    const epoch = this.waitEpoch
    try {
      const woke = await this.waitFor(
        () =>
          this.waitEpoch !== epoch ||
          this.actionReasons(command.afterVersion).length > 0,
        command.timeoutMs ?? 60_000
      )
      return {
        timedOut: !woke,
        reasons:
          this.waitEpoch !== epoch
            ? ["cancelled"]
            : this.actionReasons(command.afterVersion),
        state: this.status(),
      }
    } finally {
      this.waitingForAction = false
    }
  }

  private async resolveRoulette() {
    const initial = this.room!.game?.pendingChoice
    if (!initial || initial.playerId !== this.player?.id)
      throw new CliError(
        "roulette-not-pending",
        "Your seat has no pending roulette to resolve."
      )
    const matchId = this.room!.game!.matchId
    const discardId = this.room!.game!.topDiscard?.id
    const epoch = this.connectionEpoch
    let confirmedDraws = 0
    const stopped = (stopReason: string, complete = false) => ({
      complete,
      confirmedDraws,
      stopReason,
      state: this.status(),
    })
    for (;;) {
      await this.drainChat()
      if (this.closed || !this.isJoined() || epoch !== this.connectionEpoch)
        return stopped("disconnected")
      if (this.uncertainAction) return stopped("outcome-unknown")
      if (!this.isSynchronized()) return stopped("stale-state")
      const game = this.room?.game
      if (game?.matchId !== matchId) return stopped("match-changed")
      if (
        game.players.find((player) => player.playerId === this.player?.id)
          ?.eliminated
      )
        return stopped("eliminated", true)
      if (!game.pendingChoice) return stopped("resolved", true)
      if (
        game.topDiscard?.id !== discardId ||
        game.turnPlayerId !== this.player?.id ||
        game.pendingChoice.playerId !== initial.playerId ||
        game.pendingChoice.color !== initial.color
      )
        return stopped("turn-changed")
      if (confirmedDraws >= 128) return stopped("limit-reached")
      try {
        // Await both the individual acknowledgement and matching private/public state.
        const acknowledged = await this.mutate({ action: "roulette" })
        confirmedDraws++
        // Inspect the acknowledged episode even if later room updates overtook it.
        if (
          acknowledged.game?.players.find(
            (player) => player.playerId === this.player?.id
          )?.eliminated
        )
          return stopped("eliminated", true)
        if (!acknowledged.game?.pendingChoice) return stopped("resolved", true)
      } catch (cause) {
        if (!(cause instanceof CliError)) throw cause
        return {
          ...stopped(cause.code),
          error: { code: cause.code, message: cause.message },
        }
      }
    }
  }

  private assertOwnCards(command: CliCommand) {
    const handIds = new Set((this.self?.hand ?? []).map((card) => card.id))
    if (command.action === "gift") {
      const giftIds = new Set(
        (this.self?.lastGiftCards ?? []).map((card) => card.id)
      )
      if (command.cardId && !giftIds.has(command.cardId))
        throw new CliError(
          "card-not-owned",
          "Choose a card from your own frozen gift hand."
        )
      return
    }
    const cards =
      command.action === "play" || command.action === "stage-play"
        ? [...command.cardIds, ...(command.discardCardIds ?? [])]
        : command.action === "stage"
          ? command.cardIds
          : command.action === "trade-offer" ||
              command.action === "trade-respond"
            ? command.cardId
              ? [command.cardId]
              : []
            : []
    if (cards.some((id) => !handIds.has(id)))
      throw new CliError(
        "card-not-owned",
        "Choose card IDs from your own current hand."
      )
  }

  private sendCommand(command: CliCommand, ack: Ack<RoomSnapshot>) {
    const socket = this.socket.timeout(this.timeoutMs).volatile
    switch (command.action) {
      case "vote-cast":
        socket.emit(
          "room:castVoteKick",
          { voteKickId: command.voteKickId, choice: command.choice },
          ack
        )
        break
      case "chat-send":
        socket.emit(
          "room:sendChatMessage",
          {
            channel: command.channel ?? "public",
            kind: "text",
            body: command.body,
            mentionPlayerIds: command.mentionPlayerIds,
            replyToMessageId: command.replyToMessageId,
          },
          ack
        )
        break
      case "support-join":
        socket.emit(
          "game:supportPlayer",
          { supportedPlayerId: command.supportedPlayerId },
          ack
        )
        break
      case "support-request":
        socket.emit(
          "game:requestSupport",
          { supportedPlayerId: command.supportedPlayerId },
          ack
        )
        break
      case "support-respond":
        socket.emit(
          "game:respondSupportRequest",
          {
            supporterPlayerId: command.supporterPlayerId,
            approve: command.approve,
          },
          ack
        )
        break
      case "support-kick":
        socket.emit(
          "game:kickSupporter",
          { supporterPlayerId: command.supporterPlayerId },
          ack
        )
        break
      case "chat-react":
        socket.emit(
          "room:reactToChatMessage",
          {
            messageId: command.messageId,
            emoji: command.emoji,
            active: command.active,
          },
          ack
        )
        break
      case "ready":
        socket.emit("room:setReady", { ready: command.ready }, ack)
        break
      case "start":
        socket.emit("room:start", ack)
        break
      case "restart":
        socket.emit("room:restart", ack)
        break
      case "play": {
        const {
          action: _action,
          id: _id,
          expectedVersion: _version,
          ...input
        } = command
        socket.emit("game:playCards", input, ack)
        break
      }
      case "stage": {
        const {
          action: _action,
          id: _id,
          expectedVersion: _version,
          ...input
        } = command
        socket.emit("game:stageCards", input, ack)
        break
      }
      case "draw":
        socket.emit("game:drawOne", ack)
        break
      case "pass":
        socket.emit("game:endTurn", ack)
        break
      case "penalty":
        socket.emit("game:takeDrawPenalty", ack)
        break
      case "roulette":
        socket.emit("game:drawRouletteCard", ack)
        break
      case "catch-uno":
        socket.emit(
          "game:catchUno",
          { targetPlayerId: command.targetPlayerId },
          ack
        )
        break
      case "trade-offer":
        socket.emit(
          "game:offerBlindTrade",
          { cardId: command.cardId, targetPlayerId: command.targetPlayerId },
          ack
        )
        break
      case "trade-respond":
        socket.emit(
          "game:respondBlindTrade",
          {
            offerId: command.offerId,
            accept: command.accept,
            cardId: command.cardId,
          },
          ack
        )
        break
      case "trade-cancel":
        socket.emit("game:cancelBlindTrade", { offerId: command.offerId }, ack)
        break
      case "gift":
        socket.emit(
          "game:resolveLastGift",
          {
            giftId: command.giftId,
            cardId: command.cardId,
            targetPlayerId: command.targetPlayerId,
          },
          ack
        )
        break
      default:
        throw new CliError("unknown-action", "Unsupported gameplay action.")
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.squad.reset()
    this.lifetime.abort()
    this.joinedSocketId = null
    this.socket.disconnect()
    this.proxyAgent?.destroy()
    this.changed("connection")
  }
}
