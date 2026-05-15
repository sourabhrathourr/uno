import AsyncStorage from '@react-native-async-storage/async-storage';

const PLAYER_SESSION_KEY = 'uno-no-mercy:player-session-id';
const PLAYER_NAME_KEY = 'uno-no-mercy:player-name';
const ACTIVE_ROOM_KEY = 'uno-no-mercy:active-room-code';
const PLAYER_IDS_BY_ROOM_KEY = 'uno-no-mercy:player-ids-by-room';

function createSessionId(): string {
  const cryptoRef = globalThis as unknown as {
    crypto?: { randomUUID?: () => string };
  };
  const uuid = cryptoRef.crypto?.randomUUID?.();
  if (uuid) return uuid;

  return `mobile-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export async function getPlayerSessionId(): Promise<string> {
  const existing = await AsyncStorage.getItem(PLAYER_SESSION_KEY);
  if (existing) return existing;

  const next = createSessionId();
  await AsyncStorage.setItem(PLAYER_SESSION_KEY, next);
  return next;
}

export async function getSavedPlayerName(): Promise<string> {
  return (await AsyncStorage.getItem(PLAYER_NAME_KEY)) ?? '';
}

export async function savePlayerName(name: string): Promise<void> {
  await AsyncStorage.setItem(PLAYER_NAME_KEY, name);
}

export async function getActiveRoomCode(): Promise<string> {
  return (await AsyncStorage.getItem(ACTIVE_ROOM_KEY)) ?? '';
}

export async function saveActiveRoomCode(code: string): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_ROOM_KEY, code.toUpperCase());
}

export async function getActivePlayerId(roomCode: string): Promise<string> {
  const normalizedRoomCode = roomCode.toUpperCase();
  const raw = await AsyncStorage.getItem(PLAYER_IDS_BY_ROOM_KEY);
  if (!raw) return '';

  try {
    const playerIdsByRoom = JSON.parse(raw) as Record<string, string>;
    return playerIdsByRoom[normalizedRoomCode] ?? '';
  } catch {
    await AsyncStorage.removeItem(PLAYER_IDS_BY_ROOM_KEY);
    return '';
  }
}

export async function saveActiveRoomSeat(
  roomCode: string,
  playerId: string,
): Promise<void> {
  const normalizedRoomCode = roomCode.toUpperCase();
  const raw = await AsyncStorage.getItem(PLAYER_IDS_BY_ROOM_KEY);
  let playerIdsByRoom: Record<string, string> = {};

  if (raw) {
    try {
      playerIdsByRoom = JSON.parse(raw) as Record<string, string>;
    } catch {
      playerIdsByRoom = {};
    }
  }

  playerIdsByRoom[normalizedRoomCode] = playerId;
  await AsyncStorage.multiSet([
    [ACTIVE_ROOM_KEY, normalizedRoomCode],
    [PLAYER_IDS_BY_ROOM_KEY, JSON.stringify(playerIdsByRoom)],
  ]);
}
