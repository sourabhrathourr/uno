import { useCallback, useEffect, useRef, useState } from "react"

import { DJ_BOT_ID, DJ_BOT_NAME } from "@workspace/game"
import type {
  ChatChannel,
  ChatMessage,
  Player,
  SendChatMessageInput,
} from "@workspace/game"

import { mentionablePlayersForChannel } from "@/components/support-experience"
import { playFx } from "@/lib/sound"

export type ChatTray = "presets" | "emoji" | "gifs" | "voteKick"

/** The music bot, offered in the public mention list as `@DJ`. */
export const DJ_MENTION_CANDIDATE: Player = {
  id: DJ_BOT_ID,
  name: DJ_BOT_NAME,
  seat: -1,
  ready: true,
  connected: true,
  joinedAt: "",
  lastSeenAt: "",
}

export function isDjCandidate(player: Pick<Player, "id">) {
  return player.id === DJ_BOT_ID
}

export function useChannelChat({
  messages,
  squadMessages,
  squadPlayerId,
  players,
  squadMemberIds,
  selfPlayerId,
  isReading,
  onBeforeSend,
  onSendMessage,
  onTyping,
  onComposeEnd,
}: {
  messages: Array<ChatMessage>
  squadMessages: Array<ChatMessage>
  squadPlayerId: string | null
  players: Array<Player>
  squadMemberIds: Array<string>
  selfPlayerId: string
  isReading: boolean
  onBeforeSend?: () => void
  onSendMessage: (input: SendChatMessageInput) => void | Promise<boolean>
  onTyping?: (typing: boolean) => void
  onComposeEnd?: () => void
}) {
  const [text, setText] = useState("")
  const [replyToMessageId, setReplyTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const draftRevision = useRef(0)
  const [tray, setTray] = useState<ChatTray | null>(null)
  const [channel, setChannel] = useState<ChatChannel>("public")
  const [mentionPlayerIds, setMentionPlayerIds] = useState<Array<string>>([])
  const [seenMessageIds, setSeenMessageIds] = useState(
    () => new Set([...messages, ...squadMessages].map((message) => message.id))
  )
  const channelMessages = channel === "squad" ? squadMessages : messages
  const channelPlayers = mentionablePlayersForChannel(
    players,
    channel,
    squadMemberIds
  ).filter((player) => player.id !== selfPlayerId)
  // A seated player named "DJ" keeps the name; the bot steps aside.
  const djNameTaken = players.some(
    (player) => player.name.toLowerCase() === DJ_BOT_NAME.toLowerCase()
  )
  const mentionablePlayers =
    channel === "public" && !djNameTaken
      ? [DJ_MENTION_CANDIDATE, ...channelPlayers]
      : channelPlayers

  const markChannelRead = useCallback(
    (activeChannel = channel) => {
      const activeMessages =
        activeChannel === "squad" ? squadMessages : messages
      setSeenMessageIds((current) => {
        const next = new Set(current)
        let changed = false
        for (const message of activeMessages) {
          if (next.has(message.id)) continue
          next.add(message.id)
          changed = true
        }
        return changed ? next : current
      })
    },
    [channel, messages, squadMessages]
  )

  useEffect(() => {
    if (!squadPlayerId && channel === "squad") setChannel("public")
  }, [squadPlayerId, channel])

  // While the panel is collapsed nothing is being read, so unread keeps
  // building until it is opened again.
  useEffect(() => {
    if (isReading) markChannelRead()
  }, [isReading, markChannelRead])

  async function send(input: SendChatMessageInput) {
    if (sendingRef.current) return false
    sendingRef.current = true
    setSending(true)
    onComposeEnd?.()
    playFx("buttonSoft", { volume: 0.36 })
    onBeforeSend?.()
    try {
      return (await onSendMessage({ ...input, channel })) !== false
    } catch {
      return false
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  async function sendText() {
    const body = text.trim()
    if (!body) return
    const reply = channel === "public" ? replyToMessageId : null
    const revision = draftRevision.current
    const sent = await send({
      kind: "text",
      body,
      mentionPlayerIds,
      ...(reply ? { replyToMessageId: reply } : {}),
    })
    if (!sent || revision !== draftRevision.current) return
    setText("")
    setMentionPlayerIds([])
    setReplyTarget(null)
  }

  function setReplyToMessageId(id: string | null) {
    draftRevision.current++
    setReplyTarget(id)
  }
  function changeText(value: string) {
    draftRevision.current++
    setText(value)
    onTyping?.(channel === "public" && value.trim().length > 0)
    setMentionPlayerIds((current) =>
      current.filter((playerId) => {
        const mentioned = players.find((candidate) => candidate.id === playerId)
        return mentioned ? value.includes(`@${mentioned.name}`) : false
      })
    )
  }

  function applyMention(
    mentioned: Player,
    range: { start: number; end: number }
  ) {
    draftRevision.current++
    const before = text.slice(0, range.start)
    const after = text.slice(range.end)
    const next = `${before}@${mentioned.name} ${after}`
    setText(next)
    onTyping?.(channel === "public")
    // The DJ is not a seated player, so it never joins mentionPlayerIds;
    // the server reads the leading "@DJ" in the text instead.
    if (!isDjCandidate(mentioned))
      setMentionPlayerIds((current) =>
        Array.from(new Set([...current, mentioned.id]))
      )
    setTray(null)
    return range.start + mentioned.name.length + 2
  }

  const publicMention = messages.some(
    (message) =>
      !seenMessageIds.has(message.id) &&
      message.mentionPlayerIds.includes(selfPlayerId)
  )
  const squadMention = squadMessages.some(
    (message) =>
      !seenMessageIds.has(message.id) &&
      message.mentionPlayerIds.includes(selfPlayerId)
  )
  const unreadMessageCount = [...messages, ...squadMessages].filter(
    (message) =>
      !seenMessageIds.has(message.id) && message.playerId !== selfPlayerId
  ).length

  return {
    applyMention,
    replyToMessageId,
    setReplyToMessageId,
    sending,
    changeText,
    channel,
    channelMessages,
    markChannelRead,
    mentionablePlayers,
    publicMention,
    send,
    sendText,
    setChannel,
    setTray,
    squadMention,
    text,
    tray,
    unreadMessageCount,
  }
}
