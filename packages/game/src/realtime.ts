import type {
  CatchUnoInput,
  PlayerGameSnapshot,
  PlayCardsInput,
  StageCardsInput,
} from "./game"
import type { SendChatMessageInput } from "./chat"
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
}

export type ReadyInput = {
  ready: boolean
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
      type: "game-updated"
    }

export type ClientToServerEvents = {
  "room:join": (
    input: JoinRoomInput,
    ack: (result: CommandResult<JoinRoomResponse>) => void,
  ) => void
  "room:setReady": (
    input: ReadyInput,
    ack: (result: CommandResult<RoomSnapshot>) => void,
  ) => void
  "room:start": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "room:restart": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "room:sendChatMessage": (
    input: SendChatMessageInput,
    ack: (result: CommandResult<RoomSnapshot>) => void,
  ) => void
  "game:playCards": (
    input: PlayCardsInput,
    ack: (result: CommandResult<RoomSnapshot>) => void,
  ) => void
  "game:stageCards": (
    input: StageCardsInput,
    ack: (result: CommandResult<RoomSnapshot>) => void,
  ) => void
  "game:drawOne": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "game:endTurn": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "game:takeDrawPenalty": (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  "game:drawRouletteCard": (
    ack: (result: CommandResult<RoomSnapshot>) => void,
  ) => void
  "game:catchUno": (
    input: CatchUnoInput,
    ack: (result: CommandResult<RoomSnapshot>) => void,
  ) => void
}

export type ServerToClientEvents = {
  "room:snapshot": (snapshot: RoomSnapshot) => void
  "game:playerState": (snapshot: PlayerGameSnapshot) => void
  "room:event": (event: RoomEvent) => void
  "room:error": (error: GameError) => void
}

export type InterServerEvents = Record<string, never>

export type SocketData = {
  roomCode?: string
  playerId?: string
  sessionId?: string
}
