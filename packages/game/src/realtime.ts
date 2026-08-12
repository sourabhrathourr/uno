import type {
  CatchUnoInput,
  Direction,
  PlayerGameSnapshot,
  PlayCardsInput,
  SendTableReactionInput,
  StageCardsInput,
} from "./game"

export type SupportPlayerInput = {
  supportedPlayerId: string
}
export type KickSupporterInput = {
  supporterPlayerId: string
}
export type RequestSupportInput = {
  supportedPlayerId: string
}
export type RespondSupportRequestInput = {
  supporterPlayerId: string
  approve: boolean
}
export type SetSeatOrderInput = {
  /** Every seated player id, in the seating order they should take. */
  playerOrder: string[]
  direction: Direction
}
import type { PlayerSocialSnapshot, SendChatMessageInput } from "./chat"
import type { HouseRules, Player, RoomSnapshot } from "./rooms"

export type GameError = {
  code: string
  message: string
}

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: GameError }

export type CreateRoomRequest = {
  playerName: string
  sessionId: string
  houseRules?: Partial<HouseRules>
}

export type CreateRoomResponse = {
  room: RoomSnapshot
  player: Player
}

export type JoinRoomInput = {
  code: string
  playerName: string
  sessionId: string
}

export type JoinRoomResponse = {
  room: RoomSnapshot
  player: Player
  isNewPlayer: boolean
  playerGame?: PlayerGameSnapshot | null
  playerSocial?: PlayerSocialSnapshot | null
}

export type ReadyInput = {
  ready: boolean
}

export type VoiceSignal =
  | {
      type: "offer"
      sdp: string
    }
  | {
      type: "answer"
      sdp: string
    }
  | {
      type: "ice-candidate"
      candidate: unknown
    }
  | {
      type: "leave"
    }

export type VoiceSignalInput = {
  targetPlayerId: string
  signal: VoiceSignal
}

export type VoiceSignalEvent = VoiceSignalInput & {
  fromPlayerId: string
}

export type VoiceStateInput = {
  enabled: boolean
  muted: boolean
  speaking: boolean
}

export type VoiceStateEvent = VoiceStateInput & {
  playerId: string
}

export type RoomEvent =
  | {
      type: "player-joined"
      playerId: string
      playerName: string
    }
  | {
      type: "player-left"
      playerId: string
    }
  | {
      type: "player-ready-changed"
      playerId: string
      ready: boolean
    }
  | {
      type: "room-started"
    }
  | {
      type: "room-restarted"
    }
  | {
      type: "seating-changed"
      playerId: string
    }
  | {
      type: "game-updated"
    }

export type ClientToServerEvents = {
  "room:join": (
    input: JoinRoomInput,
    ack: (result: CommandResult<JoinRoomResponse>) => void
  ) => void
  "room:setReady": (
    input: ReadyInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "room:start": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "room:restart": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "room:setSeatOrder": (
    input: SetSeatOrderInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "room:sendChatMessage": (
    input: SendChatMessageInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "voice:requestStates": () => void
  "voice:setState": (input: VoiceStateInput) => void
  "voice:signal": (input: VoiceSignalInput) => void
  "game:playCards": (
    input: PlayCardsInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:stageCards": (
    input: StageCardsInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:drawOne": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "game:endTurn": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "game:takeDrawPenalty": (
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:drawRouletteCard": (
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:catchUno": (
    input: CatchUnoInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:supportPlayer": (
    input: SupportPlayerInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:kickSupporter": (
    input: KickSupporterInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:requestSupport": (
    input: RequestSupportInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:respondSupportRequest": (
    input: RespondSupportRequestInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:sendReaction": (
    input: SendTableReactionInput,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) => void
  "game:getSupportView": (
    ack: (result: CommandResult<PlayerGameSnapshot | null>) => void
  ) => void
}

export type ServerToClientEvents = {
  "room:snapshot": (snapshot: RoomSnapshot) => void
  "game:playerState": (snapshot: PlayerGameSnapshot) => void
  "room:playerSocial": (snapshot: PlayerSocialSnapshot) => void
  "room:event": (event: RoomEvent) => void
  "voice:state": (event: VoiceStateEvent) => void
  "voice:signal": (event: VoiceSignalEvent) => void
  "room:error": (error: GameError) => void
}

export type InterServerEvents = Record<string, never>

export type SocketData = {
  roomCode?: string
  playerId?: string
  sessionId?: string
}
