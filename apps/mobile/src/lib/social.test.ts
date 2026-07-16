import { describe, expect, it } from 'vitest';

import type { RoomSnapshot } from '@workspace/game';

import {
  availableSupportCandidates,
  gifChatInput,
  mentionablePlayersForChannel,
  squadMemberIdsFor,
  voteKickTargetsForRoom,
} from './social';

describe('mobile social parity', () => {
  it('sends server-approved GIF selections by provider and ID', () => {
    expect(
      gifChatInput({
        provider: 'giphy',
        id: 'victory-123',
        title: 'Victory dance',
        previewUrl: 'https://example.com/preview.webp',
        mediaUrl: 'https://example.com/original.webp',
        width: 480,
        height: 360,
      }),
    ).toEqual({
      kind: 'gif',
      body: 'victory-123',
      gifProvider: 'giphy',
    });
  });

  it('limits squad mentions to the supported player and supporters', () => {
    const players = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ];
    expect(
      mentionablePlayersForChannel(players, 'squad', ['b', 'c']).map(
        (player) => player.id,
      ),
    ).toEqual(['b', 'c']);
    expect(mentionablePlayersForChannel(players, 'public', ['b', 'c'])).toEqual(
      players,
    );
  });

  it('offers only active, unblocked players for support', () => {
    expect(
      availableSupportCandidates(
        [
          state('self', { eliminated: true }),
          state('active'),
          state('waiting', { waiting: true }),
          state('out', { voteKicked: true }),
          state('winner', {
            winnerPlacement: {
              playerId: 'winner',
              position: 1,
              createdAt: '2026-07-10T00:00:00.000Z',
            },
          }),
        ],
        ['active'],
        'self',
      ),
    ).toEqual([]);
  });

  it('projects squad membership and excludes waiting/out vote targets', () => {
    const room = fixtureRoom();
    expect(squadMemberIdsFor(room, 'active')).toEqual(['active', 'self']);
    expect(
      voteKickTargetsForRoom(room, 'self').map((target) => target.player.id),
    ).toEqual(['active']);
  });
});

function state(
  playerId: string,
  overrides: Partial<NonNullable<RoomSnapshot['game']>['players'][number]> = {},
) {
  return {
    playerId,
    handCount: 4,
    declaredUno: false,
    eliminated: false,
    voteKicked: false,
    waiting: false,
    winnerPlacement: null,
    connected: true,
    ready: true,
    ...overrides,
  };
}

function fixtureRoom(): RoomSnapshot {
  const players = ['self', 'active', 'waiting', 'out'].map((id, seat) => ({
    id,
    name: id,
    seat,
    ready: true,
    connected: true,
    joinedAt: '2026-07-10T00:00:00.000Z',
    lastSeenAt: '2026-07-10T00:00:00.000Z',
  }));
  return {
    code: 'ABC123',
    status: 'playing',
    hostPlayerId: 'active',
    players,
    chatMessages: [],
    voteKick: {
      activeVoteKickId: null,
      lobbyVoteKickedPlayerIds: [],
      cooldowns: [],
    },
    houseRules: {
      maxPlayers: 8,
      startingHandSize: 7,
      mercyHandLimit: 25,
      stackingDrawCards: true,
      allowDrawUntilPlayable: false,
      forcePlayDrawnCard: false,
      sevenSwap: true,
      zeroRotate: true,
      callUno: true,
    },
    game: {
      matchId: 'match',
      direction: 1,
      currentColor: 'red',
      turnPlayerId: 'active',
      topDiscard: null,
      drawPileCount: 20,
      discardPileCount: 1,
      drawStack: null,
      pendingChoice: null,
      stagedPlay: null,
      players: [
        state('self', { eliminated: true }),
        state('active'),
        state('waiting', { waiting: true }),
        state('out', { voteKicked: true }),
      ],
      events: [],
      winnerPlacements: [],
      winnerPlayerId: null,
      supportLinks: [
        {
          supporterPlayerId: 'self',
          supportedPlayerId: 'active',
          createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      avatarEmojiReactions: [],
      supportRecap: null,
    },
    version: 1,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}
