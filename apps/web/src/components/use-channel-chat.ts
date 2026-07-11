import { useCallback, useEffect, useState } from "react"

import type {
  ChatChannel,
  ChatMessage,
  Player,
  SendChatMessageInput,
} from "@workspace/game"

import { mentionablePlayersForChannel } from "@/components/support-experience"
import { playFx } from "@/lib/sound"

export type ChatTray = "presets" | "emoji" | "gifs" | "voteKick"

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
}: {
  messages: Array<ChatMessage>
  squadMessages: Array<ChatMessage>
  squadPlayerId: string | null
  players: Array<Player>
  squadMemberIds: Array<string>
  selfPlayerId: string
  isReading: boolean
  onBeforeSend?: () => void
  onSendMessage: (input: SendChatMessageInput) => void
}) {
  const [text, setText] = useState("")
  const [tray, setTray] = useState<ChatTray | null>(null)
  const [channel, setChannel] = useState<ChatChannel>("public")
  const [mentionPlayerIds, setMentionPlayerIds] = useState<Array<string>>([])
  const [seenMessageIds, setSeenMessageIds] = useState(
    () => new Set([...messages, ...squadMessages].map((message) => message.id))
  )
  const channelMessages = channel === "squad" ? squadMessages : messages
  const mentionablePlayers = mentionablePlayersForChannel(
    players,
    channel,
    squadMemberIds
  ).filter((player) => player.id !== selfPlayerId)

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

  useEffect(() => {
    if (isReading) markChannelRead()
  }, [isReading, markChannelRead])

  function send(input: SendChatMessageInput) {
    playFx("buttonSoft", { volume: 0.36 })
    onBeforeSend?.()
    onSendMessage({ ...input, channel })
  }

  function sendText() {
    const body = text.trim()
    if (!body) return
    send({ kind: "text", body, mentionPlayerIds })
    setText("")
    setMentionPlayerIds([])
  }

  function changeText(value: string) {
    setText(value)
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
    const before = text.slice(0, range.start)
    const after = text.slice(range.end)
    const next = `${before}@${mentioned.name} ${after}`
    setText(next)
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
