import type {
  ChatChannel,
  ChatMessage,
  GifSearchResult,
  Player,
  PlayerSocialSnapshot,
  RoomSnapshot,
  SendChatMessageInput,
  VoteKickChoice,
  VoteKickPoll,
} from '@workspace/game';
import {
  AVATAR_REACTION_EMOJIS,
  CHAT_EMOJIS,
  CHAT_PRESETS,
} from '@workspace/game';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayerAvatar } from '@/components/player-avatar';
import { searchGifs } from '@/lib/realtime';
import {
  canPlayerStartVoteKick,
  gifChatInput,
  mentionablePlayersForChannel,
  squadMemberIdsFor,
  voteKickTargetsForRoom,
} from '@/lib/social';

type Tray = 'presets' | 'emoji' | 'gifs' | 'vote' | null;

export function RoomSocialSheet({
  visible,
  room,
  selfPlayerId,
  playerSocial,
  seenMessageIds,
  onClose,
  onReadMessages,
  onSendMessage,
  onStartVoteKick,
  onCastVoteKick,
  onKickSupporter,
  onReact,
}: {
  visible: boolean;
  room: RoomSnapshot;
  selfPlayerId: string;
  playerSocial: PlayerSocialSnapshot | null;
  seenMessageIds: ReadonlySet<string>;
  onClose: () => void;
  onReadMessages: (messages: ChatMessage[]) => void;
  onSendMessage: (input: SendChatMessageInput) => void;
  onStartVoteKick: (targetPlayerId: string) => void;
  onCastVoteKick: (voteKickId: string, choice: VoteKickChoice) => void;
  onKickSupporter: (supporterPlayerId: string) => void;
  onReact: (body: (typeof AVATAR_REACTION_EMOJIS)[number]) => void;
}) {
  const [channel, setChannel] = useState<ChatChannel>('public');
  const [tray, setTray] = useState<Tray>(null);
  const [text, setText] = useState('');
  const [mentionPlayerIds, setMentionPlayerIds] = useState<string[]>([]);
  const messageListRef = useRef<FlatList<ChatMessage>>(null);
  const squadPlayerId = playerSocial?.squadPlayerId ?? null;
  const squadMemberIds = useMemo(
    () => squadMemberIdsFor(room, squadPlayerId),
    [room, squadPlayerId],
  );
  const messages = useMemo(
    () =>
      channel === 'squad'
        ? (playerSocial?.squadChatMessages ?? [])
        : room.chatMessages,
    [channel, playerSocial?.squadChatMessages, room.chatMessages],
  );
  const mentionablePlayers = mentionablePlayersForChannel(
    room.players,
    channel,
    squadMemberIds,
  ).filter((player) => player.id !== selfPlayerId);
  const publicUnread = room.chatMessages.filter(
    (message) =>
      message.playerId !== selfPlayerId && !seenMessageIds.has(message.id),
  );
  const squadUnread = (playerSocial?.squadChatMessages ?? []).filter(
    (message) =>
      message.playerId !== selfPlayerId && !seenMessageIds.has(message.id),
  );

  useEffect(() => {
    if (!squadPlayerId && channel === 'squad') setChannel('public');
  }, [channel, squadPlayerId]);

  useEffect(() => {
    if (visible) onReadMessages(messages);
  }, [messages, onReadMessages, visible]);

  function changeChannel(next: ChatChannel) {
    if (next === 'squad' && !squadPlayerId) return;
    setChannel(next);
    setMentionPlayerIds([]);
    setTray(null);
  }

  function send(input: Omit<SendChatMessageInput, 'channel'>) {
    onSendMessage({ ...input, channel });
    setTray(null);
  }

  function sendText() {
    const body = text.trim();
    if (!body) return;
    send({ kind: 'text', body, mentionPlayerIds });
    setText('');
    setMentionPlayerIds([]);
  }

  function applyMention(playerId: string) {
    const mentioned = room.players.find((player) => player.id === playerId);
    if (!mentioned) return;
    const token = `@${mentioned.name}`;
    setText((current) =>
      current.includes(token)
        ? current
        : `${current}${current ? ' ' : ''}${token} `,
    );
    setMentionPlayerIds((current) =>
      Array.from(new Set([...current, mentioned.id])),
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalRoot}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Room social</Text>
              <Text style={styles.title}>Table talk</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
          </View>

          <View style={styles.channelRow}>
            {(['public', 'squad'] as const).map((nextChannel) => {
              const disabled = nextChannel === 'squad' && !squadPlayerId;
              const unread =
                nextChannel === 'public' ? publicUnread : squadUnread;
              const hasMention = unread.some((message) =>
                message.mentionPlayerIds.includes(selfPlayerId),
              );
              return (
                <Pressable
                  key={nextChannel}
                  disabled={disabled}
                  onPress={() => changeChannel(nextChannel)}
                  style={[
                    styles.channelButton,
                    channel === nextChannel && styles.channelButtonActive,
                    disabled && styles.disabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.channelLabel,
                      channel === nextChannel && styles.channelLabelActive,
                    ]}
                  >
                    {nextChannel === 'public' ? 'Public' : 'Squad'}
                    {unread.length > 0
                      ? ` ${hasMention ? '@' : ''}${unread.length}`
                      : ''}
                  </Text>
                </Pressable>
              );
            })}
            {room.status === 'playing' ? (
              <View style={styles.reactionRow}>
                {AVATAR_REACTION_EMOJIS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => onReact(emoji)}
                    style={styles.reactionButton}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.reactionRow} />
            )}
          </View>

          {channel === 'squad' && squadPlayerId ? (
            <SquadRoster
              room={room}
              squadPlayerId={squadPlayerId}
              squadMemberIds={squadMemberIds}
              selfPlayerId={selfPlayerId}
              onKickSupporter={onKickSupporter}
            />
          ) : null}

          <FlatList
            ref={messageListRef}
            data={messages}
            keyExtractor={(message) => message.id}
            renderItem={({ item }) => (
              <ChatMessageRow
                message={item}
                room={room}
                selfPlayerId={selfPlayerId}
                onVote={onCastVoteKick}
              />
            )}
            contentContainerStyle={styles.messageList}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {channel === 'squad'
                  ? 'Your squad chat starts here.'
                  : 'No messages yet. Break the silence.'}
              </Text>
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              messageListRef.current?.scrollToEnd({ animated: false })
            }
          />

          {tray ? (
            <View style={styles.tray}>
              {tray === 'presets' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    {CHAT_PRESETS.map((preset) => (
                      <Chip
                        key={preset}
                        label={preset}
                        onPress={() => send({ kind: 'preset', body: preset })}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : null}
              {tray === 'emoji' ? (
                <View style={styles.emojiTray}>
                  {CHAT_EMOJIS.map((emoji) => (
                    <Pressable
                      key={emoji}
                      onPress={() => send({ kind: 'emoji', body: emoji })}
                      style={styles.emojiButton}
                    >
                      <Text style={styles.emojiText}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {tray === 'gifs' ? (
                <GifPicker
                  roomCode={room.code}
                  onSelect={(gif) => send(gifChatInput(gif))}
                />
              ) : null}
              {tray === 'vote' ? (
                <VoteKickTargets
                  room={room}
                  selfPlayerId={selfPlayerId}
                  onStart={onStartVoteKick}
                />
              ) : null}
            </View>
          ) : null}

          {mentionablePlayers.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.mentionRow}>
                <Text style={styles.mentionHint}>Mention</Text>
                {mentionablePlayers.map((candidate) => (
                  <Chip
                    key={candidate.id}
                    label={`@${candidate.name}`}
                    active={mentionPlayerIds.includes(candidate.id)}
                    onPress={() => applyMention(candidate.id)}
                  />
                ))}
              </View>
            </ScrollView>
          ) : null}

          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={(value) => {
                setText(value);
                setMentionPlayerIds((current) =>
                  current.filter((playerId) => {
                    const mentioned = room.players.find(
                      (candidate) => candidate.id === playerId,
                    );
                    return mentioned
                      ? value.includes(`@${mentioned.name}`)
                      : false;
                  }),
                );
              }}
              onSubmitEditing={sendText}
              placeholder={
                channel === 'squad' ? 'Message your squad' : 'Message the table'
              }
              placeholderTextColor="rgba(255,255,255,0.32)"
              maxLength={280}
              returnKeyType="send"
              style={styles.input}
            />
            <Pressable onPress={sendText} style={styles.sendButton}>
              <Text style={styles.sendLabel}>Send</Text>
            </Pressable>
          </View>

          <View style={styles.toolbar}>
            <TrayButton
              label="Quick"
              active={tray === 'presets'}
              onPress={() => setTray(tray === 'presets' ? null : 'presets')}
            />
            <TrayButton
              label="Emoji"
              active={tray === 'emoji'}
              onPress={() => setTray(tray === 'emoji' ? null : 'emoji')}
            />
            <TrayButton
              label="GIF"
              active={tray === 'gifs'}
              onPress={() => setTray(tray === 'gifs' ? null : 'gifs')}
            />
            <TrayButton
              label="Vote-kick"
              active={tray === 'vote'}
              disabled={!canPlayerStartVoteKick(room, selfPlayerId)}
              onPress={() => setTray(tray === 'vote' ? null : 'vote')}
            />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SquadRoster({
  room,
  squadPlayerId,
  squadMemberIds,
  selfPlayerId,
  onKickSupporter,
}: {
  room: RoomSnapshot;
  squadPlayerId: string;
  squadMemberIds: string[];
  selfPlayerId: string;
  onKickSupporter: (supporterPlayerId: string) => void;
}) {
  const members = squadMemberIds
    .map((id) => room.players.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.squadRow}>
        {members.map((member) => {
          const isLead = member.id === squadPlayerId;
          const canKick = selfPlayerId === squadPlayerId && !isLead;
          return (
            <View key={member.id} style={styles.squadMember}>
              <PlayerAvatar
                roomCode={room.code}
                players={room.players}
                playerId={member.id}
                size={26}
              />
              <Text style={styles.squadName} numberOfLines={1}>
                {member.name}
                {isLead ? ' · player' : ''}
              </Text>
              {canKick ? (
                <Pressable onPress={() => onKickSupporter(member.id)}>
                  <Text style={styles.kickLabel}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ChatMessageRow({
  message,
  room,
  selfPlayerId,
  onVote,
}: {
  message: ChatMessage;
  room: RoomSnapshot;
  selfPlayerId: string;
  onVote: (voteKickId: string, choice: VoteKickChoice) => void;
}) {
  const self = message.playerId === selfPlayerId;
  if (message.kind === 'vote-kick' && message.voteKick) {
    return (
      <VoteKickCard
        poll={message.voteKick}
        selfPlayerId={selfPlayerId}
        onVote={onVote}
      />
    );
  }

  return (
    <View style={[styles.messageRow, self && styles.messageRowSelf]}>
      {!self ? (
        <PlayerAvatar
          roomCode={room.code}
          players={room.players}
          playerId={message.playerId}
          size={28}
        />
      ) : null}
      <View style={[styles.messageBubble, self && styles.messageBubbleSelf]}>
        {!self ? (
          <Text style={styles.messageAuthor}>{message.playerName}</Text>
        ) : null}
        {message.kind === 'gif' ? (
          <Image
            source={{ uri: message.body }}
            style={styles.messageGif}
            contentFit="cover"
            autoplay
          />
        ) : (
          <Text
            style={
              message.kind === 'emoji'
                ? styles.messageEmoji
                : styles.messageText
            }
          >
            {message.body}
          </Text>
        )}
      </View>
    </View>
  );
}

function VoteKickCard({
  poll,
  selfPlayerId,
  onVote,
}: {
  poll: VoteKickPoll;
  selfPlayerId: string;
  onVote: (voteKickId: string, choice: VoteKickChoice) => void;
}) {
  const now = useNow(poll.status === 'open');
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(poll.closesAt) - now) / 1000),
  );
  const eligible = poll.eligibleVoterIds.includes(selfPlayerId);
  const ownVote = poll.votes.find(
    (vote) => vote.playerId === selfPlayerId,
  )?.choice;
  return (
    <View style={styles.voteCard}>
      <Text style={styles.voteEyebrow}>
        {poll.status === 'open' ? `${seconds}s remaining` : 'Vote resolved'}
      </Text>
      <Text style={styles.voteTitle}>Kick {poll.targetPlayerName}?</Text>
      <Text style={styles.voteMeta}>
        {poll.yesCount} yes · {poll.noCount} no
        {poll.status !== 'open'
          ? poll.result === 'kicked'
            ? ' · player removed'
            : ' · vote failed'
          : ''}
      </Text>
      {poll.status === 'open' && eligible ? (
        <View style={styles.voteActions}>
          {(['yes', 'no'] as const).map((choice) => (
            <Pressable
              key={choice}
              onPress={() => onVote(poll.id, choice)}
              style={[
                styles.voteButton,
                ownVote === choice && styles.voteButtonActive,
              ]}
            >
              <Text style={styles.voteButtonLabel}>
                {choice === 'yes' ? 'Vote yes' : 'Vote no'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function VoteKickTargets({
  room,
  selfPlayerId,
  onStart,
}: {
  room: RoomSnapshot;
  selfPlayerId: string;
  onStart: (targetPlayerId: string) => void;
}) {
  const now = useNow(true);
  const targets = voteKickTargetsForRoom(room, selfPlayerId);
  return (
    <View style={styles.targetList}>
      <Text style={styles.trayTitle}>Start a 25-second table vote</Text>
      {targets.map((target) => {
        const cooldownMs = target.cooldownExpiresAt
          ? Date.parse(target.cooldownExpiresAt) - now
          : 0;
        const coolingDown = cooldownMs > 0;
        return (
          <Pressable
            key={target.player.id}
            disabled={coolingDown}
            onPress={() => onStart(target.player.id)}
            style={[styles.targetRow, coolingDown && styles.disabled]}
          >
            <PlayerAvatar
              roomCode={room.code}
              players={room.players}
              playerId={target.player.id}
              size={30}
            />
            <Text style={styles.targetName}>{target.player.name}</Text>
            <Text style={styles.targetAction}>
              {coolingDown
                ? `${Math.ceil(cooldownMs / 1000)}s cooldown`
                : 'Choose'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function GifPicker({
  roomCode,
  onSelect,
}: {
  roomCode: string;
  onSelect: (gif: GifSearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifSearchResult[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => {
        setLoading(true);
        setError(null);
        void searchGifs({
          roomCode,
          query,
          offset: 0,
          signal: controller.signal,
        })
          .then((response) => {
            if (requestIdRef.current !== requestId) return;
            setResults(response.results);
            setNextOffset(response.nextOffset);
          })
          .catch((cause: unknown) => {
            if (controller.signal.aborted || requestIdRef.current !== requestId)
              return;
            setResults([]);
            setNextOffset(null);
            setError(
              cause instanceof Error ? cause.message : 'Could not search GIFs.',
            );
          })
          .finally(() => {
            if (requestIdRef.current === requestId) setLoading(false);
          });
      },
      query.trim() ? 300 : 0,
    );
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, roomCode]);

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await searchGifs({
        roomCode,
        query,
        offset: nextOffset,
      });
      if (requestIdRef.current !== requestId) return;
      setResults((current) => [...current, ...response.results]);
      setNextOffset(response.nextOffset);
    } catch (cause) {
      if (requestIdRef.current === requestId) {
        setError(
          cause instanceof Error ? cause.message : 'Could not load more GIFs.',
        );
      }
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <View style={styles.gifPicker}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search GIFs"
        placeholderTextColor="rgba(255,255,255,0.32)"
        maxLength={50}
        style={styles.gifSearch}
      />
      {loading ? (
        <ActivityIndicator color="#fff3a3" style={styles.gifLoader} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(gif) => `${gif.provider}:${gif.id}`}
          numColumns={2}
          style={styles.gifGrid}
          columnWrapperStyle={styles.gifGridRow}
          renderItem={({ item }) => (
            <Pressable onPress={() => onSelect(item)} style={styles.gifResult}>
              <Image
                source={{ uri: item.previewUrl }}
                style={styles.gifImage}
                contentFit="cover"
                autoplay
              />
              <Text style={styles.gifTitle} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No GIFs found.</Text>
          }
        />
      )}
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      {nextOffset !== null ? (
        <Pressable
          disabled={loadingMore}
          onPress={() => void loadMore()}
          style={styles.loadMore}
        >
          <Text style={styles.loadMoreLabel}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Chip({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TrayButton({
  label,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.toolButton,
        active && styles.toolButtonActive,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  sheet: {
    height: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#111014',
    paddingHorizontal: 14,
    paddingTop: 8,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  eyebrow: {
    color: '#ffdd55',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  title: { color: '#fffdf4', fontSize: 22, fontWeight: '800', marginTop: 2 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: { color: '#fff', fontSize: 25, lineHeight: 27 },
  channelRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  channelButton: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelButtonActive: { backgroundColor: '#fff3a3' },
  channelLabel: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    fontWeight: '800',
  },
  channelLabelActive: { color: '#151006' },
  reactionRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 1,
  },
  reactionButton: {
    width: 27,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 16 },
  squadRow: { flexDirection: 'row', gap: 6, paddingBottom: 8 },
  squadMember: {
    minHeight: 34,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 5,
    paddingRight: 9,
  },
  squadName: {
    maxWidth: 90,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '700',
  },
  kickLabel: { color: '#ff9d9d', fontSize: 10, fontWeight: '800' },
  messageList: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    gap: 7,
    paddingVertical: 8,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 18,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    paddingRight: 48,
  },
  messageRowSelf: {
    justifyContent: 'flex-end',
    paddingRight: 0,
    paddingLeft: 48,
  },
  messageBubble: {
    maxWidth: '88%',
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  messageBubbleSelf: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 5,
    backgroundColor: 'rgba(255,243,163,0.13)',
  },
  messageAuthor: {
    color: '#ffdd55',
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 3,
  },
  messageText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 13,
    lineHeight: 18,
  },
  messageEmoji: { fontSize: 27 },
  messageGif: {
    width: 190,
    height: 118,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  tray: {
    maxHeight: 260,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.045)',
    padding: 8,
    marginBottom: 7,
  },
  trayTitle: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(255,255,255,0.055)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  chipActive: {
    borderColor: 'rgba(255,243,163,0.3)',
    backgroundColor: 'rgba(255,243,163,0.13)',
  },
  chipLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11,
    fontWeight: '600',
  },
  chipLabelActive: { color: '#fff3a3' },
  emojiTray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emojiButton: {
    width: '16.5%',
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 25 },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 7,
  },
  mentionHint: {
    color: 'rgba(255,255,255,0.34)',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 90,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    color: '#fff',
    paddingHorizontal: 12,
    fontSize: 14,
  },
  sendButton: {
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#fff3a3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: { color: '#151006', fontSize: 12, fontWeight: '900' },
  toolbar: { flexDirection: 'row', gap: 5, paddingTop: 7, paddingBottom: 2 },
  toolButton: {
    flex: 1,
    minHeight: 32,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.055)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolButtonActive: { backgroundColor: 'rgba(255,243,163,0.14)' },
  toolLabel: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 10,
    fontWeight: '800',
  },
  toolLabelActive: { color: '#fff3a3' },
  voteCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,160,160,0.22)',
    backgroundColor: 'rgba(246,95,95,0.09)',
    padding: 12,
    gap: 4,
  },
  voteEyebrow: {
    color: '#ffb1b1',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  voteTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  voteMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  voteActions: { flexDirection: 'row', gap: 7, marginTop: 5 },
  voteButton: {
    flex: 1,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voteButtonActive: {
    backgroundColor: 'rgba(255,243,163,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,243,163,0.28)',
  },
  voteButtonLabel: { color: '#fff', fontSize: 11, fontWeight: '800' },
  targetList: { gap: 5 },
  targetRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.24)',
    paddingHorizontal: 7,
  },
  targetName: { flex: 1, color: '#fff', fontSize: 12, fontWeight: '700' },
  targetAction: { color: '#ffb1b1', fontSize: 10, fontWeight: '800' },
  gifPicker: { gap: 7 },
  gifSearch: {
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    color: '#fff',
    paddingHorizontal: 11,
    fontSize: 13,
  },
  gifLoader: { height: 110 },
  gifGrid: { maxHeight: 170 },
  gifGridRow: { gap: 7, marginBottom: 7 },
  gifResult: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  gifImage: { width: '100%', height: 72 },
  gifTitle: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  inlineError: { color: '#ff9d9d', fontSize: 10 },
  loadMore: {
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  loadMoreLabel: {
    color: 'rgba(255,255,255,0.64)',
    fontSize: 10,
    fontWeight: '700',
  },
  disabled: { opacity: 0.34 },
});
