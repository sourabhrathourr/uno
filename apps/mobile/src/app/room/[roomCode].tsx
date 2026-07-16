import type {
  AvatarReactionEmoji,
  Card,
  ChatMessage,
  GameError,
  PlayColor,
  Player,
  PlayerGameSnapshot,
  PlayerSocialSnapshot,
  RoomSnapshot,
  SendChatMessageInput,
  VoteKickChoice,
} from '@workspace/game';
import {
  AVATAR_REACTION_EMOJIS,
  isRoomCode,
  normalizeRoomCode,
} from '@workspace/game';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  LogOut,
  Mic,
  MicOff,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  ActivityIndicator,
  Alert,
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
import { PlayerAvatar } from '@/components/player-avatar';
import { RoomSocialSheet } from '@/components/room-social-sheet';
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
import { availableSupportCandidates } from '@/lib/social';
import {
  playCardSound,
  playFx,
  playShuffleSound,
  playWinnerSound,
  useSoundSystem,
} from '@/lib/sound';
import { useRoomVoice, type RoomVoiceController } from '@/lib/use-room-voice';

const colorOptions: PlayColor[] = ['red', 'yellow', 'green', 'blue'];

function impact(kind: 'light' | 'medium' | 'selection' | 'error') {
  if (kind === 'selection')
    return Haptics.selectionAsync().catch(() => undefined);
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
  const [playerSocial, setPlayerSocial] = useState<PlayerSocialSnapshot | null>(
    null,
  );
  const [supportView, setSupportView] = useState<PlayerGameSnapshot | null>(
    null,
  );
  const [socialOpen, setSocialOpen] = useState(false);
  const [seenSocialMessageIds, setSeenSocialMessageIds] = useState(
    () => new Set<string>(),
  );
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
  const remainingAfterPlay =
    (playerGame?.hand.length ?? 0) - stagedCards.length;
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
  const voice = useRoomVoice({
    socket,
    roomCode,
    selfPlayerId: player?.id ?? null,
    players: room?.players ?? [],
  });
  const activeError = voice.error ?? error;
  const socialMessages = useMemo(
    () => [
      ...(room?.chatMessages ?? []),
      ...(playerSocial?.squadChatMessages ?? []),
    ],
    [room?.chatMessages, playerSocial?.squadChatMessages],
  );
  const unreadSocialCount = useMemo(
    () =>
      socialMessages.filter(
        (message) =>
          message.playerId !== player?.id &&
          !seenSocialMessageIds.has(message.id),
      ).length,
    [player?.id, seenSocialMessageIds, socialMessages],
  );
  const supportedPlayerId = room?.game?.supportLinks.find(
    (link) => link.supporterPlayerId === player?.id,
  )?.supportedPlayerId;
  const applyRoomSnapshot = useCallback((nextRoom: RoomSnapshot) => {
    setRoom((currentRoom) => {
      if (
        currentRoom?.code === nextRoom.code &&
        nextRoom.version < currentRoom.version
      ) {
        return currentRoom;
      }
      return nextRoom;
    });
  }, []);
  const markSocialMessagesRead = useCallback((messages: ChatMessage[]) => {
    setSeenSocialMessageIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const message of messages) {
        if (next.has(message.id)) continue;
        next.add(message.id);
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  /** +2 / +4 stack — take full penalty in one tap (server draws all at once). */
  const drawPenaltyTakeAmount = useMemo(() => {
    const g = room?.game;
    const ds = g?.drawStack;
    const pid = player?.id;
    if (!g || !ds || !pid) return null;
    if (g.pendingChoice || g.winnerPlayerId) return null;
    if (g.turnPlayerId !== pid || ds.targetPlayerId !== pid) return null;
    return ds.amount > 0 ? ds.amount : null;
  }, [room?.game, player?.id]);

  /** Wild “draw until color” — one reveal per tap via game:drawRouletteCard. */
  const roulettePickupColor = useMemo(() => {
    const g = room?.game;
    const pc = g?.pendingChoice;
    const pid = player?.id;
    if (!g || !pc || pc.type !== 'roulette-draw' || !pid) return null;
    if (g.winnerPlayerId) return null;
    if (pc.playerId !== pid || g.turnPlayerId !== pid) return null;
    return pc.color;
  }, [room?.game, player?.id]);

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
            applyRoomSnapshot(result.data.room);
            setPlayerGame(result.data.playerGame ?? null);
            setPlayerSocial(result.data.playerSocial ?? null);
            setSeenSocialMessageIds(
              new Set(
                [
                  ...result.data.room.chatMessages,
                  ...(result.data.playerSocial?.squadChatMessages ?? []),
                ].map((message) => message.id),
              ),
            );
            void saveActiveRoomSeat(
              result.data.room.code,
              result.data.player.id,
            );
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
    [applyRoomSnapshot, playerName, roomCode],
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
          applyRoomSnapshot(result.data);
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
  }, [applyRoomSnapshot, roomCode]);

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
      applyRoomSnapshot(snapshot);
    }

    function handlePlayerState(snapshot: PlayerGameSnapshot) {
      setPlayerGame(snapshot);
    }

    function handlePlayerSocial(snapshot: PlayerSocialSnapshot) {
      setPlayerSocial(snapshot);
    }

    function handleError(nextError: GameError) {
      setError(nextError.message);
    }

    activeSocket.on('connect', handleConnect);
    activeSocket.on('disconnect', handleDisconnect);
    activeSocket.on('room:snapshot', handleSnapshot);
    activeSocket.on('game:playerState', handlePlayerState);
    activeSocket.on('room:playerSocial', handlePlayerSocial);
    activeSocket.on('room:error', handleError);
    if (!activeSocket.connected) activeSocket.connect();

    return () => {
      activeSocket.off('connect', handleConnect);
      activeSocket.off('disconnect', handleDisconnect);
      activeSocket.off('room:snapshot', handleSnapshot);
      activeSocket.off('game:playerState', handlePlayerState);
      activeSocket.off('room:playerSocial', handlePlayerSocial);
      activeSocket.off('room:error', handleError);
    };
  }, [applyRoomSnapshot, joinRoom, playerName, roomCode, sessionReady]);

  useEffect(() => {
    if (!socket || !supportedPlayerId || room?.status !== 'playing') {
      setSupportView(null);
      return;
    }

    let cancelled = false;
    socket.emit('game:getSupportView', (result) => {
      if (cancelled) return;
      setSupportView(
        result.ok && result.data?.playerId === supportedPlayerId
          ? result.data
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [room?.status, room?.version, socket, supportedPlayerId]);

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
          void impact(
            nextEvent.targetPlayerId === player?.id ? 'error' : 'medium',
          );
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
    event:
      | 'room:setReady'
      | 'room:start'
      | 'room:restart'
      | 'game:drawOne'
      | 'game:endTurn'
      | 'game:takeDrawPenalty'
      | 'game:drawRouletteCard',
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

  function handleRoomAck(
    result: { ok: true; data: RoomSnapshot } | { ok: false; error: GameError },
  ) {
    if (!result.ok) {
      setError(result.error.message);
      void impact('error');
      playFx('blocked', { volume: 0.5 });
      return;
    }

    applyRoomSnapshot(result.data);
  }

  function sendChatMessage(input: SendChatMessageInput) {
    if (!socket) return;
    setError(null);
    socket.emit('room:sendChatMessage', input, handleRoomAck);
  }

  function startVoteKick(targetPlayerId: string) {
    if (!socket) return;
    setError(null);
    socket.emit('room:startVoteKick', { targetPlayerId }, handleRoomAck);
  }

  function castVoteKick(voteKickId: string, choice: VoteKickChoice) {
    if (!socket) return;
    setError(null);
    socket.emit('room:castVoteKick', { voteKickId, choice }, handleRoomAck);
  }

  function supportPlayer(supportedId: string) {
    if (!socket) return;
    setError(null);
    socket.emit(
      'game:supportPlayer',
      { supportedPlayerId: supportedId },
      handleRoomAck,
    );
  }

  function kickSupporter(supporterPlayerId: string) {
    if (!socket) return;
    setError(null);
    socket.emit('game:kickSupporter', { supporterPlayerId }, handleRoomAck);
  }

  function sendAvatarReaction(body: AvatarReactionEmoji) {
    if (!socket) return;
    socket.emit('game:sendAvatarEmojiReaction', { body }, handleRoomAck);
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
      applyRoomSnapshot(result.data);
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
        applyRoomSnapshot(result.data);
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
        <Text style={styles.copy}>
          This link is missing a 6-character room code.
        </Text>
        <Pressable
          onPress={() => router.replace('/')}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonLabel}>Back to lobby</Text>
        </Pressable>
      </ScreenShell>
    );
  }

  if (isPlaying && room && player) {
    return (
      <>
        <GamePlayScreen
          room={room}
          player={player}
          playerGame={playerGame}
          playerSocial={playerSocial}
          supportView={supportView}
          soundEnabled={sound.enabled}
          onToggleSound={() => {
            const next = !sound.enabled;
            sound.setEnabled(next);
            playFx(next ? 'toggleOn' : 'toggleOff', { volume: 0.5 });
            void impact('light');
          }}
          onBack={() => router.back()}
          onOpenSocial={() => setSocialOpen(true)}
          unreadSocialCount={unreadSocialCount}
          onSupportPlayer={supportPlayer}
          onSendAvatarReaction={sendAvatarReaction}
          voice={voice}
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
          drawPenaltyTakeAmount={drawPenaltyTakeAmount}
          roulettePickupColor={roulettePickupColor}
          onTakeDrawPenalty={() => {
            void impact('medium');
            playCardSound('draw');
            emitRoomCommand('game:takeDrawPenalty');
          }}
          onRoulettePickup={() => {
            void impact('light');
            playCardSound('draw');
            emitRoomCommand('game:drawRouletteCard');
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
          error={activeError}
        />
        <RoomSocialSheet
          visible={socialOpen}
          room={room}
          selfPlayerId={player.id}
          playerSocial={playerSocial}
          seenMessageIds={seenSocialMessageIds}
          onClose={() => setSocialOpen(false)}
          onReadMessages={markSocialMessagesRead}
          onSendMessage={sendChatMessage}
          onStartVoteKick={startVoteKick}
          onCastVoteKick={castVoteKick}
          onKickSupporter={kickSupporter}
          onReact={sendAvatarReaction}
        />
      </>
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
                voice={voice}
                onOpenSocial={() => setSocialOpen(true)}
                unreadSocialCount={unreadSocialCount}
              />
            ) : room.status === 'finished' && player ? (
              <ResultsPanel
                room={room}
                selfPlayerId={player.id}
                onRestart={() => emitRoomCommand('room:restart')}
                onOpenSocial={() => setSocialOpen(true)}
                unreadSocialCount={unreadSocialCount}
              />
            ) : (
              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>The table is syncing.</Text>
              </View>
            )
          ) : null}

          {activeError && player ? (
            <Text style={styles.error}>{activeError}</Text>
          ) : null}
        </ScrollView>
        {room && player ? (
          <RoomSocialSheet
            visible={socialOpen}
            room={room}
            selfPlayerId={player.id}
            playerSocial={playerSocial}
            seenMessageIds={seenSocialMessageIds}
            onClose={() => setSocialOpen(false)}
            onReadMessages={markSocialMessagesRead}
            onSendMessage={sendChatMessage}
            onStartVoteKick={startVoteKick}
            onCastVoteKick={castVoteKick}
            onKickSupporter={kickSupporter}
            onReact={sendAvatarReaction}
          />
        ) : null}
      </SafeAreaView>
    </View>
  );
}

function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <SafeAreaView style={[styles.safe, styles.shell]}>
        {children}
      </SafeAreaView>
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
        {room
          ? `${room.players.length}/${room.houseRules.maxPlayers} seated`
          : 'Loading table'}
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
  voice,
  onOpenSocial,
  unreadSocialCount,
}: {
  room: RoomSnapshot;
  player: Player | null;
  isHost: boolean;
  onReady: () => void;
  onStart: () => void;
  onCopyInvite: () => void;
  inviteCopied: boolean;
  voice: RoomVoiceController;
  onOpenSocial: () => void;
  unreadSocialCount: number;
}) {
  const self = room.players.find((candidate) => candidate.id === player?.id);
  const activeLobbyPlayers = room.players.filter(
    (candidate) =>
      !room.voteKick.lobbyVoteKickedPlayerIds.includes(candidate.id),
  );
  const nonHostPlayers = activeLobbyPlayers.filter(
    (candidate) => candidate.id !== room.hostPlayerId,
  );
  const readyNonHostCount = nonHostPlayers.filter(
    (candidate) => candidate.ready,
  ).length;
  const allNonHostsReady =
    nonHostPlayers.length > 0 && readyNonHostCount === nonHostPlayers.length;
  const canStart =
    isHost &&
    activeLobbyPlayers.length >= 2 &&
    allNonHostsReady &&
    !room.voteKick.activeVoteKickId;
  const hostIsWaitingAlone = isHost && nonHostPlayers.length === 0;
  const startLabel =
    activeLobbyPlayers.length < 2
      ? 'Need 2 players'
      : room.voteKick.activeVoteKickId
        ? 'Vote in progress'
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
          const voiceState = voice.voiceStates[candidate.id];
          const voteKicked = room.voteKick.lobbyVoteKickedPlayerIds.includes(
            candidate.id,
          );

          return (
            <View
              key={candidate.id}
              style={[styles.playerRow, voteKicked && styles.playerRowOut]}
            >
              <PlayerAvatar
                roomCode={room.code}
                players={room.players}
                playerId={candidate.id}
                size={36}
              />
              <View style={styles.playerMeta}>
                <Text style={styles.playerName}>{candidate.name}</Text>
                <Text style={styles.playerSubtext}>
                  {voteKicked
                    ? 'Vote-kicked for this match'
                    : candidate.connected
                      ? 'Online'
                      : 'Away'}
                  {candidateIsHost ? ' · Host' : ''}
                </Text>
              </View>
              <VoiceStatusPill state={voiceState} />
              <Text
                style={[
                  styles.readyText,
                  candidateReady && !voteKicked && styles.ready,
                  voteKicked && styles.outText,
                ]}
              >
                {voteKicked
                  ? 'Out'
                  : candidateIsHost
                    ? 'Host'
                    : candidate.ready
                      ? 'Ready'
                      : 'Waiting'}
              </Text>
            </View>
          );
        })}
      </View>

      {player ? (
        <View style={styles.lobbyActions}>
          <LobbyVoiceButton voice={voice} />
          <SocialButton
            onPress={onOpenSocial}
            unreadCount={unreadSocialCount}
            compact
          />
          {!isHost &&
          !room.voteKick.lobbyVoteKickedPlayerIds.includes(player.id) ? (
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

function ResultsPanel({
  room,
  selfPlayerId,
  onRestart,
  onOpenSocial,
  unreadSocialCount,
}: {
  room: RoomSnapshot;
  selfPlayerId: string;
  onRestart: () => void;
  onOpenSocial: () => void;
  unreadSocialCount: number;
}) {
  const game = room.game;
  const placements = [...(game?.winnerPlacements ?? [])].sort(
    (left, right) => left.position - right.position,
  );
  const placedIds = new Set(placements.map((placement) => placement.playerId));
  const orderedPlayers = [
    ...placements
      .map((placement) =>
        room.players.find((player) => player.id === placement.playerId),
      )
      .filter((player): player is Player => Boolean(player)),
    ...room.players.filter((player) => !placedIds.has(player.id)),
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.panelEyebrow}>Match complete</Text>
          <Text style={styles.sectionTitle}>Final table</Text>
        </View>
        <SocialButton onPress={onOpenSocial} unreadCount={unreadSocialCount} />
      </View>

      <View style={styles.resultList}>
        {orderedPlayers.map((candidate) => {
          const gamePlayer = game?.players.find(
            (state) => state.playerId === candidate.id,
          );
          const placement = gamePlayer?.winnerPlacement?.position;
          const status = !gamePlayer
            ? 'Ready for next match'
            : placement
              ? placement === 1
                ? 'Winner'
                : `Finished #${placement}`
              : gamePlayer.voteKicked
                ? 'Vote-kicked'
                : gamePlayer.waiting
                  ? 'Joined for next match'
                  : 'Eliminated';
          return (
            <View key={candidate.id} style={styles.resultRow}>
              <PlayerAvatar
                roomCode={room.code}
                players={room.players}
                playerId={candidate.id}
                size={42}
              />
              <View style={styles.playerMeta}>
                <Text style={styles.playerName}>
                  {candidate.name}
                  {candidate.id === selfPlayerId ? ' · You' : ''}
                </Text>
                <Text style={styles.playerSubtext}>{status}</Text>
              </View>
              <Text
                style={[
                  styles.resultPlace,
                  placement === 1 && styles.resultPlaceWinner,
                ]}
              >
                {placement ? `#${placement}` : '—'}
              </Text>
            </View>
          );
        })}
      </View>

      {game?.supportRecap ? <SupportRecapPanel room={room} /> : null}

      <Pressable onPress={onRestart} style={styles.primaryButton}>
        <Text style={styles.primaryButtonLabel}>Play another match</Text>
      </Pressable>
    </View>
  );
}

function SupportRecapPanel({ room }: { room: RoomSnapshot }) {
  const recap = room.game?.supportRecap;
  if (!recap || (recap.journey.length === 0 && recap.titles.length === 0)) {
    return null;
  }
  const name = (playerId: string) =>
    room.players.find((player) => player.id === playerId)?.name ?? 'Player';
  return (
    <View style={styles.recapPanel}>
      <Text style={styles.recapTitle}>Support recap</Text>
      {recap.journey.map((entry) => (
        <Text
          key={`${entry.supporterPlayerId}:${entry.supportedPlayerId}:${entry.createdAt}`}
          style={styles.recapCopy}
        >
          {name(entry.supporterPlayerId)} → {name(entry.supportedPlayerId)}
          {entry.endReason === 'supporter-kicked'
            ? ' · removed from squad'
            : entry.endReason === 'supported-player-inactive'
              ? ' · run ended'
              : ''}
        </Text>
      ))}
      {recap.titles.map((title) => (
        <Text
          key={`${title.label}:${title.playerId}`}
          style={styles.recapAward}
        >
          {title.label}: {name(title.playerId)} · {title.description}
        </Text>
      ))}
    </View>
  );
}

function GamePlayScreen({
  room,
  player,
  playerGame,
  playerSocial,
  supportView,
  soundEnabled,
  onToggleSound,
  onBack,
  onOpenSocial,
  unreadSocialCount,
  onSupportPlayer,
  onSendAvatarReaction,
  voice,
  stagedCards,
  stagedCardIds,
  canSubmitStagedCards,
  canStageCard,
  onToggleStage,
  onClearStage,
  onPlay,
  onDraw,
  drawPenaltyTakeAmount,
  roulettePickupColor,
  onTakeDrawPenalty,
  onRoulettePickup,
  onEndTurn,
  chosenColor,
  setChosenColor,
  compact,
  error,
}: {
  room: RoomSnapshot;
  player: Player;
  playerGame: PlayerGameSnapshot | null;
  playerSocial: PlayerSocialSnapshot | null;
  supportView: PlayerGameSnapshot | null;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onBack: () => void;
  onOpenSocial: () => void;
  unreadSocialCount: number;
  onSupportPlayer: (supportedPlayerId: string) => void;
  onSendAvatarReaction: (body: AvatarReactionEmoji) => void;
  voice: RoomVoiceController;
  stagedCards: Card[];
  stagedCardIds: string[];
  canSubmitStagedCards: boolean;
  canStageCard: (card: Card) => boolean;
  onToggleStage: (card: Card) => void;
  onClearStage: () => void;
  onPlay: () => void;
  onDraw: () => void;
  drawPenaltyTakeAmount: number | null;
  roulettePickupColor: PlayColor | null;
  onTakeDrawPenalty: () => void;
  onRoulettePickup: () => void;
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
  const isMyTurn = game?.turnPlayerId === player.id;
  const selfGame = game?.players.find(
    (candidate) => candidate.playerId === player.id,
  );
  const inactive = Boolean(
    selfGame?.eliminated ||
    selfGame?.voteKicked ||
    selfGame?.waiting ||
    selfGame?.winnerPlacement,
  );
  const needsColor = stagedCards.some((card) => card.color === 'wild');
  const rouletteHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [hiddenRouletteStagedKey, setHiddenRouletteStagedKey] = useState<
    string | null
  >(null);
  /** Match web: local selection wins when present; else server stagedPlay (play + roulette pickup projections). */
  const localStagedPlayActive = isMyTurn && stagedCards.length > 0;
  const stagedPlayKey = game?.stagedPlay
    ? `${game.stagedPlay.playerId}:${game.stagedPlay.cards
        .map((card) => card.id)
        .join('-')}`
    : null;
  const stagedPlayHidden =
    Boolean(stagedPlayKey) &&
    game?.stagedPlay?.kind === 'roulette' &&
    hiddenRouletteStagedKey === stagedPlayKey;
  const visibleStagedCards = localStagedPlayActive
    ? stagedCards
    : stagedPlayHidden
      ? []
      : (game?.stagedPlay?.cards ?? []);
  const canEditStaging =
    isMyTurn &&
    game?.pendingChoice?.type !== 'roulette-draw' &&
    (!game?.stagedPlay || game.stagedPlay.playerId === player.id);

  const rouletteActive = Boolean(roulettePickupColor);

  const deckDisabled = rouletteActive ? false : !playerGame?.canDraw;

  const deckPressHandler = rouletteActive ? onRoulettePickup : onDraw;

  useEffect(() => {
    if (rouletteHideTimerRef.current) {
      clearTimeout(rouletteHideTimerRef.current);
      rouletteHideTimerRef.current = null;
    }

    const stagedPlay = game?.stagedPlay;
    const pendingChoice = game?.pendingChoice;
    if (
      !stagedPlayKey ||
      !stagedPlay ||
      stagedPlay.kind !== 'roulette' ||
      pendingChoice?.type === 'roulette-draw'
    ) {
      if (pendingChoice?.type === 'roulette-draw') {
        setHiddenRouletteStagedKey(null);
      }
      return;
    }

    rouletteHideTimerRef.current = setTimeout(() => {
      setHiddenRouletteStagedKey(stagedPlayKey);
      rouletteHideTimerRef.current = null;
    }, 1100);

    return () => {
      if (rouletteHideTimerRef.current) {
        clearTimeout(rouletteHideTimerRef.current);
        rouletteHideTimerRef.current = null;
      }
    };
  }, [game?.pendingChoice, game?.stagedPlay, stagedPlayKey]);

  return (
    <View style={styles.gameRoot}>
      <SafeAreaView style={styles.gameSafe}>
        <View style={styles.gameFrame}>
          <TableControls
            soundEnabled={soundEnabled}
            onToggleSound={onToggleSound}
            onBack={onBack}
            onOpenSocial={onOpenSocial}
            unreadSocialCount={unreadSocialCount}
            voice={voice}
          />

          <View style={[styles.feltTable, compact && styles.feltTableCompact]}>
            <View style={styles.tableGrain} pointerEvents="none" />
            <TableSurfaceDetails />
            <SeatRing
              room={room}
              selfPlayerId={player.id}
              compact={compact}
              voiceStates={voice.voiceStates}
            />

            <View style={styles.tableHeader} pointerEvents="box-none">
              <View style={styles.tableHeaderLeft} pointerEvents="none">
                <Text style={styles.tableTurnText} numberOfLines={1}>
                  {activePlayer
                    ? isMyTurn
                      ? 'Your turn'
                      : `${activePlayer.name}'s turn`
                    : 'Table settling'}
                </Text>
                {game?.drawStack ? (
                  <Text style={styles.tableStackBadge}>
                    +{game.drawStack.amount}
                  </Text>
                ) : null}
              </View>
              <View style={styles.tableHeaderRight} pointerEvents="none">
                <DirectionPill direction={game?.direction ?? 1} />
                <ColorPill color={game?.currentColor ?? 'red'} />
              </View>
            </View>

            <View style={styles.tableCore}>
              <Pressable
                onPress={deckPressHandler}
                disabled={deckDisabled}
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

          {error ? (
            <Text style={styles.errorBanner} numberOfLines={2}>
              {error}
            </Text>
          ) : null}

          <AvatarReactionBar onReact={onSendAvatarReaction} />

          {inactive ? (
            <InactivePlayerDock
              room={room}
              selfPlayerId={player.id}
              selfGame={selfGame ?? null}
              playerSocial={playerSocial}
              supportView={supportView}
              onSupportPlayer={onSupportPlayer}
            />
          ) : (
            <>
              <View
                style={[styles.handDock, compact && styles.handDockCompact]}
              >
                <ScrollView
                  horizontal
                  style={styles.handScrollView}
                  removeClippedSubviews={false}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.handScroll}
                >
                  {(playerGame?.hand ?? [])
                    .filter((card) => !stagedCardIds.includes(card.id))
                    .map((card) => {
                      const stageable = canStageCard(card);
                      return (
                        <DraggableHandCard
                          key={card.id}
                          card={card}
                          disabled={!isMyTurn || !stageable}
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
                drawPenaltyTakeAmount={drawPenaltyTakeAmount}
                roulettePickupColor={roulettePickupColor}
                onPlay={onPlay}
                onDraw={onDraw}
                onTakeDrawPenalty={onTakeDrawPenalty}
                onRoulettePickup={onRoulettePickup}
                onEndTurn={onEndTurn}
              />
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function DeckPile({ drawPileCount }: { drawPileCount: number }) {
  return (
    <View style={styles.deckStack}>
      <View style={[styles.deckLayer, styles.deckLayerBack]} />
      <View style={[styles.deckLayer, styles.deckLayerMid]} />
      <View style={styles.deckCardFace}>
        <UnoCardMobile
          card={fallbackCard}
          size="sm"
          faceDown
          static
          noHaptics
        />
      </View>
      <Text style={styles.deckCount}>{drawPileCount}</Text>
    </View>
  );
}

function DiscardPile({ card }: { card: Card | null }) {
  return (
    <View style={styles.discardStack}>
      <View style={[styles.discardLayer, styles.discardLayerBack]} />
      <View style={[styles.discardLayer, styles.discardLayerMid]} />
      <View style={styles.discardCardFace}>
        <UnoCardMobile
          card={card ?? fallbackCard}
          size="sm"
          static
          noHaptics
          faceDown={!card}
        />
      </View>
    </View>
  );
}

function DirectionPill({ direction }: { direction: 1 | -1 }) {
  const clockwise = direction === 1;
  const Icon = clockwise ? RotateCw : RotateCcw;
  return (
    <View style={styles.statusPill}>
      <Icon color="rgba(255,253,244,0.78)" size={11} strokeWidth={2.2} />
      <Text style={styles.statusPillText}>{clockwise ? 'CW' : 'CCW'}</Text>
    </View>
  );
}

function ColorPill({ color }: { color: PlayColor }) {
  return (
    <View style={styles.statusPill}>
      <View style={[styles.statusPillDot, colorChipStyle(color)]} />
      <Text style={styles.statusPillText}>{color}</Text>
    </View>
  );
}

function TableControls({
  soundEnabled,
  onBack,
  onToggleSound,
  onOpenSocial,
  unreadSocialCount,
  voice,
}: {
  soundEnabled: boolean;
  onBack: () => void;
  onToggleSound: () => void;
  onOpenSocial: () => void;
  unreadSocialCount: number;
  voice: RoomVoiceController;
}) {
  const micOn = Boolean(voice.enabled && !voice.muted);
  const voiceActionLabel = getVoiceActionLabel(voice);

  return (
    <View style={styles.gameChrome}>
      <Pressable
        onPress={onBack}
        style={styles.chromeIconButton}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ArrowLeft color="#fff8ea" size={18} strokeWidth={2.4} />
      </Pressable>

      <View style={styles.chromeControls}>
        <SocialButton
          onPress={onOpenSocial}
          unreadCount={unreadSocialCount}
          compact
        />
        <Pressable
          onPress={voice.toggle}
          disabled={voice.connecting}
          style={[
            styles.chromeIconButton,
            micOn && styles.chromeButtonActive,
            voice.error && styles.chromeButtonError,
            voice.connecting && styles.disabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={voiceActionLabel}
        >
          {voice.connecting ? (
            <ActivityIndicator color="#fff8ea" size="small" />
          ) : micOn ? (
            <Mic color="#fff8ea" size={16} strokeWidth={2.4} />
          ) : (
            <MicOff
              color={voice.error ? '#ffd7d7' : '#ffb1b1'}
              size={16}
              strokeWidth={2.4}
            />
          )}
        </Pressable>
        <Pressable
          onPress={onToggleSound}
          style={[
            styles.chromeIconButton,
            soundEnabled && styles.chromeButtonActive,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            soundEnabled ? 'Mute sound effects' : 'Enable sound effects'
          }
        >
          {soundEnabled ? (
            <Volume2 color="#fff8ea" size={16} strokeWidth={2.4} />
          ) : (
            <VolumeX color="#fff8ea" size={16} strokeWidth={2.4} />
          )}
        </Pressable>
        <Pressable
          onPress={onBack}
          style={styles.chromeIconButton}
          accessibilityRole="button"
          accessibilityLabel="Leave game"
        >
          <LogOut color="#fff8ea" size={16} strokeWidth={2.4} />
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
  voiceStates,
}: {
  room: RoomSnapshot;
  selfPlayerId: string;
  compact: boolean;
  voiceStates: RoomVoiceController['voiceStates'];
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
        const voiceState = voiceStates[candidate.id];
        const supporterCount =
          game?.supportLinks.filter(
            (link) => link.supportedPlayerId === candidate.id,
          ).length ?? 0;
        const latestReaction = [...(game?.avatarEmojiReactions ?? [])]
          .reverse()
          .find(
            (reaction) =>
              (reaction.supportedPlayerId ?? reaction.playerId) ===
              candidate.id,
          );
        const seatStyle: ViewStyle = {
          left: `${position.left}%`,
          top: `${position.top}%`,
          marginLeft: -seatWidth / 2,
          marginTop: roomySeats ? -28 : -24,
          width: seatWidth,
        };
        const waiting = Boolean(gamePlayer?.waiting);
        const cardCountLabel = waiting
          ? 'Next'
          : gamePlayer?.eliminated || gamePlayer?.voteKicked
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
              <PlayerAvatar
                roomCode={room.code}
                players={room.players}
                playerId={candidate.id}
                size={denseSeats ? 28 : roomySeats ? 38 : 32}
              />
              <SeatReaction reaction={latestReaction} />
              <View
                style={[
                  styles.seatCountPill,
                  denseSeats && styles.seatCountPillDense,
                  waiting && styles.seatCountPillWaiting,
                  isTurn && styles.seatCountPillTurn,
                ]}
              >
                <Text
                  style={[
                    styles.seatCountText,
                    denseSeats && styles.seatCountTextDense,
                    waiting && styles.seatCountTextWaiting,
                    isTurn && styles.seatCountTextTurn,
                  ]}
                  numberOfLines={1}
                >
                  {cardCountLabel}
                </Text>
              </View>
              <SeatVoiceBadge state={voiceState} dense={denseSeats} />
            </View>
            <View style={styles.seatNamePlate}>
              {isTurn ? <View style={styles.seatTurnDot} /> : null}
              <Text
                style={[styles.seatName, denseSeats && styles.seatNameDense]}
                numberOfLines={1}
              >
                {isSelf ? 'You' : candidate.name}
              </Text>
              {supporterCount > 0 ? (
                <Text style={styles.seatSupporters}>+{supporterCount} 🙌</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SeatReaction({
  reaction,
}: {
  reaction:
    | NonNullable<RoomSnapshot['game']>['avatarEmojiReactions'][number]
    | undefined;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!reaction) {
      setVisible(false);
      return;
    }
    const remaining = 3500 - (Date.now() - Date.parse(reaction.createdAt));
    if (remaining <= 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [reaction]);

  if (!reaction || !visible) return null;
  return (
    <View style={styles.seatReaction}>
      <Text style={styles.seatReactionText}>{reaction.body}</Text>
    </View>
  );
}

function LobbyVoiceButton({ voice }: { voice: RoomVoiceController }) {
  const micOn = Boolean(voice.enabled && !voice.muted);
  const voiceActionLabel = getVoiceActionLabel(voice);

  return (
    <Pressable
      onPress={voice.toggle}
      disabled={voice.connecting}
      style={({ pressed }) => [
        styles.lobbyVoiceButton,
        micOn && styles.lobbyVoiceButtonActive,
        voice.error && styles.lobbyVoiceButtonError,
        (pressed || voice.connecting) && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={voiceActionLabel}
    >
      {voice.connecting ? (
        <ActivityIndicator color="#fff8ea" size="small" />
      ) : micOn ? (
        <Mic color="#fff8ea" size={17} strokeWidth={2.5} />
      ) : (
        <MicOff
          color={voice.error ? '#ffd7d7' : '#ffb1b1'}
          size={17}
          strokeWidth={2.5}
        />
      )}
    </Pressable>
  );
}

function SocialButton({
  onPress,
  unreadCount,
  compact = false,
}: {
  onPress: () => void;
  unreadCount: number;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={compact ? styles.socialButtonCompact : styles.socialButton}
      accessibilityRole="button"
      accessibilityLabel={
        unreadCount > 0
          ? `Open chat, ${unreadCount} unread messages`
          : 'Open chat'
      }
    >
      <Text style={styles.socialButtonLabel}>Chat</Text>
      {unreadCount > 0 ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function VoiceStatusPill({
  state,
}: {
  state: RoomVoiceController['voiceStates'][string] | undefined;
}) {
  const status = getVoiceStatus(state);
  const Icon = status.micLive ? Mic : MicOff;

  return (
    <View
      style={[
        styles.voiceStatusPill,
        status.micLive && styles.voiceStatusPillOn,
        status.speaking && styles.voiceStatusPillSpeaking,
      ]}
      accessibilityLabel={status.label}
    >
      <Icon
        color={
          status.speaking
            ? '#dfffee'
            : status.micLive
              ? '#fff8ea'
              : 'rgba(255,255,255,0.44)'
        }
        size={11}
        strokeWidth={2.5}
      />
      <Text
        style={[
          styles.voiceStatusPillText,
          status.micLive && styles.voiceStatusPillTextOn,
        ]}
        numberOfLines={1}
      >
        {status.shortLabel}
      </Text>
    </View>
  );
}

function SeatVoiceBadge({
  state,
  dense,
}: {
  state: RoomVoiceController['voiceStates'][string] | undefined;
  dense: boolean;
}) {
  const status = getVoiceStatus(state);
  const Icon = status.micLive ? Mic : MicOff;

  return (
    <View
      style={[
        styles.seatVoiceBadge,
        dense && styles.seatVoiceBadgeDense,
        status.micLive && styles.seatVoiceBadgeOn,
        status.speaking && styles.seatVoiceBadgeSpeaking,
      ]}
      accessibilityLabel={status.label}
    >
      <Icon
        color={
          status.speaking
            ? '#dfffee'
            : status.micLive
              ? '#fff8ea'
              : 'rgba(255,255,255,0.42)'
        }
        size={dense ? 8 : 9}
        strokeWidth={2.6}
      />
    </View>
  );
}

function getVoiceStatus(
  state: RoomVoiceController['voiceStates'][string] | undefined,
) {
  const enabled = Boolean(state?.enabled);
  const muted = !enabled || Boolean(state?.muted);
  const speaking = Boolean(state?.speaking && !muted);
  const micLive = enabled && !muted;

  return {
    micLive,
    speaking,
    label: speaking
      ? 'Speaking'
      : micLive
        ? 'Mic on'
        : enabled
          ? 'Muted'
          : 'Mic off',
    shortLabel: speaking ? 'Live' : micLive ? 'On' : enabled ? 'Muted' : 'Off',
  };
}

function getVoiceActionLabel(voice: RoomVoiceController) {
  if (voice.error) return voice.error;
  if (voice.connecting) return 'Connecting voice';
  if (!voice.enabled) return 'Join voice';
  if (voice.muted) return 'Unmute microphone';
  return 'Mute microphone';
}

function AvatarReactionBar({
  onReact,
}: {
  onReact: (body: AvatarReactionEmoji) => void;
}) {
  return (
    <View style={styles.avatarReactionBar}>
      {AVATAR_REACTION_EMOJIS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onReact(emoji)}
          style={styles.avatarReactionButton}
          accessibilityLabel={`React ${emoji}`}
        >
          <Text style={styles.avatarReactionEmoji}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function InactivePlayerDock({
  room,
  selfPlayerId,
  selfGame,
  playerSocial,
  supportView,
  onSupportPlayer,
}: {
  room: RoomSnapshot;
  selfPlayerId: string;
  selfGame: NonNullable<RoomSnapshot['game']>['players'][number] | null;
  playerSocial: PlayerSocialSnapshot | null;
  supportView: PlayerGameSnapshot | null;
  onSupportPlayer: (supportedPlayerId: string) => void;
}) {
  const supportLink = room.game?.supportLinks.find(
    (link) => link.supporterPlayerId === selfPlayerId,
  );
  const supportedPlayer = room.players.find(
    (player) => player.id === supportLink?.supportedPlayerId,
  );
  const candidates = availableSupportCandidates(
    room.game?.players ?? [],
    playerSocial?.blockedSupportedPlayerIds ?? [],
    selfPlayerId,
  );
  const status = selfGame?.voteKicked
    ? 'Vote-kicked'
    : selfGame?.waiting
      ? 'Waiting for next match'
      : selfGame?.winnerPlacement
        ? `Finished #${selfGame.winnerPlacement.position}`
        : 'Eliminated';

  function confirmSupport(playerId: string) {
    const candidate = room.players.find((player) => player.id === playerId);
    if (!candidate) return;
    Alert.alert(
      `Ride with ${candidate.name}?`,
      `You’ll see ${candidate.name}’s hand and join their private Squad chat. You cannot switch while they remain active.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Support',
          onPress: () => onSupportPlayer(candidate.id),
        },
      ],
    );
  }

  return (
    <View style={styles.inactiveDock}>
      <View style={styles.inactiveHeader}>
        <View>
          <Text style={styles.inactiveStatus}>{status}</Text>
          <Text style={styles.inactiveCopy}>
            {supportedPlayer
              ? `Supporting ${supportedPlayer.name} · read-only hand`
              : 'Choose an active player to support.'}
          </Text>
        </View>
        {supportedPlayer ? (
          <PlayerAvatar
            roomCode={room.code}
            players={room.players}
            playerId={supportedPlayer.id}
            size={36}
          />
        ) : null}
      </View>

      {supportView ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.supportHand}
        >
          {supportView.hand.map((card) => (
            <View key={card.id} style={styles.supportCard}>
              <UnoCardMobile card={card} size="sm" static noHaptics />
            </View>
          ))}
        </ScrollView>
      ) : !supportLink && candidates.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.supportCandidates}>
            {candidates.map((candidate) => {
              const identity = room.players.find(
                (player) => player.id === candidate.playerId,
              );
              if (!identity) return null;
              return (
                <Pressable
                  key={candidate.playerId}
                  onPress={() => confirmSupport(candidate.playerId)}
                  style={styles.supportCandidate}
                >
                  <PlayerAvatar
                    roomCode={room.code}
                    players={room.players}
                    playerId={candidate.playerId}
                    size={30}
                  />
                  <Text style={styles.supportCandidateName}>
                    {identity.name}
                  </Text>
                  <Text style={styles.supportCandidateAction}>Support</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <Text style={styles.inactiveEmpty}>
          {supportLink
            ? 'Updating the supported hand…'
            : 'No active players are available.'}
        </Text>
      )}
    </View>
  );
}

function StagingTray({
  cards,
  canEdit,
  compact,
  onCardPress,
  onClear,
}: {
  cards: Card[];
  canEdit: boolean;
  compact: boolean;
  onCardPress: (card: Card) => void;
  onClear: () => void;
}) {
  const visibleCards = cards.slice(0, compact ? 4 : 5);
  const isEmpty = cards.length === 0;
  const showClear = !isEmpty && canEdit;

  return (
    <View style={styles.stagingTray}>
      <View
        style={[
          styles.stagingDropArea,
          !isEmpty && styles.stagingDropAreaActive,
        ]}
      >
        {isEmpty ? (
          <Text style={styles.stagingPlaceholder}>
            Drag and drop cards here
          </Text>
        ) : (
          visibleCards.map((card, index) => (
            <Pressable
              key={card.id}
              onPress={() => canEdit && onCardPress(card)}
              disabled={!canEdit}
              style={[
                styles.stagedCardWrap,
                {
                  left: 8 + index * (compact ? 20 : 24),
                  zIndex: index,
                },
              ]}
            >
              <View style={styles.stagedCardScale}>
                <UnoCardMobile card={card} size="sm" static noHaptics />
              </View>
            </Pressable>
          ))
        )}
        {cards.length > visibleCards.length ? (
          <View style={styles.stagingOverflow}>
            <Text style={styles.stagingOverflowText}>
              +{cards.length - visibleCards.length}
            </Text>
          </View>
        ) : null}
        {showClear ? (
          <Pressable
            onPress={onClear}
            hitSlop={8}
            style={styles.stagingClear}
            accessibilityRole="button"
            accessibilityLabel="Clear staged cards"
          >
            <X color="#fff8ea" size={12} strokeWidth={2.6} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function DraggableHandCard({
  card,
  disabled,
  onToggle,
}: {
  card: Card;
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
      const shouldStage = event.translationY < -62 || event.velocityY < -620;
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
    zIndex: translateY.value !== 0 ? 30 : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.handCardShell, animatedStyle]}>
        <UnoCardMobile
          card={card}
          size="sm"
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
  drawPenaltyTakeAmount,
  roulettePickupColor,
  onPlay,
  onDraw,
  onTakeDrawPenalty,
  onRoulettePickup,
  onEndTurn,
}: {
  stagedCount: number;
  canPlay: boolean;
  playerGame: PlayerGameSnapshot | null;
  drawPenaltyTakeAmount: number | null;
  roulettePickupColor: PlayColor | null;
  onPlay: () => void;
  onDraw: () => void;
  onTakeDrawPenalty: () => void;
  onRoulettePickup: () => void;
  onEndTurn: () => void;
}) {
  const hasStagedCards = stagedCount > 0;
  const canPass = !hasStagedCards && Boolean(playerGame?.canEndTurn);
  const primaryLabel = hasStagedCards ? `Play ${stagedCount}` : 'End turn';
  const primaryEnabled = hasStagedCards ? canPlay : canPass;
  const PrimaryIcon = hasStagedCards ? Play : SkipForward;

  const isRoulettePickup = roulettePickupColor !== null && !hasStagedCards;
  const isDrawPenaltyTake =
    !isRoulettePickup &&
    drawPenaltyTakeAmount !== null &&
    drawPenaltyTakeAmount > 0 &&
    !hasStagedCards;

  const drawLabel = isRoulettePickup
    ? 'Pickup'
    : isDrawPenaltyTake
      ? `Take +${drawPenaltyTakeAmount}`
      : 'Draw';
  const drawEnabled = isRoulettePickup
    ? true
    : isDrawPenaltyTake
      ? true
      : Boolean(playerGame?.canDraw) && !hasStagedCards;
  const drawHandler = isRoulettePickup
    ? onRoulettePickup
    : isDrawPenaltyTake
      ? onTakeDrawPenalty
      : onDraw;

  return (
    <View style={styles.actionBar}>
      <Pressable
        onPress={drawHandler}
        disabled={!drawEnabled}
        style={({ pressed }) => [
          styles.actionButton,
          (isDrawPenaltyTake || isRoulettePickup) && styles.actionButtonPenalty,
          !drawEnabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Plus
          color={isDrawPenaltyTake || isRoulettePickup ? '#ffd7d7' : '#fff8ea'}
          size={17}
          strokeWidth={2.6}
        />
        <Text
          style={[
            styles.actionButtonText,
            (isDrawPenaltyTake || isRoulettePickup) &&
              styles.actionButtonPenaltyText,
          ]}
        >
          {drawLabel}
        </Text>
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
  chromeButtonActive: {
    backgroundColor: 'rgba(255,243,163,0.14)',
    borderColor: 'rgba(255,243,163,0.22)',
  },
  chromeButtonError: {
    backgroundColor: 'rgba(246,95,95,0.16)',
    borderColor: 'rgba(246,95,95,0.32)',
  },
  feltTable: {
    flex: 1,
    minHeight: 340,
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
    minHeight: 320,
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
  tableHeader: {
    position: 'absolute',
    top: 18,
    left: 18,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    zIndex: 4,
  },
  tableHeaderLeft: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tableHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tableTurnText: {
    flexShrink: 1,
    color: 'rgba(255,253,244,0.86)',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  tableStackBadge: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: 'rgba(246,95,95,0.18)',
    color: '#ffb1b1',
    fontSize: 10,
    fontWeight: '600',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.32)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillText: {
    color: 'rgba(255,253,244,0.78)',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.2,
    textTransform: 'capitalize',
  },
  statusPillDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  tableCore: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    marginBottom: 6,
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
    boxShadow:
      '0 0 0 1px rgba(255, 243, 163, 0.2), 0 10px 24px rgba(0, 0, 0, 0.36)',
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
  seatSupporters: {
    color: '#ffe4a3',
    fontSize: 7,
    fontWeight: '800',
  },
  seatName: {
    maxWidth: '100%',
    color: '#fffdf4',
    fontSize: 10,
    fontWeight: '600',
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
  seatCountPillWaiting: {
    backgroundColor: 'rgba(14,42,64,0.94)',
    borderColor: 'rgba(125,211,252,0.44)',
  },
  seatCountText: {
    color: '#fffdf4',
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  seatCountTextDense: {
    fontSize: 8,
  },
  seatCountTextTurn: {
    color: '#fff3a3',
  },
  seatVoiceBadge: {
    position: 'absolute',
    left: -6,
    bottom: -6,
    width: 17,
    height: 17,
    borderRadius: 8.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,7,5,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  seatVoiceBadgeDense: {
    left: -5,
    bottom: -5,
    width: 15,
    height: 15,
    borderRadius: 7.5,
  },
  seatVoiceBadgeOn: {
    borderColor: 'rgba(255,255,255,0.22)',
  },
  seatVoiceBadgeSpeaking: {
    borderColor: 'rgba(66,215,130,0.72)',
    backgroundColor: 'rgba(34,130,78,0.82)',
  },
  seatCountTextWaiting: {
    color: '#d8f3ff',
  },
  seatReaction: {
    position: 'absolute',
    left: -9,
    top: -15,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf4',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    zIndex: 30,
  },
  seatReactionText: {
    fontSize: 15,
  },
  stagingTray: {
    padding: 6,
    backgroundColor: 'transparent',
    zIndex: 5,
  },
  stagingDropArea: {
    position: 'relative',
    height: 76,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagingDropAreaActive: {
    backgroundColor: 'rgba(255,243,163,0.06)',
    borderColor: 'rgba(255,243,163,0.22)',
  },
  stagingClear: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 20,
  },
  stagingPlaceholder: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  stagedCardWrap: {
    position: 'absolute',
    bottom: 4,
  },
  stagedCardScale: {
    transform: [{ scale: 0.62 }],
    transformOrigin: 'bottom left',
  },
  stagingOverflow: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    minWidth: 26,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  stagingOverflowText: {
    color: '#fffdf4',
    fontSize: 11,
    fontWeight: '600',
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
  playerRowOut: {
    opacity: 0.56,
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
  outText: {
    color: '#ff9d9d',
  },
  voiceStatusPill: {
    minWidth: 56,
    height: 25,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.26)',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  voiceStatusPillOn: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  voiceStatusPillSpeaking: {
    borderColor: 'rgba(66,215,130,0.5)',
    backgroundColor: 'rgba(66,215,130,0.16)',
  },
  voiceStatusPillText: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 10,
    fontWeight: '800',
  },
  voiceStatusPillTextOn: {
    color: '#fff8ea',
  },
  lobbyActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  lobbyVoiceButton: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  lobbyVoiceButtonActive: {
    backgroundColor: 'rgba(255,243,163,0.14)',
    borderColor: 'rgba(255,243,163,0.22)',
  },
  lobbyVoiceButtonError: {
    backgroundColor: 'rgba(246,95,95,0.16)',
    borderColor: 'rgba(246,95,95,0.32)',
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
  socialButton: {
    minWidth: 58,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  socialButtonCompact: {
    minWidth: 48,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  socialButtonLabel: {
    color: '#fff8ea',
    fontSize: 10,
    fontWeight: '800',
  },
  unreadBadge: {
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f65f5f',
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },
  resultList: {
    gap: 6,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 8,
  },
  resultPlace: {
    minWidth: 34,
    color: 'rgba(255,255,255,0.48)',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  resultPlaceWinner: {
    color: '#fff3a3',
  },
  recapPanel: {
    gap: 5,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,221,85,0.16)',
    backgroundColor: 'rgba(255,221,85,0.07)',
    padding: 11,
  },
  recapTitle: {
    color: '#ffe887',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  recapCopy: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    lineHeight: 16,
  },
  recapAward: {
    color: '#fff3a3',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
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
  deckStack: {
    width: 78,
    height: 108,
    position: 'relative',
  },
  discardStack: {
    width: 78,
    height: 108,
    position: 'relative',
  },
  deckLayer: {
    position: 'absolute',
    width: 72,
    height: 102,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.55)',
    backgroundColor: '#0c0c10',
  },
  deckLayerBack: {
    left: 6,
    top: 0,
  },
  deckLayerMid: {
    left: 3,
    top: 3,
  },
  discardLayer: {
    position: 'absolute',
    width: 72,
    height: 102,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.34)',
  },
  discardLayerBack: {
    left: 6,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  discardLayerMid: {
    left: 3,
    top: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deckCardFace: {
    position: 'absolute',
    left: 0,
    top: 6,
    zIndex: 10,
  },
  discardCardFace: {
    position: 'absolute',
    left: 0,
    top: 6,
    zIndex: 10,
  },
  deckCount: {
    position: 'absolute',
    right: 8,
    bottom: 4,
    zIndex: 20,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: '#fff3a3',
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
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
  errorBanner: {
    color: '#ff9d9d',
    fontSize: 12,
    lineHeight: 15,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
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
    minHeight: 116,
    paddingLeft: 10,
    overflow: 'visible',
    zIndex: 20,
  },
  handDockCompact: {
    minHeight: 104,
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
  avatarReactionBar: {
    alignSelf: 'center',
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.055)',
    paddingHorizontal: 5,
    zIndex: 12,
  },
  avatarReactionButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarReactionEmoji: {
    fontSize: 18,
  },
  inactiveDock: {
    minHeight: 142,
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.15)',
    backgroundColor: 'rgba(125,211,252,0.065)',
    padding: 10,
    zIndex: 10,
  },
  inactiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  inactiveStatus: {
    color: '#d8f3ff',
    fontSize: 13,
    fontWeight: '900',
  },
  inactiveCopy: {
    color: 'rgba(216,243,255,0.58)',
    fontSize: 10,
    marginTop: 2,
  },
  inactiveEmpty: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    paddingVertical: 12,
    textAlign: 'center',
  },
  supportCandidates: {
    flexDirection: 'row',
    gap: 7,
  },
  supportCandidate: {
    minWidth: 132,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.24)',
    paddingHorizontal: 7,
  },
  supportCandidateName: {
    maxWidth: 56,
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  supportCandidateAction: {
    color: '#ffe887',
    fontSize: 9,
    fontWeight: '900',
  },
  supportHand: {
    gap: 7,
    paddingRight: 10,
  },
  supportCard: {
    transform: [{ scale: 0.66 }],
    width: 52,
    height: 75,
    transformOrigin: 'top left',
  },
  actionBar: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
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
  actionButtonPenalty: {
    backgroundColor: 'rgba(255,90,90,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,90,90,0.32)',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  actionButtonPenaltyText: {
    color: '#ffd7d7',
    fontWeight: '700',
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
    fontWeight: '700',
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
