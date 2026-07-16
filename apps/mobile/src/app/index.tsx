import type { Card, RoomSnapshot } from '@workspace/game';
import { isRoomCode, normalizeRoomCode } from '@workspace/game';
import { type Href, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UnoCardMobile } from '@/components/uno-card-mobile';
import { Spacing } from '@/constants/theme';
import { createRoom, getRoomPreview } from '@/lib/realtime';
import {
  getActiveRoomCode,
  getPlayerSessionId,
  getSavedPlayerName,
  saveActiveRoomCode,
  saveActiveRoomSeat,
  savePlayerName,
} from '@/lib/session';

const previewCards: Card[] = [
  { id: 'preview-blue-7', color: 'blue', face: { kind: 'number', value: 7 } },
  { id: 'preview-red-draw', color: 'red', face: { kind: 'draw', count: 4 } },
  { id: 'preview-wild', color: 'wild', face: { kind: 'wild-draw', count: 6 } },
];

function roomHref(code: string): Href {
  return ({
    pathname: '/room/[roomCode]',
    params: { roomCode: code },
  } as unknown) as Href;
}

function hasConnectedPlayers(room: RoomSnapshot): boolean {
  return room.players.some((candidate) => candidate.connected);
}

export default function PlayScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [activeRoomCode, setActiveRoomCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [activeRoom, setActiveRoom] = useState<RoomSnapshot | null>(null);
  const [loadingActiveRoom, setLoadingActiveRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadActiveRoomPreview(code: string) {
      const cleanCode = normalizeRoomCode(code);
      if (!isRoomCode(cleanCode)) {
        setActiveRoom(null);
        return;
      }

      setLoadingActiveRoom(true);
      try {
        const result = await getRoomPreview(cleanCode);
        if (cancelled) return;
        setActiveRoom(
          result.ok && hasConnectedPlayers(result.data) ? result.data : null,
        );
      } catch {
        if (!cancelled) setActiveRoom(null);
      } finally {
        if (!cancelled) setLoadingActiveRoom(false);
      }
    }

    async function hydrate() {
      const [savedName, savedRoomCode] = await Promise.all([
        getSavedPlayerName(),
        getActiveRoomCode(),
      ]);
      if (cancelled) return;
      setPlayerName(savedName);
      setActiveRoomCode(savedRoomCode);
      void loadActiveRoomPreview(savedRoomCode);
    }

    void hydrate();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      void getActiveRoomCode().then((savedRoomCode) => {
        if (cancelled) return;
        setActiveRoomCode(savedRoomCode);
        void loadActiveRoomPreview(savedRoomCode);
      });
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const compact = height < 780;
  const cleanRoomCode = useMemo(() => normalizeRoomCode(roomCode), [roomCode]);

  async function persistName(): Promise<string | null> {
    const cleanName = playerName.trim();
    if (!cleanName) {
      setError('Tell the table who you are first.');
      return null;
    }

    await savePlayerName(cleanName);
    return cleanName;
  }

  async function handleCreateRoom() {
    const cleanName = await persistName();
    if (!cleanName) return;

    setCreating(true);
    setError(null);

    try {
      const result = await createRoom({
        playerName: cleanName,
        sessionId: await getPlayerSessionId(),
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      await saveActiveRoomSeat(result.data.room.code, result.data.player.id);
      router.push(roomHref(result.data.room.code));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not reach the game server.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom() {
    const cleanName = await persistName();
    if (!cleanName) return;

    if (!isRoomCode(cleanRoomCode)) {
      setError('Enter the 6-character room code from the invite.');
      return;
    }

    setJoining(true);
    setError(null);
    await saveActiveRoomCode(cleanRoomCode);
    router.push(roomHref(cleanRoomCode));
    setJoining(false);
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboard}
        >
          <ScrollView
            contentContainerStyle={[
              styles.content,
              compact && styles.contentCompact,
            ]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Text style={styles.kicker}>UNO No Mercy</Text>
              <Text style={[styles.title, compact && styles.titleCompact]}>
                Start a table anywhere.
              </Text>
              <Text style={styles.subtitle}>
                Mobile and web players join the same live room. Share one code;
                everyone lands at the same table.
              </Text>
            </View>

            <View
              style={[styles.tablePreview, compact && styles.tablePreviewCompact]}
              pointerEvents="none"
            >
              <View style={styles.deckStack}>
                <UnoCardMobile
                  card={previewCards[2] as Card}
                  size="sm"
                  faceDown
                  static
                  noHaptics
                />
              </View>
              <View style={styles.previewHand}>
                {previewCards.map((card, index) => (
                  <View
                    key={card.id}
                    style={[
                      styles.previewCard,
                      {
                        transform: [
                          { translateY: index === 1 ? -12 : 0 },
                          { rotate: `${(index - 1) * 8}deg` },
                        ],
                      },
                    ]}
                  >
                    <UnoCardMobile card={card} size="sm" static noHaptics />
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Your seat</Text>
              <TextInput
                value={playerName}
                onChangeText={setPlayerName}
                placeholder="Player name"
                placeholderTextColor="rgba(255,255,255,0.32)"
                maxLength={24}
                autoCapitalize="words"
                style={styles.input}
                returnKeyType="next"
              />

              {activeRoom ? (
                <ResumeRoomCard
                  room={activeRoom}
                  onPress={() => router.push(roomHref(activeRoom.code))}
                />
              ) : activeRoomCode && loadingActiveRoom ? (
                <View style={styles.resumeCard}>
                  <Text style={styles.resumeEyebrow}>Checking table</Text>
                  <Text style={styles.resumeTitle}>{activeRoomCode}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={handleCreateRoom}
                disabled={creating}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || creating) && styles.pressed,
                ]}
              >
                <Text style={styles.primaryButtonLabel}>
                  {creating ? 'Creating...' : 'Create room'}
                </Text>
              </Pressable>

              <View style={styles.joinRow}>
                <TextInput
                  value={roomCode}
                  onChangeText={setRoomCode}
                  placeholder="ROOM CODE"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  maxLength={6}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[styles.input, styles.codeInput]}
                  returnKeyType="go"
                  onSubmitEditing={handleJoinRoom}
                />
                <Pressable
                  onPress={handleJoinRoom}
                  disabled={joining}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    (pressed || joining) && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {joining ? 'Joining...' : 'Join'}
                  </Text>
                </Pressable>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function ResumeRoomCard({
  room,
  onPress,
}: {
  room: RoomSnapshot;
  onPress: () => void;
}) {
  const connectedPlayers = room.players.filter((player) => player.connected).length;
  const host = room.players.find((player) => player.id === room.hostPlayerId);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.resumeCard, pressed && styles.pressed]}
    >
      <View style={styles.resumeHeader}>
        <View>
          <Text style={styles.resumeEyebrow}>Table still open</Text>
          <Text style={styles.resumeTitle}>Room {room.code}</Text>
        </View>
        <Text style={styles.resumeAction}>Rejoin</Text>
      </View>
      <View style={styles.resumeMetaRow}>
        <View style={styles.liveDot} />
        <Text style={styles.resumeMeta}>
          {connectedPlayers}/{room.players.length} online
        </Text>
        <Text style={styles.resumeDivider}>·</Text>
        <Text style={styles.resumeMeta}>
          {room.status === 'playing' ? 'Game in progress' : 'Lobby'}
        </Text>
      </View>
      {host ? <Text style={styles.resumeHost}>Host: {host.name}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07070b',
  },
  safe: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
  contentCompact: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.two,
  },
  kicker: {
    color: '#ffdd55',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fffdf4',
    fontSize: 42,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -0.4,
    maxWidth: 340,
  },
  titleCompact: {
    fontSize: 36,
    lineHeight: 38,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 340,
  },
  tablePreview: {
    flex: 1,
    minHeight: 132,
    maxHeight: 178,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tablePreviewCompact: {
    minHeight: 102,
    maxHeight: 126,
  },
  deckStack: {
    position: 'absolute',
    top: 18,
    right: 20,
    opacity: 0.55,
    transform: [{ rotate: '12deg' }],
  },
  previewHand: {
    width: 232,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCard: {
    position: 'absolute',
  },
  panel: {
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderRadius: 22,
    padding: Spacing.three,
  },
  panelTitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
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
  resumeCard: {
    gap: Spacing.two,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,243,163,0.22)',
    backgroundColor: 'rgba(255,243,163,0.1)',
    padding: Spacing.three,
  },
  resumeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  resumeEyebrow: {
    color: '#ffdd55',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  resumeTitle: {
    color: '#fffdf4',
    fontSize: 19,
    fontWeight: '900',
    marginTop: 4,
  },
  resumeAction: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: '#fff3a3',
    color: '#151006',
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  resumeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#42d782',
  },
  resumeMeta: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    fontWeight: '800',
  },
  resumeDivider: {
    color: 'rgba(255,255,255,0.36)',
    fontSize: 12,
  },
  resumeHost: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 12,
    fontWeight: '700',
  },
  codeInput: {
    flex: 1,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  joinRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff3a3',
  },
  primaryButtonLabel: {
    color: '#141006',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryButtonLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  error: {
    color: '#ff9d9d',
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
