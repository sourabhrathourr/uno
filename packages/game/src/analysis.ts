import type { RoomStatus } from "./rooms"

export type AnalysisPlayerSummary = {
  name: string
  seat: number
  isHost: boolean
  ready: boolean
  connected: boolean
  joinedAt: string
  lastSeenAt: string
}

export type AnalysisRoomSummary = {
  code: string
  status: RoomStatus
  version: number
  createdAt: string
  updatedAt: string
  durationMs: number
  idleDurationMs: number
  playerCount: number
  connectedPlayerCount: number
  awayPlayerCount: number
  players: AnalysisPlayerSummary[]
  game: {
    currentTurnPlayer: string | null
    winner: string | null
    eventCount: number
    matchStartedAt: string | null
    matchFinishedAt: string | null
  } | null
}

export type AnalysisRoomsResponse = {
  generatedAt: string
  totals: {
    rooms: number
    playing: number
    lobby: number
    finished: number
    totalPlayers: number
    onlinePlayers: number
  }
  rooms: AnalysisRoomSummary[]
}
