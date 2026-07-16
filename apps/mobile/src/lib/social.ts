import type {
  ChatChannel,
  GifSearchResult,
  Player,
  PlayerGamePublic,
  RoomSnapshot,
  SendChatMessageInput,
} from '@workspace/game';

export type VoteKickTarget = {
  player: Player;
  cooldownExpiresAt: string | null;
};

export function gifChatInput(gif: GifSearchResult): SendChatMessageInput {
  return {
    kind: 'gif',
    body: gif.id,
    gifProvider: gif.provider,
  };
}

export function mentionablePlayersForChannel<T extends { id: string }>(
  players: T[],
  channel: ChatChannel,
  squadMemberIds: string[],
): T[] {
  if (channel === 'public') return players;
  const memberIds = new Set(squadMemberIds);
  return players.filter((player) => memberIds.has(player.id));
}

export function squadMemberIdsFor(
  room: RoomSnapshot,
  squadPlayerId: string | null | undefined,
): string[] {
  if (!squadPlayerId) return [];
  return [
    squadPlayerId,
    ...(room.game?.supportLinks
      .filter((link) => link.supportedPlayerId === squadPlayerId)
      .map((link) => link.supporterPlayerId) ?? []),
  ];
}

export function availableSupportCandidates(
  players: Pick<
    PlayerGamePublic,
    'playerId' | 'eliminated' | 'voteKicked' | 'waiting' | 'winnerPlacement'
  >[],
  blockedSupportedPlayerIds: string[],
  supporterPlayerId: string,
) {
  return players.filter(
    (player) =>
      player.playerId !== supporterPlayerId &&
      !player.eliminated &&
      !player.voteKicked &&
      !player.waiting &&
      !player.winnerPlacement &&
      !blockedSupportedPlayerIds.includes(player.playerId),
  );
}

export function canPlayerStartVoteKick(
  room: RoomSnapshot | null,
  playerId: string,
): boolean {
  if (!room || room.voteKick.activeVoteKickId) return false;
  if (room.status !== 'lobby' && room.status !== 'playing') return false;
  if (room.status === 'lobby') {
    return !room.voteKick.lobbyVoteKickedPlayerIds.includes(playerId);
  }
  const state = room.game?.players.find(
    (candidate) => candidate.playerId === playerId,
  );
  return Boolean(state && !state.voteKicked);
}

export function voteKickTargetsForRoom(
  room: RoomSnapshot | null,
  selfPlayerId: string,
): VoteKickTarget[] {
  if (!room) return [];
  const cooldownsByTarget = new Map(
    room.voteKick.cooldowns.map((cooldown) => [
      cooldown.targetPlayerId,
      cooldown.expiresAt,
    ]),
  );

  return room.players
    .filter((player) => {
      if (player.id === selfPlayerId) return false;
      if (room.status === 'lobby') {
        return !room.voteKick.lobbyVoteKickedPlayerIds.includes(player.id);
      }
      if (room.status !== 'playing') return false;
      const state = room.game?.players.find(
        (candidate) => candidate.playerId === player.id,
      );
      return Boolean(
        state &&
        !state.eliminated &&
        !state.voteKicked &&
        !state.waiting &&
        !state.winnerPlacement,
      );
    })
    .map((player) => ({
      player,
      cooldownExpiresAt: cooldownsByTarget.get(player.id) ?? null,
    }));
}
