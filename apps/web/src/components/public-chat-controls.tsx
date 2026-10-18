import { useEffect, useRef, useState } from "react"
import { CHAT_REACTIONS } from "@workspace/game"
import type { ChatMessage, ChatTypingPlayer, Player } from "@workspace/game"
import type { GameSocket } from "@/lib/realtime"

export function usePublicChatControls(
  socket: GameSocket | null | undefined,
  roomCode: string,
  players: Player[],
  selfId: string
) {
  const [typing, setTyping] = useState<ChatTypingPlayer[]>([])
  const [error, setError] = useState<string | null>(null)
  const lastTyping = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const composing = useRef(false)
  const pendingReactions = useRef(new Set<string>())
  useEffect(() => {
    setTyping([])
    const update = (value: ChatTypingPlayer[]) =>
      setTyping(
        value.filter((entry) =>
          players.some((player) => player.id === entry.playerId)
        )
      )
    const clear = () => {
      setTyping([])
      composing.current = false
      lastTyping.current = 0
    }
    let active = true
    if (socket?.connected)
      socket
        .timeout(4_000)
        .volatile.emit("room:getChatTyping", (cause, result) => {
          if (active && !cause && result?.ok) update(result.data)
        })
    socket?.on("room:chatTyping", update)
    socket?.on("disconnect", clear)
    return () => {
      active = false
      socket?.off("room:chatTyping", update)
      socket?.off("disconnect", clear)
      clearTimeout(idleTimer.current)
      if (composing.current && socket?.connected)
        socket.volatile.emit("room:setChatTyping", { typing: false }, () => {})
      composing.current = false
    }
  }, [socket, roomCode, players.map((player) => player.id).join(":")])
  useEffect(() => {
    const next = Math.min(...typing.map((entry) => entry.expiresAt))
    if (!Number.isFinite(next)) return
    const timer = setTimeout(
      () =>
        setTyping((current) =>
          current.filter((entry) => entry.expiresAt > Date.now())
        ),
      Math.max(0, next - Date.now()) + 1
    )
    return () => clearTimeout(timer)
  }, [typing])
  function onTyping(active: boolean) {
    clearTimeout(idleTimer.current)
    if (!socket?.connected) return
    if (!active) {
      if (composing.current)
        socket.volatile.emit("room:setChatTyping", { typing: false }, () => {})
      composing.current = false
      return
    }
    if (!composing.current || Date.now() - lastTyping.current >= 1_200) {
      socket.volatile.emit("room:setChatTyping", { typing: true }, () => {})
      lastTyping.current = Date.now()
    }
    composing.current = true
    idleTimer.current = setTimeout(() => onTyping(false), 2_500)
  }
  function endCompose() {
    // The send handler clears the server lease. Avoid a second volatile packet
    // immediately before sending the acknowledged text request.
    clearTimeout(idleTimer.current)
    composing.current = false
  }
  function react(message: ChatMessage, emoji: string) {
    if (!socket?.connected || pendingReactions.current.has(message.id)) return
    const active = !message.reactions
      ?.find((reaction) => reaction.emoji === emoji)
      ?.playerIds.includes(selfId)
    pendingReactions.current.add(message.id)
    setError(null)
    socket
      .timeout(8_000)
      .volatile.emit(
        "room:reactToChatMessage",
        { messageId: message.id, emoji, active },
        (cause, result) => {
          pendingReactions.current.delete(message.id)
          if (cause)
            setError(
              "Reaction outcome is unconfirmed. Check the message before trying again."
            )
          else if (!result?.ok)
            setError(result?.error.message ?? "Could not react.")
        }
      )
  }
  return {
    onTyping,
    endCompose,
    react,
    error,
    typingNames: typing
      .filter(
        (entry) => entry.playerId !== selfId && entry.expiresAt > Date.now()
      )
      .map(
        (entry) => players.find((player) => player.id === entry.playerId)?.name
      )
      .filter(Boolean),
  }
}

export function PublicMessageActions({
  message,
  selfId,
  onReply,
  onReact,
}: {
  message: ChatMessage
  selfId: string
  onReply: (id: string) => void
  onReact: (message: ChatMessage, emoji: string) => void
}) {
  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1 text-[11px] text-white/60 ${message.playerId === selfId ? "justify-end" : ""}`}
    >
      <button
        type="button"
        className="rounded px-1.5 py-1 hover:bg-white/10 focus-visible:outline"
        aria-label={`Reply to ${message.playerName}'s message`}
        onClick={() => onReply(message.id)}
      >
        Reply
      </button>
      {(message.reactions ?? []).map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          aria-label={`${reaction.emoji} reaction, ${reaction.playerIds.length}`}
          aria-pressed={reaction.playerIds.includes(selfId)}
          onClick={() => onReact(message, reaction.emoji)}
          className="rounded-full border border-white/15 px-1.5 py-0.5 aria-pressed:border-yellow-200 aria-pressed:text-yellow-100"
        >
          {reaction.emoji} {reaction.playerIds.length}
        </button>
      ))}
      <details className="relative">
        <summary
          className="cursor-pointer rounded px-1.5 py-1 hover:bg-white/10"
          aria-label="Add a reaction"
        >
          React
        </summary>
        <div className="relative z-10 flex gap-1 rounded-lg border border-white/15 bg-neutral-900 p-1">
          {CHAT_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={(event) => {
                onReact(message, emoji)
                event.currentTarget.closest("details")?.removeAttribute("open")
              }}
              className="rounded p-1 hover:bg-white/10"
            >
              {emoji}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}

export function ReplyPreview({
  message,
  unavailable = false,
  onCancel,
}: {
  message?: ChatMessage
  unavailable?: boolean
  onCancel?: () => void
}) {
  return (
    <div className="mb-1 flex items-center gap-2 rounded-lg border-l-2 border-yellow-200/60 bg-white/5 px-2 py-1 text-xs text-white/65">
      <span className="min-w-0 flex-1 truncate">
        {unavailable
          ? "Original message is no longer available"
          : `${message?.playerName ?? "Player"}: ${message?.kind === "gif" ? "GIF" : (message?.body.slice(0, 100) ?? "Message")}`}
      </span>
      {onCancel && (
        <button
          type="button"
          aria-label="Cancel reply"
          onClick={onCancel}
          className="rounded px-2 py-1 hover:bg-white/10"
        >
          ×
        </button>
      )}
    </div>
  )
}
