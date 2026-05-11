import { io, type Socket } from "socket.io-client"

import type {
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
  return import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4001"
}

export function getGameSocket(): GameSocket {
  socket ??= io(getRealtimeUrl(), {
    autoConnect: false,
    transports: ["websocket", "polling"],
  })

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
