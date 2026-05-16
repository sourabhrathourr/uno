import type {
  Card,
  GameError,
  PlayColor,
  Player,
  PlayerGameSnapshot,
  RoomSnapshot,
} from '@workspace/game';
import { isRoomCode, normalizeRoomCode } from '@workspace/game';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Mic,
  Play,
  Plus,
  Share2,
  SkipForward,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
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
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
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
import {
  playCardSound,
  playFx,
  playShuffleSound,
  playWinnerSound,
  useSoundSystem,
} from '@/lib/sound';

const colorOptions: PlayColor[] = ['red', 'yellow', 'green', 'blue'];

function impact(kind: 'light' | 'medium' | 'selection' | 'error') {
  if (kind === 'selection') return Haptics.selectionAsync().catch(() => undefined);
  if (kind === 'error') {
    return Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => undefined);
  }
  return Haptics.impactAsync(
    kind === 'medium'
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light,
  ).catch(() => undefined);
}

export default function RoomScreen() {
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const sound = useSoundSystem();
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
  const [stagedCardIds, setStagedCardIds] = useState<string[]>([]);
  const [chosenColor, setChosenColor] = useState<PlayColor>('red');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [activePlayerId, setActivePlayerId] = useState('');
  const hasAutoJoinedRef = useRef(false);
  const joinAttemptRef = useRef(0);
  const seenInitialGameSnapshotRef = useRef(false);
  const lastEventIdRef = useRef<string | null>(null);

  const currentPlayer = room?.players.find(
    (candidate) => candidate.id === player?.id,
  );
  const isHost = room?.hostPlayerId === player?.id;
  const isPlaying = room?.status === 'playing' && Boolean(player);
  const isMyTurn = room?.game?.turnPlayerId === player?.id;
  const stagedCards = useMemo(
    () => cardsInIdOrder(playerGame?.hand ?? [], stagedCardIds),
    [playerGame?.hand, stagedCardIds],
  );
  const selectedCardsCanPlay = canPlayStagedCards(
    stagedCards,
    playerGame?.playableCardIds ?? [],
    room?.game?.drawStack ?? null,
  );
  const remainingAfterPlay = (playerGame?.hand.length ?? 0) - stagedCards.length;
  const needsColor = stagedCards.some((card) => card.color === 'wild');
  const finishesWithForbiddenPower =
    remainingAfterPlay === 0 &&
    stagedCards.some((card) => isForbiddenFinalCard(card));
  const canSubmitStagedCards =
    Boolean(isMyTurn) &&
    stagedCards.length > 0 &&
    selectedCardsCanPlay &&
    !finishesWithForbiddenPower &&
    (!needsColor || Boolean(chosenColor));
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

  useEffect(() => {
    const game = room?.game;
    if (!game) {
      seenInitialGameSnapshotRef.current = false;
      lastEventIdRef.current = null;
      return;
    }

    const events = game.events;
    if (!seenInitialGameSnapshotRef.current) {
      seenInitialGameSnapshotRef.current = true;
      lastEventIdRef.current = events[events.length - 1]?.id ?? null;
      return;
    }

    if (events.length === 0) return;
    const lastSeenId = lastEventIdRef.current;
    const startIndex = lastSeenId
      ? events.findIndex((event) => event.id === lastSeenId) + 1
      : 0;
    if (startIndex <= 0) {
      lastEventIdRef.current = events[events.length - 1]?.id ?? null;
      return;
    }

    const newEvents = events.slice(startIndex);
    if (newEvents.length === 0) return;
    lastEventIdRef.current = newEvents[newEvents.length - 1]?.id ?? null;

    for (const nextEvent of newEvents) {
      const isSelfEvent = nextEvent.playerId === player?.id;
      switch (nextEvent.type) {
        case 'card-played':
          if (isSelfEvent) {
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => undefined);
          }
          break;
        case 'card-drawn':
          if (nextEvent.drawKind !== 'roulette-complete') {
            playCardSound('draw', nextEvent.cards?.length ?? 1);
          }
          if (isSelfEvent && nextEvent.drawKind === 'single') {
            void impact('light');
          }
          break;
        case 'draw-penalty':
          playCardSound('draw', Math.min(nextEvent.cards?.length ?? 1, 4));
          if (isSelfEvent) void impact('medium');
          break;
        case 'hand-swapped':
        case 'hands-rotated':
          playShuffleSound();
          void impact('medium');
          break;
        case 'uno-called':
          playFx('successBlip', { volume: 0.55 });
          if (isSelfEvent) {
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => undefined);
          }
          break;
        case 'uno-caught':
          playFx('blocked', { volume: 0.5 });
          void impact(nextEvent.targetPlayerId === player?.id ? 'error' : 'medium');
          break;
        case 'player-eliminated':
          playFx('blocked', { volume: 0.6 });
          if (isSelfEvent) void impact('error');
          break;
        case 'game-won': {
          const isFirstPlace =
            game.winnerPlacements.some(
              (placement) =>
                placement.playerId === nextEvent.playerId &&
                placement.position === 1,
            ) ?? false;
          playWinnerSound(isFirstPlace);
          if (isSelfEvent) {
            void Haptics.notificationAsync(
              isFirstPlace
                ? Haptics.NotificationFeedbackType.Success
                : Haptics.NotificationFeedbackType.Warning,
            ).catch(() => undefined);
          }
          break;
        }
        default:
          break;
      }
    }
  }, [room?.game, player?.id]);

  useEffect(() => {
    const hand = playerGame?.hand ?? [];
    setStagedCardIds((current) =>
      current.filter((cardId) => hand.some((card) => card.id === cardId)),
    );
  }, [playerGame?.hand]);

  useEffect(() => {
    if (isMyTurn) return;
    setStagedCardIds([]);
  }, [isMyTurn]);

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
      void impact('error');
      playFx('blocked', { volume: 0.5 });
      return;
    }

    setRoom(result.data);
  }

  function emitStageCards(cardIds: string[]) {
    if (!socket || !isMyTurn) return;
    socket.emit('game:stageCards', { cardIds }, (result) => {
      if (!result.ok) {
        setError(result.error.message);
        void impact('error');
        playFx('blocked', { volume: 0.5 });
        return;
      }

      setError(null);
      setRoom(result.data);
    });
  }

  function updateStagedCards(cardIds: string[]) {
    setStagedCardIds(cardIds);
    emitStageCards(cardIds);
  }

  function toggleStagedCard(card: Card) {
    if (!isMyTurn) {
      void impact('error');
      playFx('blocked', { volume: 0.5 });
      return;
    }

    const current = stagedCardIds;
    if (current.includes(card.id)) {
      const next = current.filter((cardId) => cardId !== card.id);
      void impact('selection');
      playFx('itemDeselect', { volume: 0.45 });
      updateStagedCards(next);
      return;
    }

    if (
      canStageCardWithSelection(
        card,
        stagedCards,
        playerGame?.playableCardIds ?? [],
        Boolean(isMyTurn),
        room?.game?.drawStack ?? null,
      )
    ) {
      void impact('selection');
      playFx('itemSelect', { volume: 0.48 });
      updateStagedCards([...current, card.id]);
      return;
    }

    void impact('error');
    playFx('blocked', { volume: 0.5 });
  }

  function clearStagedCards() {
    if (stagedCardIds.length === 0) return;
    void impact('selection');
    playFx('itemDeselect', { volume: 0.45 });
    updateStagedCards([]);
  }

  function playStagedCards() {
    if (!socket || !canSubmitStagedCards) {
      void impact('error');
      playFx('blocked', { volume: 0.5 });
      return;
    }
    setError(null);
    void impact('medium');
    playFx('successBling', { volume: 0.55 });
    playCardSound('play', stagedCardIds.length);

    const discardActionCard =
      stagedCards[0]?.face.kind === 'discard-color' ? stagedCards[0] : null;
    const discardExtraCardIds = discardActionCard
      ? stagedCards.slice(1).map((card) => card.id)
      : [];

    socket.emit(
      'game:playCards',
      {
        cardIds: discardActionCard ? [discardActionCard.id] : stagedCardIds,
        declaredUno: remainingAfterPlay === 1,
        chosenColor: needsColor ? chosenColor : undefined,
        discardCardIds: discardExtraCardIds.length
          ? discardExtraCardIds
          : undefined,
        topCardId: discardActionCard
          ? (stagedCards[stagedCards.length - 1]?.id ?? discardActionCard.id)
          : undefined,
      },
      (result) => {
        if (!result.ok) {
          setError(result.error.message);
          void impact('error');
          playFx('blocked', { volume: 0.5 });
          return;
        }

        setStagedCardIds([]);
        setRoom(result.data);
      },
    );
  }

  async function shareInvite() {
    void impact('light');
    playFx('buttonSoft', { volume: 0.45 });
    await Share.share({
      title: 'Join my UNO No Mercy table',
      message: `Join my UNO No Mercy table: ${inviteUrl}`,
      url: inviteUrl,
    });
  }

  async function copyInvite() {
    try {
      await Clipboard.setStringAsync(inviteUrl);
      void impact('selection');
      playFx('copy', { volume: 0.5 });
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

  if (isPlaying && room && player) {
    return (
      <GamePlayScreen
        room={room}
        player={player}
        playerGame={playerGame}
        connected={connected}
        soundEnabled={sound.enabled}
        onToggleSound={() => {
          const next = !sound.enabled;
          sound.setEnabled(next);
          playFx(next ? 'toggleOn' : 'toggleOff', { volume: 0.5 });
          void impact('light');
        }}
        onBack={() => router.back()}
        onShareInvite={shareInvite}
        stagedCards={stagedCards}
        stagedCardIds={stagedCardIds}
        canSubmitStagedCards={canSubmitStagedCards}
        canStageCard={(card) =>
          canStageCardWithSelection(
            card,
            stagedCards,
            playerGame?.playableCardIds ?? [],
            Boolean(isMyTurn),
            room.game?.drawStack ?? null,
          )
        }
        onToggleStage={toggleStagedCard}
        onClearStage={clearStagedCards}
        onPlay={playStagedCards}
        onDraw={() => {
          void impact('light');
          playCardSound('draw');
          emitRoomCommand('game:drawOne');
        }}
        onEndTurn={() => {
          void impact('light');
          playFx('successBling', { volume: 0.5 });
          emitRoomCommand('game:endTurn');
        }}
        chosenColor={chosenColor}
        setChosenColor={(color) => {
          setChosenColor(color);
          void impact('selection');
          playFx('itemSelect', { volume: 0.4 });
        }}
        compact={height < 760 || width < 390}
        error={error}
      />
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
              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>This hand is complete.</Text>
              </View>
            )
          ) : null}

          {error && player ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

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

function GamePlayScreen({
  room,
  player,
  playerGame,
  connected,
  soundEnabled,
  onToggleSound,
  onBack,
  onShareInvite,
  stagedCards,
  stagedCardIds,
  canSubmitStagedCards,
  canStageCard,
  onToggleStage,
  onClearStage,
  onPlay,
  onDraw,
  onEndTurn,
  chosenColor,
  setChosenColor,
  compact,
  error,
}: {
  room: RoomSnapshot;
  player: Player;
  playerGame: PlayerGameSnapshot | null;
  connected: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onBack: () => void;
  onShareInvite: () => void;
  stagedCards: Card[];
  stagedCardIds: string[];
  canSubmitStagedCards: boolean;
  canStageCard: (card: Card) => boolean;
  onToggleStage: (card: Card) => void;
  onClearStage: () => void;
  onPlay: () => void;
  onDraw: () => void;
  onEndTurn: () => void;
  chosenColor: PlayColor;
  setChosenColor: (color: PlayColor) => void;
  compact: boolean;
  error: string | null;
}) {
  const game = room.game;
  const activePlayer = room.players.find(
    (candidate) => candidate.id === game?.turnPlayerId,
  );
  const latestEvent = game?.events.at(-1);
  const isMyTurn = game?.turnPlayerId === player.id;
  const needsColor = stagedCards.some((card) => card.color === 'wild');
  const visibleStagedCards =
    game?.stagedPlay && game.stagedPlay.playerId !== player.id
      ? game.stagedPlay.cards
      : stagedCards;
  const visibleStagingPlayer = room.players.find(
    (candidate) => candidate.id === game?.stagedPlay?.playerId,
  );
  const canEditStaging =
    isMyTurn && (!game?.stagedPlay || game.stagedPlay.playerId === player.id);

  return (
    <View style={styles.gameRoot}>
      <SafeAreaView style={styles.gameSafe}>
        <View style={styles.gameFrame}>
          <TableControls
            connected={connected}
            soundEnabled={soundEnabled}
            onBack={onBack}
            onToggleSound={onToggleSound}
            onShareInvite={onShareInvite}
          />

          <View style={[styles.feltTable, compact && styles.feltTableCompact]}>
            <View style={styles.tableGrain} pointerEvents="none" />
            <TableSurfaceDetails />
            <SeatRing
              room={room}
              selfPlayerId={player.id}
              compact={compact}
            />

            <View style={styles.tableStatus}>
              <View style={[styles.colorChip, colorChipStyle(game?.currentColor ?? 'red')]} />
              <Text style={styles.tableStatusTitle} numberOfLines={1}>
                {activePlayer
                  ? isMyTurn
                    ? 'Your turn'
                    : `${activePlayer.name}'s turn`
                  : 'Table settling'}
              </Text>
              {game?.drawStack ? (
                <Text style={styles.stackText}>+{game.drawStack.amount}</Text>
              ) : null}
            </View>

            <View style={styles.tableCore}>
              <Pressable
                onPress={onDraw}
                disabled={!playerGame?.canDraw}
                style={({ pressed }) => [
                  styles.deckColumn,
                  pressed && styles.pressed,
                ]}
              >
                <DeckPile drawPileCount={game?.drawPileCount ?? 0} />
              </Pressable>

              <View style={styles.pileColumn}>
                <DiscardPile card={game?.topDiscard ?? null} />
              </View>
            </View>
          </View>

          <StagingTray
            cards={visibleStagedCards}
            playerName={
              visibleStagedCards.length
                ? (visibleStagingPlayer?.name ?? player.name)
                : null
            }
            canEdit={canEditStaging}
            compact={compact}
            onCardPress={onToggleStage}
            onClear={onClearStage}
          />

          {needsColor ? (
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

          <Text
            style={[styles.eventText, error && styles.eventError]}
            numberOfLines={2}
          >
            {error ?? latestEvent?.message ?? ' '}
          </Text>

          <View style={[styles.handDock, compact && styles.handDockCompact]}>
            <View style={styles.handHeader}>
              <Text style={styles.handLabel}>
                {stagedCards.length
                  ? `${stagedCards.length} staged`
                  : 'Your hand'}
              </Text>
              <Text style={styles.handHint}>
                {isMyTurn ? 'Tap or drag up' : 'Waiting'}
              </Text>
            </View>
            <ScrollView
              horizontal
              style={styles.handScrollView}
              removeClippedSubviews={false}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.handScroll}
            >
              {(playerGame?.hand ?? []).map((card) => {
                const staged = stagedCardIds.includes(card.id);
                const stageable = canStageCard(card);
                return (
                  <DraggableHandCard
                    key={card.id}
                    card={card}
                    staged={staged}
                    disabled={!isMyTurn || (!stageable && !staged)}
                    onToggle={onToggleStage}
                  />
                );
              })}
            </ScrollView>
          </View>

          <ActionBar
            stagedCount={stagedCards.length}
            canPlay={canSubmitStagedCards}
            playerGame={playerGame}
            onPlay={onPlay}
            onDraw={onDraw}
            onEndTurn={onEndTurn}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

function DeckPile({ drawPileCount }: { drawPileCount: number }) {
  return (
    <View style={styles.pileStack}>
      {[0, 1, 2, 3].map((layer) => (
        <View
          key={layer}
          style={[
            styles.deckLayer,
            {
              left: 12 - layer * 3,
              right: layer * 3,
              top: 12 - layer * 3,
              bottom: layer * 3,
              transform: [
                { translateX: layer * 3 },
                { translateY: layer * -3 },
              ],
            },
          ]}
        />
      ))}
      <View style={styles.pileCardFace}>
        <UnoCardMobile card={fallbackCard} size="sm" faceDown static noHaptics />
      </View>
      <Text style={styles.deckCount}>{drawPileCount}</Text>
    </View>
  );
}

function DiscardPile({ card }: { card: Card | null }) {
  return (
    <View style={styles.pileStack}>
      <View style={[styles.discardLayer, styles.discardLayerBack]} />
      <View style={[styles.discardLayer, styles.discardLayerMid]} />
      <View style={styles.pileCardFace}>
        <UnoCardMobile
          card={card ?? fallbackCard}
          size="sm"
          static
          noHaptics
          faceDown={!card}
        />
      </View>
      <Text style={styles.pileLabel}>Discard</Text>
    </View>
  );
}

function TableControls({
  connected,
  soundEnabled,
  onBack,
  onToggleSound,
  onShareInvite,
}: {
  connected: boolean;
  soundEnabled: boolean;
  onBack: () => void;
  onToggleSound: () => void;
  onShareInvite: () => void;
}) {
  return (
    <View style={styles.gameChrome}>
      <Pressable
        onPress={onBack}
        style={styles.chromeIconButton}
        accessibilityRole="button"
        accessibilityLabel="Leave table"
      >
        <ArrowLeft color="#fff8ea" size={18} strokeWidth={2.4} />
      </Pressable>

      <View style={styles.chromeControls}>
        <View style={styles.chromeStatus}>
          <View
            style={[
              styles.chromeStatusDot,
              connected && styles.chromeStatusDotLive,
            ]}
          />
        </View>
        <Pressable
          style={styles.chromeIconButton}
          accessibilityRole="button"
          accessibilityLabel="Microphone controls coming soon"
        >
          <Mic color="#fff8ea" size={16} strokeWidth={2.4} />
        </Pressable>
        <Pressable
          onPress={onToggleSound}
          style={[
            styles.chromeIconButton,
            soundEnabled && styles.chromeButtonActive,
          ]}
          accessibilityRole="button"
          accessibilityLabel={soundEnabled ? 'Mute sound effects' : 'Enable sound effects'}
        >
          {soundEnabled ? (
            <Volume2 color="#fff8ea" size={16} strokeWidth={2.4} />
          ) : (
            <VolumeX color="#fff8ea" size={16} strokeWidth={2.4} />
          )}
        </Pressable>
        <Pressable
          onPress={onShareInvite}
          style={styles.chromeIconButton}
          accessibilityRole="button"
          accessibilityLabel="Share invite"
        >
          <Share2 color="#fff8ea" size={16} strokeWidth={2.4} />
        </Pressable>
      </View>
    </View>
  );
}

function TableSurfaceDetails() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View style={styles.tableWebInset} />
      {Array.from({ length: 14 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.tableWoodStripe,
            {
              left: `${index * 7.6 - 2}%`,
              width: index % 2 === 0 ? 14 : 10,
              opacity: index % 2 === 0 ? 0.34 : 0.18,
            },
          ]}
        />
      ))}
      <View style={styles.tableOuterRail} />
    </View>
  );
}

function SeatRing({
  room,
  selfPlayerId,
  compact,
}: {
  room: RoomSnapshot;
  selfPlayerId: string;
  compact: boolean;
}) {
  const players = orderPlayersAroundSelf(room.players, selfPlayerId);
  const game = room.game;
  const total = Math.max(players.length, 2);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {players.map((candidate, index) => {
        const roomySeats = total <= 4;
        const denseSeats = total >= 6;
        const seatWidth = roomySeats
          ? compact
            ? 76
            : 84
          : denseSeats
            ? compact
              ? 56
              : 62
            : compact
              ? 64
              : 70;
        const position = tableSeatPosition(index, total, compact);
        const gamePlayer = game?.players.find(
          (snapshot) => snapshot.playerId === candidate.id,
        );
        const isSelf = candidate.id === selfPlayerId;
        const isTurn = game?.turnPlayerId === candidate.id;
        const seatStyle: ViewStyle = {
          left: `${position.left}%`,
          top: `${position.top}%`,
          marginLeft: -seatWidth / 2,
          marginTop: roomySeats ? -28 : -24,
          width: seatWidth,
        };
        const cardCountLabel = gamePlayer?.eliminated
          ? 'Out'
          : String(gamePlayer?.handCount ?? 0);

        return (
          <View
            key={candidate.id}
            style={[
              styles.seat,
              roomySeats && styles.seatRoomy,
              denseSeats && styles.seatDense,
              seatStyle,
              !candidate.connected && styles.seatAway,
            ]}
          >
            <View
              style={[
                styles.seatAvatar,
                roomySeats && styles.seatAvatarRoomy,
                denseSeats && styles.seatAvatarDense,
                isTurn && styles.seatAvatarTurn,
              ]}
            >
              <User
                color={isTurn ? '#141006' : 'rgba(255,255,255,0.72)'}
                size={denseSeats ? 15 : roomySeats ? 18 : 16}
                strokeWidth={2.1}
              />
              <View
                style={[
                  styles.seatCountPill,
                  denseSeats && styles.seatCountPillDense,
                  isTurn && styles.seatCountPillTurn,
                ]}
              >
                <Text
                  style={[
                    styles.seatCountText,
                    denseSeats && styles.seatCountTextDense,
                    isTurn && styles.seatCountTextTurn,
                  ]}
                  numberOfLines={1}
                >
                  {cardCountLabel}
                </Text>
              </View>
            </View>
            <View style={styles.seatNamePlate}>
              {isTurn ? <View style={styles.seatTurnDot} /> : null}
              <Text
                style={[styles.seatName, denseSeats && styles.seatNameDense]}
                numberOfLines={1}
              >
                {isSelf ? 'You' : candidate.name}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function StagingTray({
  cards,
  playerName,
  canEdit,
  compact,
  onCardPress,
  onClear,
}: {
  cards: Card[];
  playerName: string | null;
  canEdit: boolean;
  compact: boolean;
  onCardPress: (card: Card) => void;
  onClear: () => void;
}) {
  const visibleCards = cards.slice(0, compact ? 4 : 5);

  return (
    <View
      style={[
        styles.stagingTray,
        cards.length > 0 && styles.stagingTrayActive,
      ]}
    >
      <View style={styles.stagingHeader}>
        <View>
          <Text style={styles.stagingTitle}>
            {cards.length ? `${playerName ?? 'Player'} staging` : 'Staging area'}
          </Text>
          <Text style={styles.stagingMeta}>
            {cards.length
              ? `${cards.length} ready to play`
              : 'Tap cards or drag them here'}
          </Text>
        </View>
        {cards.length > 0 && canEdit ? (
          <Pressable
            onPress={onClear}
            style={styles.stagingClear}
            accessibilityRole="button"
            accessibilityLabel="Clear staged cards"
          >
            <X color="#fff8ea" size={13} strokeWidth={2.6} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.stagingCards}>
        {visibleCards.length > 0 ? (
          visibleCards.map((card, index) => (
            <Pressable
              key={card.id}
              onPress={() => canEdit && onCardPress(card)}
              disabled={!canEdit}
              style={[
                styles.stagedCardWrap,
                { left: index * (compact ? 28 : 34), zIndex: index },
              ]}
            >
              <UnoCardMobile
                card={card}
                size="sm"
                static
                noHaptics
                disabled={!canEdit}
              />
            </Pressable>
          ))
        ) : (
          <Text style={styles.stagingEmpty}>Drop cards here</Text>
        )}
        {cards.length > visibleCards.length ? (
          <View style={styles.stagingOverflow}>
            <Text style={styles.stagingOverflowText}>
              +{cards.length - visibleCards.length}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DraggableHandCard({
  card,
  staged,
  disabled,
  onToggle,
}: {
  card: Card;
  staged: boolean;
  disabled: boolean;
  onToggle: (card: Card) => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(8)
    .onBegin(() => {
      scale.value = withSpring(1.04, { damping: 18, stiffness: 260 });
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      const shouldStage =
        event.translationY < -62 || event.velocityY < -620;
      translateX.value = withSpring(0, { damping: 18, stiffness: 260 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 260 });
      scale.value = withSpring(1, { damping: 18, stiffness: 260 });

      if (shouldStage) runOnJS(onToggle)(card);
    })
    .onFinalize(() => {
      translateX.value = withSpring(0, { damping: 18, stiffness: 260 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 260 });
      scale.value = withSpring(1, { damping: 18, stiffness: 260 });
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    zIndex: translateY.value !== 0 ? 30 : staged ? 8 : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.handCardShell, animatedStyle]}>
        <UnoCardMobile
          card={card}
          size="sm"
          raised={staged}
          disabled={disabled}
          noHaptics
          onPress={() => onToggle(card)}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const fallbackCard: Card = {
  id: 'fallback-card-back',
  color: 'wild',
  face: { kind: 'wild' },
};

function ActionBar({
  stagedCount,
  canPlay,
  playerGame,
  onPlay,
  onDraw,
  onEndTurn,
}: {
  stagedCount: number;
  canPlay: boolean;
  playerGame: PlayerGameSnapshot | null;
  onPlay: () => void;
  onDraw: () => void;
  onEndTurn: () => void;
}) {
  const hasStagedCards = stagedCount > 0;
  const canPass = !hasStagedCards && Boolean(playerGame?.canEndTurn);
  const primaryLabel = hasStagedCards
    ? `Play ${stagedCount}`
    : canPass
      ? 'Pass'
      : 'Play';
  const primaryEnabled = hasStagedCards ? canPlay : canPass;
  const PrimaryIcon = canPass && !hasStagedCards ? SkipForward : Play;

  return (
    <View style={styles.actionBar}>
      <Pressable
        onPress={onDraw}
        disabled={!playerGame?.canDraw || hasStagedCards}
        style={({ pressed }) => [
          styles.actionButton,
          (!playerGame?.canDraw || hasStagedCards) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Plus color="#fff8ea" size={17} strokeWidth={2.6} />
        <Text style={styles.actionButtonText}>Draw</Text>
      </Pressable>
      <Pressable
        onPress={hasStagedCards ? onPlay : onEndTurn}
        disabled={!primaryEnabled}
        style={({ pressed }) => [
          styles.actionButtonPrimary,
          !primaryEnabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <PrimaryIcon color="#151006" size={17} strokeWidth={2.8} />
        <Text style={styles.actionButtonPrimaryText}>{primaryLabel}</Text>
      </Pressable>
    </View>
  );
}

type DrawStackSnapshot = NonNullable<RoomSnapshot['game']>['drawStack'];

function orderPlayersAroundSelf(players: Player[], selfPlayerId: string) {
  const sortedPlayers = [...players].sort((a, b) => a.seat - b.seat);
  const selfIndex = sortedPlayers.findIndex(
    (candidate) => candidate.id === selfPlayerId,
  );
  if (selfIndex < 0) return sortedPlayers;
  return [
    ...sortedPlayers.slice(selfIndex),
    ...sortedPlayers.slice(0, selfIndex),
  ];
}

function tableSeatPosition(index: number, total: number, compact: boolean) {
  const count = Math.max(total, 1);
  const angle = Math.PI / 2 + (index * Math.PI * 2) / count;
  const xRadius = compact ? 30 : 34;
  const yRadius = compact ? 32 : 35;

  return {
    left: 50 + Math.cos(angle) * xRadius,
    top: 50 + Math.sin(angle) * yRadius,
  };
}

function cardsInIdOrder(cards: Card[], cardIds: string[]) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return cardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is Card => Boolean(card));
}

function canStageCardWithSelection(
  card: Card,
  selectedCards: Card[],
  playableCardIds: string[],
  isMyTurn: boolean,
  drawStack: DrawStackSnapshot,
) {
  if (!isMyTurn) return false;
  if (selectedCards.some((selected) => selected.id === card.id)) return true;
  if (selectedCards.length === 0) return playableCardIds.includes(card.id);
  return canPlayStagedCards(
    [...selectedCards, card],
    playableCardIds,
    drawStack,
  );
}

function canPlayStagedCards(
  cards: Card[],
  playableCardIds: string[],
  drawStack: DrawStackSnapshot,
) {
  if (cards.length === 0) return false;
  if (cards.length === 1) return playableCardIds.includes(cards[0]?.id ?? '');
  if (drawStack) {
    return (
      canStackDrawCards(drawStack, cards, playableCardIds) &&
      cards.some((card) => playableCardIds.includes(card.id))
    );
  }
  if (isDiscardFirstStage(cards, playableCardIds)) return true;
  return (
    (sameNumberGroup(cards) ||
      sameDrawGroup(cards) ||
      sameActionGroup(cards)) &&
    cards.some((card) => playableCardIds.includes(card.id))
  );
}

function isDiscardFirstStage(cards: Card[], playableCardIds: string[]) {
  const discardCard = cards[0];
  if (!discardCard || discardCard.face.kind !== 'discard-color') return false;
  if (!playableCardIds.includes(discardCard.id)) return false;

  return cards
    .slice(1)
    .every(
      (card) =>
        card.face.kind !== 'discard-color' && card.color === discardCard.color,
    );
}

function canStackDrawCards(
  drawStack: NonNullable<DrawStackSnapshot>,
  cards: Card[],
  playableCardIds: string[],
) {
  const playableGroups = new Set(
    cards
      .filter((card) => playableCardIds.includes(card.id))
      .map((card) => drawGroupKey(card))
      .filter((key): key is string => Boolean(key)),
  );

  return cards.every((card) => {
    const amount = drawAmount(card);
    const group = drawGroupKey(card);

    return Boolean(
      amount &&
        amount >= drawStack.minimum &&
        group &&
        playableGroups.has(group),
    );
  });
}

function drawAmount(card: Card) {
  switch (card.face.kind) {
    case 'draw':
    case 'wild-draw':
    case 'wild-reverse-draw':
      return card.face.count;
    default:
      return null;
  }
}

function isForbiddenFinalCard(card: Card) {
  return card.face.kind !== 'number' && card.face.kind !== 'discard-color';
}

function sameNumberGroup(cards: Card[]) {
  const first = cards[0];
  if (!first || first.face.kind !== 'number') return false;
  const value = first.face.value;
  return cards.every(
    (card) => card.face.kind === 'number' && card.face.value === value,
  );
}

function sameDrawGroup(cards: Card[]) {
  const first = cards[0];
  const key = first ? drawGroupKey(first) : null;
  if (!key) return false;
  return cards.every((card) => drawGroupKey(card) === key);
}

function sameActionGroup(cards: Card[]) {
  const firstKind = cards[0]?.face.kind;
  if (
    firstKind !== 'skip' &&
    firstKind !== 'skip-everyone' &&
    firstKind !== 'reverse'
  ) {
    return false;
  }

  return cards.every((card) => card.face.kind === firstKind);
}

function drawGroupKey(card: Card) {
  switch (card.face.kind) {
    case 'draw':
      return `draw:${card.face.count}`;
    case 'wild-draw':
      return `wild-draw:${card.face.count}`;
    case 'wild-reverse-draw':
      return `wild-reverse-draw:${card.face.count}`;
    default:
      return null;
  }
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
  gameRoot: {
    flex: 1,
    backgroundColor: '#050506',
  },
  gameSafe: {
    flex: 1,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.one,
  },
  gameFrame: {
    flex: 1,
    gap: 7,
    overflow: 'visible',
  },
  gameChrome: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  chromeBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chromeBackLabel: {
    color: '#fffdf4',
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '300',
  },
  chromeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chromeIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chromeStatus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chromeStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#f65f5f',
  },
  chromeStatusDotLive: {
    backgroundColor: '#42d782',
  },
  chromeButton: {
    minWidth: 46,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chromeButtonActive: {
    backgroundColor: 'rgba(255,243,163,0.14)',
    borderColor: 'rgba(255,243,163,0.22)',
  },
  chromeButtonText: {
    color: '#fffdf4',
    fontSize: 11,
    fontWeight: '900',
  },
  feltTable: {
    flex: 1,
    minHeight: 286,
    maxHeight: 390,
    overflow: 'hidden',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#4b2917',
    experimental_backgroundImage:
      'linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 18%, rgba(0,0,0,0.18) 62%), repeating-linear-gradient(92deg, rgba(255,255,255,0.035) 0 10px, rgba(0,0,0,0.05) 10px 22px), linear-gradient(90deg, #5a341d, #7a4829 38%, #4b2917)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    zIndex: 1,
  },
  feltTableCompact: {
    minHeight: 268,
    borderRadius: 28,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  tableGrain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderRadius: 34,
  },
  tableWebInset: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 31,
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.32)',
  },
  tableOuterRail: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 8,
    bottom: 8,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.045)',
    backgroundColor: 'transparent',
  },
  tableWoodStripe: {
    position: 'absolute',
    top: -12,
    bottom: -12,
    backgroundColor: 'rgba(255,255,255,0.055)',
    transform: [{ rotate: '1.5deg' }],
  },
  tableStatus: {
    position: 'absolute',
    top: 74,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    maxWidth: '64%',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#2b160b',
    borderWidth: 1,
    borderColor: 'rgba(255,226,173,0.16)',
  },
  tableStatusTitle: {
    flexShrink: 1,
    color: '#fffdf4',
    fontSize: 12,
    fontWeight: '900',
  },
  tableCore: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.five,
  },
  seat: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  seatRoomy: {
    gap: 4,
  },
  seatDense: {
    gap: 2,
  },
  seatAway: {
    opacity: 0.52,
  },
  seatAvatar: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13,8,5,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.32)',
  },
  seatAvatarRoomy: {
    width: 40,
    height: 40,
    borderRadius: 13,
  },
  seatAvatarDense: {
    width: 30,
    height: 30,
    borderRadius: 10,
  },
  seatAvatarTurn: {
    backgroundColor: 'rgba(255,243,163,0.96)',
    borderColor: 'rgba(255,243,163,0.8)',
    boxShadow: '0 0 0 1px rgba(255, 243, 163, 0.2), 0 10px 24px rgba(0, 0, 0, 0.36)',
  },
  seatNamePlate: {
    maxWidth: '100%',
    minHeight: 13,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  seatName: {
    maxWidth: '100%',
    color: '#fffdf4',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 12,
    textShadowColor: 'rgba(0,0,0,0.72)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  seatNameDense: {
    fontSize: 9,
    lineHeight: 11,
  },
  seatTurnDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#fff3a3',
  },
  seatCountPill: {
    position: 'absolute',
    right: -6,
    top: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: 'rgba(10,7,5,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  seatCountPillDense: {
    right: -5,
    top: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
  },
  seatCountPillTurn: {
    backgroundColor: '#151006',
    borderColor: 'rgba(255,243,163,0.44)',
  },
  seatCountText: {
    color: '#fffdf4',
    fontSize: 9,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  seatCountTextDense: {
    fontSize: 8,
  },
  seatCountTextTurn: {
    color: '#fff3a3',
  },
  stagingTray: {
    minHeight: 112,
    borderRadius: 22,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 5,
  },
  stagingTrayActive: {
    backgroundColor: 'rgba(255,243,163,0.09)',
    borderColor: 'rgba(255,243,163,0.26)',
  },
  stagingHeader: {
    width: 112,
    minHeight: 88,
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  stagingTitle: {
    color: '#fffdf4',
    fontSize: 12,
    fontWeight: '900',
  },
  stagingMeta: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
    marginTop: 2,
  },
  stagingClear: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  stagingClearText: {
    color: '#fffdf4',
    fontSize: 10,
    fontWeight: '900',
  },
  stagingCards: {
    flex: 1,
    height: 104,
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  stagedCardWrap: {
    position: 'absolute',
    bottom: 1,
  },
  stagingEmpty: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    color: 'rgba(255,255,255,0.44)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  stagingOverflow: {
    position: 'absolute',
    right: 8,
    bottom: 35,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  stagingOverflowText: {
    color: '#fffdf4',
    fontSize: 12,
    fontWeight: '900',
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
  },
  deckColumn: {
    alignItems: 'center',
  },
  pileStack: {
    width: 94,
    height: 124,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckLayer: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.45)',
    backgroundColor: '#09090a',
  },
  discardLayer: {
    position: 'absolute',
    left: 11,
    right: 9,
    top: 10,
    bottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.34)',
  },
  discardLayerBack: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    transform: [{ translateX: 10 }, { translateY: 7 }],
  },
  discardLayerMid: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    transform: [{ translateX: 5 }, { translateY: 3 }],
  },
  pileCardFace: {
    position: 'absolute',
    left: 11,
    top: 11,
    zIndex: 10,
  },
  deckCount: {
    position: 'absolute',
    right: 8,
    bottom: 5,
    zIndex: 20,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.56)',
    color: '#fff3a3',
    fontSize: 12,
    fontWeight: '900',
  },
  pileLabel: {
    position: 'absolute',
    bottom: 2,
    zIndex: 20,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
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
    fontSize: 12,
    lineHeight: 15,
    minHeight: 30,
    textAlign: 'center',
  },
  eventError: {
    color: '#ff9d9d',
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
    gap: Spacing.one,
    minHeight: 128,
    borderRadius: 22,
    paddingTop: 10,
    paddingLeft: 10,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'visible',
    zIndex: 20,
  },
  handDockCompact: {
    minHeight: 116,
    paddingTop: 8,
  },
  handHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: Spacing.two,
  },
  handLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  handHint: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 11,
    fontWeight: '800',
  },
  handScrollView: {
    overflow: 'visible',
  },
  handScroll: {
    alignItems: 'flex-end',
    gap: 10,
    paddingTop: 8,
    paddingBottom: 18,
    paddingRight: Spacing.three,
    overflow: 'visible',
  },
  handCardShell: {
    alignSelf: 'flex-end',
  },
  actionBar: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: 24,
    padding: 8,
    backgroundColor: 'rgba(15,15,18,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 10,
  },
  actionButton: {
    flex: 1,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  actionButtonPrimary: {
    flex: 1.2,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
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
