import { Platform } from 'react-native';
import { io, type Socket } from 'socket.io-client';

import type {
  ClientToServerEvents,
  CommandResult,
  CreateRoomRequest,
  CreateRoomResponse,
  RoomSnapshot,
  ServerToClientEvents,
} from '@workspace/game';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const WEB_ORIGIN = 'https://unoo.space';

let socket: GameSocket | null = null;

export function getInviteUrl(roomCode: string): string {
  return `${WEB_ORIGIN}/room/${roomCode.toUpperCase()}`;
}

export function getRealtimeUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_SOCKET_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');

  if (__DEV__) {
    return Platform.OS === 'android'
      ? 'http://10.0.2.2:4001'
      : 'http://localhost:4001';
  }

  throw new Error('Missing EXPO_PUBLIC_SOCKET_URL for the mobile app.');
}

export function getGameSocket(): GameSocket {
  socket ??= io(getRealtimeUrl(), {
    autoConnect: false,
    transports: ['websocket', 'polling'],
  });

  return socket;
}

export async function createRoom(
  input: CreateRoomRequest,
): Promise<CommandResult<CreateRoomResponse>> {
  const response = await fetch(`${getRealtimeUrl()}/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return (await response.json()) as CommandResult<CreateRoomResponse>;
}

export async function getRoomPreview(
  code: string,
): Promise<CommandResult<RoomSnapshot>> {
  const response = await fetch(`${getRealtimeUrl()}/rooms/${code}`);
  return (await response.json()) as CommandResult<RoomSnapshot>;
}
