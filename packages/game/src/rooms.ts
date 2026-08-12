export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/

export type RoomStatus = "lobby" | "playing" | "finished"

export type Player = {
  id: string
  name: string
  seat: number
  ready: boolean
  connected: boolean
  joinedAt: string
  lastSeenAt: string
}

export type HouseRules = {
  maxPlayers: number
  startingHandSize: number
  mercyHandLimit: number
  stackingDrawCards: boolean
  allowDrawUntilPlayable: boolean
  forcePlayDrawnCard: boolean
  sevenSwap: boolean
  zeroRotate: boolean
  callUno: boolean
}

export type RoomSnapshot = {
  code: string
  status: RoomStatus
  hostPlayerId: string | null
  /**
   * The player who took first place in the most recent finished match. They
   * wear the crown, choose the seating for the next match, and are the one who
   * starts it. Null until a match has been won.
   */
  crownPlayerId: string | null
  /** Turn direction the next match will start with. */
  nextMatchDirection: Direction
  players: Player[]
  chatMessages: ChatMessage[]
  houseRules: HouseRules
  game: PublicGameSnapshot | null
  version: number
  createdAt: string
  updatedAt: string
}

export function createDefaultHouseRules(): HouseRules {
  return {
    maxPlayers: 8,
    startingHandSize: 7,
    mercyHandLimit: 25,
    stackingDrawCards: true,
    allowDrawUntilPlayable: false,
    forcePlayDrawnCard: false,
    sevenSwap: true,
    zeroRotate: true,
    callUno: true,
  }
}

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase()
}

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(normalizeRoomCode(value))
}
import type { Direction, PublicGameSnapshot } from "./game"
import type { ChatMessage } from "./chat"
