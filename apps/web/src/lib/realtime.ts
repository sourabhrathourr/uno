import { io } from "socket.io-client"
import type { Socket } from "socket.io-client"

import type {
  AnalysisRoomsResponse,
  ClientToServerEvents,
  CommandResult,
  CreateRoomRequest,
  CreateRoomResponse,
  RoomSnapshot,
  ServerToClientEvents,
} from "@workspace/game"

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: GameSocket | null = null

export function getRealtimeUrl(): string {
  const configuredUrl = import.meta.env.VITE_SOCKET_URL?.trim()
  if (configuredUrl) return configuredUrl.replace(/\/$/, "")
  if (import.meta.env.DEV) return "http://localhost:4001"
  throw new Error("Missing VITE_SOCKET_URL for the deployed web app.")
}

export function getGameSocket(): GameSocket {
  socket ??= io(getRealtimeUrl(), {
    autoConnect: false,
    transports: ["websocket", "polling"],
  })

  if (import.meta.env.DEV && typeof window !== "undefined") {
    ;(window as unknown as { __gameSocket?: GameSocket }).__gameSocket = socket
  }

  return socket
}

export async function createRoom(
  input: CreateRoomRequest,
): Promise<CommandResult<CreateRoomResponse>> {
  const response = await fetch(`${getRealtimeUrl()}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })

  return (await response.json()) as CommandResult<CreateRoomResponse>
}

export async function getRoomPreview(
  code: string,
): Promise<CommandResult<RoomSnapshot>> {
  const response = await fetch(`${getRealtimeUrl()}/rooms/${code}`)
  return (await response.json()) as CommandResult<RoomSnapshot>
}

export async function getAnalysisRooms(): Promise<
  CommandResult<AnalysisRoomsResponse>
> {
  const response = await fetch(`${getRealtimeUrl()}/analysis/rooms`)
  return (await response.json()) as CommandResult<AnalysisRoomsResponse>
}
