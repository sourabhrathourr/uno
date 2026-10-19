import { useEffect, useRef, useState } from "react"
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
    const update = (value: ChatTypingPlayer[]) => {
      // Anchor the fallback lease locally; device and server clocks can differ.
      const expiresAt = Date.now() + 3_000
      setTyping(
        value
          .filter((entry) =>
            players.some((player) => player.id === entry.playerId)
          )
          .map((entry) => ({ playerId: entry.playerId, expiresAt }))
      )
    }
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

export { PublicMessageActions, PublicMessageReactions } from "./message-actions"

export function ReplyPreview({
  message,
  unavailable = false,
  onCancel,
  onNavigate,
  isSelf = false,
}: {
  message?: ChatMessage
  unavailable?: boolean
  onCancel?: () => void
  onNavigate?: () => void
  isSelf?: boolean
}) {
  const missing = unavailable || !message
  const content = (
    <>
      <span
        className={`block truncate text-xs font-semibold ${isSelf ? "text-amber-900" : "text-yellow-100"}`}
      >
        {missing
          ? "Original message unavailable"
          : `${onCancel ? "Replying to " : "↪ "}${message.playerName}`}
      </span>
      <span
        className={`mt-0.5 line-clamp-2 text-xs leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap ${isSelf ? "text-neutral-700" : "text-white/75"}`}
      >
        {missing
          ? "Original message is no longer available"
          : message.kind === "gif"
            ? (message.label ?? "GIF")
            : message.body}
      </span>
    </>
  )
  const quoteClass = `min-w-0 flex-1 rounded-lg border-l-[3px] px-2.5 py-2 text-left ${isSelf ? "border-amber-700/60 bg-black/[0.065]" : "border-yellow-200/60 bg-black/25"}`
  return (
    <div className="mb-2 flex min-w-0 items-center gap-1.5">
      {!missing && onNavigate ? (
        <button
          type="button"
          onClick={onNavigate}
          aria-label={`Go to original message from ${message.playerName}`}
          title="Go to original message"
          className={`${quoteClass} cursor-pointer hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400`}
        >
          {content}
        </button>
      ) : (
        <div className={quoteClass}>{content}</div>
      )}
      {onCancel && (
        <button
          type="button"
          aria-label="Cancel reply"
          onClick={onCancel}
          className="shrink-0 rounded p-2 text-white/65 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-yellow-200"
        >
          ×
        </button>
      )}
    </div>
  )
}
