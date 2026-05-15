import type {
  Card,
  GameError,
  PlayColor,
  Player,
  PlayerGameSnapshot,
  RoomSnapshot,
} from '@workspace/game';
import { isRoomCode, normalizeRoomCode } from '@workspace/game';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UnoCardMobile } from '@/components/uno-card-mobile';
import { Spacing } from '@/constants/theme';
import {
  getGameSocket,
  getInviteUrl,
  getRoomPreview,
  type GameSocket,
} from '@/lib/realtime';
import {
  getPlayerSessionId,
  getActivePlayerId,
  getSavedPlayerName,
  saveActiveRoomCode,
  saveActiveRoomSeat,
  savePlayerName,
} from '@/lib/session';

const colorOptions: PlayColor[] = ['red', 'yellow', 'green', 'blue'];

export default function RoomScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roomCode?: string | string[] }>();
  const roomCodeParam = Array.isArray(params.roomCode)
    ? params.roomCode[0]
    : params.roomCode;
  const roomCode = normalizeRoomCode(roomCodeParam ?? '');

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerGame, setPlayerGame] = useState<PlayerGameSnapshot | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [chosenColor, setChosenColor] = useState<PlayColor>('red');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [activePlayerId, setActivePlayerId] = useState('');
  const hasAutoJoinedRef = useRef(false);
  const joinAttemptRef = useRef(0);

  const currentPlayer = room?.players.find(
    (candidate) => candidate.id === player?.id,
  );
  const isHost = room?.hostPlayerId === player?.id;
  const selectedCard = playerGame?.hand.find(
    (card) => card.id === selectedCardId,
  );
  const playableIds = useMemo(
    () => new Set(playerGame?.playableCardIds ?? []),
    [playerGame?.playableCardIds],
  );
  const inviteUrl = room ? getInviteUrl(room.code) : getInviteUrl(roomCode);

  const joinRoom = useCallback(
    async (nameOverride?: string) => {
      if (!isRoomCode(roomCode)) {
        setError('This invite link does not include a valid room code.');
        return;
      }

      const cleanName = (nameOverride ?? playerName).trim();
      if (!cleanName) {
        setError('Enter your name to sit at this table.');
        return;
      }

      setJoining(true);
      setError(null);
      const attemptId = joinAttemptRef.current + 1;
      joinAttemptRef.current = attemptId;
      const joinTimeout = setTimeout(() => {
        if (joinAttemptRef.current !== attemptId) return;
        setJoining(false);
        setError('Could not confirm your seat. Try joining again.');
        hasAutoJoinedRef.current = false;
      }, 10000);

      try {
        await savePlayerName(cleanName);
        await saveActiveRoomCode(roomCode);

        const activeSocket = getGameSocket();
        setSocket(activeSocket);
        if (!activeSocket.connected) activeSocket.connect();

        activeSocket.emit(
          'room:join',
          {
            code: roomCode,
            playerName: cleanName,
            sessionId: await getPlayerSessionId(),
          },
          (result) => {
            if (joinAttemptRef.current !== attemptId) return;
            clearTimeout(joinTimeout);
            setJoining(false);
            if (!result.ok) {
              setError(result.error.message);
              hasAutoJoinedRef.current = false;
              return;
            }

            setPlayer(result.data.player);
            setActivePlayerId(result.data.player.id);
            setRoom(result.data.room);
            setPlayerGame(result.data.playerGame ?? null);
            void saveActiveRoomSeat(result.data.room.code, result.data.player.id);
          },
        );
      } catch (cause) {
        if (joinAttemptRef.current !== attemptId) return;
        clearTimeout(joinTimeout);
        setJoining(false);
        hasAutoJoinedRef.current = false;
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not join the room from this device.',
        );
      }
    },
    [playerName, roomCode],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const [savedName, savedPlayerId] = await Promise.all([
        getSavedPlayerName(),
        getActivePlayerId(roomCode),
      ]);
      if (cancelled) return;
      setPlayerName(savedName);
      setActivePlayerId(savedPlayerId);
      setSessionReady(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  useEffect(() => {
    if (!activePlayerId || player || !room) return;

    const restoredPlayer = room.players.find(
      (candidate) => candidate.id === activePlayerId,
    );
    if (!restoredPlayer?.connected) return;

    setPlayer(restoredPlayer);
    setJoining(false);
  }, [activePlayerId, player, room]);

  useEffect(() => {
    if (
      !sessionReady ||
      !playerName.trim() ||
      player ||
      joining ||
      hasAutoJoinedRef.current
    ) {
      return;
    }

    hasAutoJoinedRef.current = true;
    void joinRoom(playerName);
  }, [joining, joinRoom, player, playerName, sessionReady]);

  useEffect(() => {
    if (!isRoomCode(roomCode)) return;

    let cancelled = false;

    async function loadPreview() {
      try {
        const result = await getRoomPreview(roomCode);
        if (cancelled) return;
        if (result.ok) {
          setRoom(result.data);
        } else {
          setError(result.error.message);
        }
      } catch {
        if (!cancelled) setError('Could not load this table.');
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  useEffect(() => {
    const activeSocket = getGameSocket();
    setSocket(activeSocket);
    setConnected(activeSocket.connected);

    function handleConnect() {
      setConnected(true);
      if (sessionReady && playerName.trim()) {
        void joinRoom(playerName);
      }
    }

    function handleDisconnect() {
      setConnected(false);
    }

    function handleSnapshot(snapshot: RoomSnapshot) {
      if (snapshot.code !== roomCode) return;
      setRoom(snapshot);
    }

    function handlePlayerState(snapshot: PlayerGameSnapshot) {
      setPlayerGame(snapshot);
    }

    function handleError(nextError: GameError) {
      setError(nextError.message);
    }

    activeSocket.on('connect', handleConnect);
    activeSocket.on('disconnect', handleDisconnect);
    activeSocket.on('room:snapshot', handleSnapshot);
    activeSocket.on('game:playerState', handlePlayerState);
    activeSocket.on('room:error', handleError);
    if (!activeSocket.connected) activeSocket.connect();

    return () => {
      activeSocket.off('connect', handleConnect);
      activeSocket.off('disconnect', handleDisconnect);
      activeSocket.off('room:snapshot', handleSnapshot);
      activeSocket.off('game:playerState', handlePlayerState);
      activeSocket.off('room:error', handleError);
    };
  }, [joinRoom, playerName, roomCode, sessionReady]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;

      const activeSocket = getGameSocket();
      if (!activeSocket.connected) activeSocket.connect();
      if (sessionReady && playerName.trim()) {
        void joinRoom(playerName);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [joinRoom, playerName, sessionReady]);

  function emitRoomCommand(
    event: 'room:setReady' | 'room:start' | 'game:drawOne' | 'game:endTurn',
    payload?: { ready: boolean },
  ) {
    if (!socket) return;
    setError(null);

    if (event === 'room:setReady') {
      socket.emit(event, payload ?? { ready: true }, handleRoomAck);
      return;
    }

    socket.emit(event, handleRoomAck);
  }

  function handleRoomAck(result: { ok: true; data: RoomSnapshot } | { ok: false; error: GameError }) {
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    setRoom(result.data);
  }

  function playSelectedCard() {
    if (!socket || !selectedCardId || !selectedCard) return;
    setError(null);

    socket.emit(
      'game:playCards',
      {
        cardIds: [selectedCardId],
        declaredUno: (playerGame?.hand.length ?? 0) === 2,
        chosenColor: selectedCard.color === 'wild' ? chosenColor : undefined,
      },
      (result) => {
        if (!result.ok) {
          setError(result.error.message);
          return;
        }

        setSelectedCardId(null);
        setRoom(result.data);
      },
    );
  }

  async function shareInvite() {
    await Share.share({
      title: 'Join my UNO No Mercy table',
      message: `Join my UNO No Mercy table: ${inviteUrl}`,
      url: inviteUrl,
    });
  }

  async function copyInvite() {
    try {
      await Clipboard.setStringAsync(inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch {
      setInviteCopied(false);
      setError('Could not copy the invite link.');
    }
  }

  if (!isRoomCode(roomCode)) {
    return (
      <ScreenShell>
        <Text style={styles.title}>Bad invite</Text>
        <Text style={styles.copy}>This link is missing a 6-character room code.</Text>
        <Pressable onPress={() => router.replace('/')} style={styles.primaryButton}>
          <Text style={styles.primaryButtonLabel}>Back to lobby</Text>
        </Pressable>
      </ScreenShell>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.iconButton}>
            <Text style={styles.iconButtonLabel}>‹</Text>
          </Pressable>
          <View style={styles.roomIdentity}>
            <Text style={styles.kicker}>Room</Text>
            <Text style={styles.roomCode}>{roomCode}</Text>
          </View>
          <Pressable onPress={shareInvite} style={styles.shareButton}>
            <Text style={styles.shareButtonLabel}>Invite</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <StatusStrip connected={connected} room={room} />

          {!player ? (
            <JoinPanel
              playerName={playerName}
              setPlayerName={setPlayerName}
              joining={joining || !sessionReady}
              error={error}
              onJoin={() => void joinRoom()}
            />
          ) : null}

          {room ? (
            room.status === 'lobby' ? (
              <LobbyPanel
                room={room}
                player={player}
                isHost={isHost}
                onReady={() =>
                  emitRoomCommand('room:setReady', {
                    ready: !currentPlayer?.ready,
                  })
                }
                onStart={() => emitRoomCommand('room:start')}
                onCopyInvite={() => void copyInvite()}
                inviteCopied={inviteCopied}
              />
            ) : (
              <GameTable
                room={room}
                player={player}
                playerGame={playerGame}
                selectedCardId={selectedCardId}
                setSelectedCardId={setSelectedCardId}
                playableIds={playableIds}
                chosenColor={chosenColor}
                setChosenColor={setChosenColor}
              />
            )
          ) : null}

          {error && player ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {room?.status === 'playing' && player ? (
          <ActionBar
            selectedCard={selectedCard}
            playerGame={playerGame}
            onPlay={playSelectedCard}
            onDraw={() => emitRoomCommand('game:drawOne')}
            onEndTurn={() => emitRoomCommand('game:endTurn')}
          />
        ) : null}
      </SafeAreaView>
    </View>
  );
}

function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <SafeAreaView style={[styles.safe, styles.shell]}>{children}</SafeAreaView>
    </View>
  );
}

function StatusStrip({
  connected,
  room,
}: {
  connected: boolean;
  room: RoomSnapshot | null;
}) {
  return (
    <View style={styles.statusStrip}>
      <View style={[styles.dot, connected && styles.dotConnected]} />
      <Text style={styles.statusText}>{connected ? 'Live' : 'Connecting'}</Text>
      <Text style={styles.statusDivider}>·</Text>
      <Text style={styles.statusText}>
        {room ? `${room.players.length}/${room.houseRules.maxPlayers} seated` : 'Loading table'}
      </Text>
    </View>
  );
}

function JoinPanel({
  playerName,
  setPlayerName,
  joining,
  error,
  onJoin,
}: {
  playerName: string;
  setPlayerName: (value: string) => void;
  joining: boolean;
  error: string | null;
  onJoin: () => void;
}) {
  return (
    <View style={styles.joinPanel}>
      <Text style={styles.panelEyebrow}>Invite opened</Text>
      <Text style={styles.title}>Take your seat</Text>
      <Text style={styles.copy}>
        Use the same name on web and mobile to keep your seat when you switch
        devices.
      </Text>
      <TextInput
        value={playerName}
        onChangeText={setPlayerName}
        placeholder="Player name"
        placeholderTextColor="rgba(255,255,255,0.32)"
        maxLength={24}
        autoCapitalize="words"
        style={styles.input}
        returnKeyType="go"
        onSubmitEditing={onJoin}
      />
      <Pressable
        onPress={onJoin}
        disabled={joining}
        style={({ pressed }) => [
          styles.primaryButton,
          (pressed || joining) && styles.pressed,
        ]}
      >
        {joining ? (
          <ActivityIndicator color="#151006" />
        ) : (
          <Text style={styles.primaryButtonLabel}>Join table</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function LobbyPanel({
  room,
  player,
  isHost,
  onReady,
  onStart,
  onCopyInvite,
  inviteCopied,
}: {
  room: RoomSnapshot;
  player: Player | null;
  isHost: boolean;
  onReady: () => void;
  onStart: () => void;
  onCopyInvite: () => void;
  inviteCopied: boolean;
}) {
  const self = room.players.find((candidate) => candidate.id === player?.id);
  const nonHostPlayers = room.players.filter(
    (candidate) => candidate.id !== room.hostPlayerId,
  );
  const readyNonHostCount = nonHostPlayers.filter(
    (candidate) => candidate.ready,
  ).length;
  const allNonHostsReady =
    nonHostPlayers.length > 0 && readyNonHostCount === nonHostPlayers.length;
  const canStart = isHost && room.players.length >= 2 && allNonHostsReady;
  const hostIsWaitingAlone = isHost && nonHostPlayers.length === 0;
  const startLabel =
    room.players.length < 2
      ? 'Need 2 players'
      : canStart
        ? 'Start game'
        : `${readyNonHostCount}/${nonHostPlayers.length} ready`;
  const hostActionLabel = hostIsWaitingAlone
    ? inviteCopied
      ? 'Copied'
      : 'Copy invite link'
    : startLabel;

  return (
    <View style={styles.panel}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.panelEyebrow}>Lobby</Text>
          <Text style={styles.sectionTitle}>Players at the table</Text>
        </View>
        <Text style={styles.rulePill}>
          {room.houseRules.startingHandSize} card start
        </Text>
      </View>

      <View style={styles.playerList}>
        {room.players.map((candidate) => {
          const candidateIsHost = candidate.id === room.hostPlayerId;
          const candidateReady = candidateIsHost || candidate.ready;

          return (
            <View key={candidate.id} style={styles.playerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{candidate.name.slice(0, 1)}</Text>
              </View>
              <View style={styles.playerMeta}>
                <Text style={styles.playerName}>{candidate.name}</Text>
                <Text style={styles.playerSubtext}>
                  {candidate.connected ? 'Online' : 'Away'}
                  {candidateIsHost ? ' · Host' : ''}
                </Text>
              </View>
              <Text style={[styles.readyText, candidateReady && styles.ready]}>
                {candidateIsHost ? 'Host' : candidate.ready ? 'Ready' : 'Waiting'}
              </Text>
            </View>
          );
        })}
      </View>

      {player ? (
        <View style={styles.lobbyActions}>
          {!isHost ? (
            <Pressable
              onPress={onReady}
              style={({ pressed }) => [
                styles.secondaryButton,
                self?.ready && styles.secondaryButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>
                {self?.ready ? 'Unready' : 'Ready up'}
              </Text>
            </Pressable>
          ) : null}
          {isHost ? (
            <Pressable
              onPress={hostIsWaitingAlone ? onCopyInvite : onStart}
              disabled={!hostIsWaitingAlone && !canStart}
              style={({ pressed }) => [
                styles.primaryButton,
                styles.lobbyPrimaryButton,
                !hostIsWaitingAlone && !canStart && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>{hostActionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function GameTable({
  room,
  player,
  playerGame,
  selectedCardId,
  setSelectedCardId,
  playableIds,
  chosenColor,
  setChosenColor,
}: {
  room: RoomSnapshot | null;
  player: Player | null;
  playerGame: PlayerGameSnapshot | null;
  selectedCardId: string | null;
  setSelectedCardId: (id: string | null) => void;
  playableIds: Set<string>;
  chosenColor: PlayColor;
  setChosenColor: (color: PlayColor) => void;
}) {
  if (!room?.game) {
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Waiting for the first deal.</Text>
      </View>
    );
  }

  const activePlayer = room.players.find(
    (candidate) => candidate.id === room.game?.turnPlayerId,
  );
  const latestEvent = room.game.events.at(-1);
  const selectedCard = playerGame?.hand.find(
    (card) => card.id === selectedCardId,
  );

  return (
    <View style={styles.table}>
      <View style={styles.opponentRail}>
        {room.game.players
          .filter((candidate) => candidate.playerId !== player?.id)
          .map((candidate) => {
            const metadata = room.players.find(
              (roomPlayer) => roomPlayer.id === candidate.playerId,
            );
            const isTurn = candidate.playerId === room.game?.turnPlayerId;

            return (
              <View
                key={candidate.playerId}
                style={[styles.opponentSeat, isTurn && styles.turnSeat]}
              >
                <Text style={styles.opponentName} numberOfLines={1}>
                  {metadata?.name ?? 'Player'}
                </Text>
                <Text style={styles.opponentCards}>
                  {candidate.handCount} cards
                </Text>
              </View>
            );
          })}
      </View>

      <View style={styles.tableCenter}>
        <View style={styles.pileColumn}>
          <UnoCardMobile
            card={room.game.topDiscard ?? fallbackCard}
            size="md"
            static
            noHaptics
            faceDown={!room.game.topDiscard}
          />
          <Text style={styles.pileLabel}>Discard</Text>
        </View>

        <View style={styles.deckColumn}>
          <UnoCardMobile card={fallbackCard} size="sm" faceDown static noHaptics />
          <Text style={styles.deckCount}>{room.game.drawPileCount}</Text>
          <Text style={styles.pileLabel}>Draw pile</Text>
        </View>
      </View>

      <View style={styles.turnPanel}>
        <View
          style={[
            styles.colorChip,
            colorChipStyle(room.game.currentColor),
          ]}
        />
        <Text style={styles.turnText}>
          {activePlayer ? `${activePlayer.name}'s turn` : 'Turn pending'}
        </Text>
        {room.game.drawStack ? (
          <Text style={styles.stackText}>Stack +{room.game.drawStack.amount}</Text>
        ) : null}
      </View>

      {latestEvent ? (
        <Text style={styles.eventText} numberOfLines={2}>
          {latestEvent.message}
        </Text>
      ) : null}

      {selectedCard?.color === 'wild' ? (
        <View style={styles.colorPicker}>
          {colorOptions.map((color) => (
            <Pressable
              key={color}
              onPress={() => setChosenColor(color)}
              style={[
                styles.colorPickButton,
                colorChipStyle(color),
                chosenColor === color && styles.colorPickButtonActive,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${color}`}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.handDock}>
        <Text style={styles.handLabel}>Your hand</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.handScroll}
        >
          {(playerGame?.hand ?? []).map((card) => {
            const playable = playableIds.has(card.id);
            const selected = card.id === selectedCardId;
            return (
              <UnoCardMobile
                key={card.id}
                card={card}
                size="sm"
                raised={selected}
                disabled={!playable}
                onPress={() =>
                  setSelectedCardId(selected ? null : card.id)
                }
              />
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const fallbackCard: Card = {
  id: 'fallback-card-back',
  color: 'wild',
  face: { kind: 'wild' },
};

function ActionBar({
  selectedCard,
  playerGame,
  onPlay,
  onDraw,
  onEndTurn,
}: {
  selectedCard: Card | undefined;
  playerGame: PlayerGameSnapshot | null;
  onPlay: () => void;
  onDraw: () => void;
  onEndTurn: () => void;
}) {
  return (
    <View style={styles.actionBar}>
      <Pressable
        onPress={onDraw}
        disabled={!playerGame?.canDraw}
        style={({ pressed }) => [
          styles.actionButton,
          !playerGame?.canDraw && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.actionButtonText}>Draw</Text>
      </Pressable>
      <Pressable
        onPress={onPlay}
        disabled={!selectedCard}
        style={({ pressed }) => [
          styles.actionButtonPrimary,
          !selectedCard && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.actionButtonPrimaryText}>Play</Text>
      </Pressable>
      <Pressable
        onPress={onEndTurn}
        disabled={!playerGame?.canEndTurn}
        style={({ pressed }) => [
          styles.actionButton,
          !playerGame?.canEndTurn && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.actionButtonText}>Pass</Text>
      </Pressable>
    </View>
  );
}

function colorChipStyle(color: PlayColor) {
  switch (color) {
    case 'red':
      return styles.redChip;
    case 'yellow':
      return styles.yellowChip;
    case 'green':
      return styles.greenChip;
    case 'blue':
      return styles.blueChip;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07070b',
  },
  safe: {
    flex: 1,
  },
  shell: {
    padding: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.three,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  iconButtonLabel: {
    color: 'white',
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '300',
  },
  roomIdentity: {
    alignItems: 'center',
  },
  kicker: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  roomCode: {
    color: '#fffdf4',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
  },
  shareButton: {
    minWidth: 72,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  shareButtonLabel: {
    color: 'white',
    fontSize: 13,
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: 128,
    gap: Spacing.three,
  },
  statusStrip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#f65f5f',
  },
  dotConnected: {
    backgroundColor: '#42d782',
  },
  statusText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontWeight: '700',
  },
  statusDivider: {
    color: 'rgba(255,255,255,0.3)',
  },
  joinPanel: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  panel: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  panelEyebrow: {
    color: '#ffdd55',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fffdf4',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '800',
  },
  copy: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    paddingHorizontal: 14,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff3a3',
    paddingHorizontal: 16,
  },
  primaryButtonLabel: {
    color: '#141006',
    fontSize: 15,
    fontWeight: '800',
  },
  lobbyPrimaryButton: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  sectionTitle: {
    color: '#fffdf4',
    fontSize: 20,
    fontWeight: '800',
  },
  rulePill: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.68)',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  playerList: {
    gap: Spacing.two,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 8,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff3a3',
  },
  avatarText: {
    color: '#151006',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  playerMeta: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  playerSubtext: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 12,
    marginTop: 2,
  },
  readyText: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 12,
    fontWeight: '800',
  },
  ready: {
    color: '#42d782',
  },
  lobbyActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
  },
  secondaryButtonActive: {
    backgroundColor: 'rgba(66,215,130,0.18)',
    borderColor: 'rgba(66,215,130,0.22)',
  },
  secondaryButtonLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  table: {
    gap: Spacing.three,
  },
  opponentRail: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  opponentSeat: {
    flex: 1,
    minWidth: 78,
    borderRadius: 16,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  turnSeat: {
    borderColor: 'rgba(255,243,163,0.46)',
    backgroundColor: 'rgba(255,243,163,0.11)',
  },
  opponentName: {
    color: 'white',
    fontSize: 12,
    fontWeight: '800',
  },
  opponentCards: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 11,
    marginTop: 2,
  },
  tableCenter: {
    minHeight: 222,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#101014',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.three,
  },
  pileColumn: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  deckColumn: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  deckCount: {
    color: '#fff3a3',
    fontSize: 18,
    fontWeight: '900',
  },
  pileLabel: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  turnPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  colorChip: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  redChip: {
    backgroundColor: '#ce2b26',
  },
  yellowChip: {
    backgroundColor: '#f4d84f',
  },
  greenChip: {
    backgroundColor: '#278f53',
  },
  blueChip: {
    backgroundColor: '#255fd7',
  },
  turnText: {
    flex: 1,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  stackText: {
    color: '#ff9d9d',
    fontSize: 13,
    fontWeight: '900',
  },
  eventText: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 13,
    lineHeight: 18,
  },
  colorPicker: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.045)',
    padding: Spacing.two,
  },
  colorPickButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  colorPickButtonActive: {
    borderColor: '#ffffff',
  },
  handDock: {
    gap: Spacing.two,
  },
  handLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  handScroll: {
    alignItems: 'flex-end',
    gap: 10,
    paddingTop: 10,
    paddingBottom: 18,
    paddingRight: Spacing.three,
  },
  actionBar: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: 24,
    padding: 10,
    backgroundColor: 'rgba(15,15,18,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  actionButtonPrimary: {
    flex: 1.2,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff3a3',
  },
  actionButtonPrimaryText: {
    color: '#151006',
    fontSize: 14,
    fontWeight: '900',
  },
  error: {
    color: '#ff9d9d',
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.42,
  },
});
