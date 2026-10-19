import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Reply, Smile } from "lucide-react"
import { CHAT_REACTIONS, type ChatMessage, type Player } from "@workspace/game"
import { ReactionAttribution } from "./reaction-attribution"

type Props = {
  message: ChatMessage
  selfId: string
  onReply: (id: string) => void
  onReact: (message: ChatMessage, emoji: string) => void
}

export function PublicMessageActions({
  message,
  selfId,
  onReply,
  onReact,
}: Props) {
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  const revealedRef = useRef(false)
  const restoreFocus = useRef(false)
  const id = useId()
  revealedRef.current = revealed

  function dismiss(focus = false) {
    setOpen(false)
    setRevealed(false)
    if (focus) trigger.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    const messageNode = trigger.current?.closest<HTMLElement>(
      "[data-chat-message]"
    )
    if (!messageNode) return
    let hold: {
      x: number
      y: number
      timer: ReturnType<typeof setTimeout>
    } | null = null
    const list = messageNode.closest('[role="log"]')
    function cancel() {
      if (hold) clearTimeout(hold.timer)
      hold = null
      list?.removeEventListener("scroll", cancel)
    }
    function down(event: PointerEvent) {
      if (event.pointerType !== "touch" || !event.isPrimary) return
      if (
        (event.target as Element).closest(
          "button,a,input,textarea,select,summary"
        )
      )
        return
      cancel()
      hold = {
        x: event.clientX,
        y: event.clientY,
        timer: setTimeout(() => {
          cancel()
          setRevealed(true)
        }, 500),
      }
      list?.addEventListener("scroll", cancel, { passive: true, once: true })
    }
    function move(event: PointerEvent) {
      if (
        hold &&
        Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8
      )
        cancel()
    }
    function context(event: Event) {
      if (revealedRef.current) event.preventDefault()
    }
    messageNode.addEventListener("pointerdown", down)
    messageNode.addEventListener("pointermove", move)
    messageNode.addEventListener("pointerup", cancel)
    messageNode.addEventListener("pointercancel", cancel)
    messageNode.addEventListener("contextmenu", context)
    return () => {
      cancel()
      messageNode.removeEventListener("pointerdown", down)
      messageNode.removeEventListener("pointermove", move)
      messageNode.removeEventListener("pointerup", cancel)
      messageNode.removeEventListener("pointercancel", cancel)
      messageNode.removeEventListener("contextmenu", context)
    }
  }, [message.id])

  useEffect(() => {
    if (!open && !revealed) return
    if (open)
      picker.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true })
    function outside(event: PointerEvent) {
      const node = event.target as Node
      if (picker.current?.contains(node) || trigger.current?.contains(node))
        return
      if (
        !open &&
        trigger.current?.closest("[data-chat-message]")?.contains(node)
      )
        return
      dismiss()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      dismiss(open)
    }
    function focusOutside(event: FocusEvent) {
      if (
        open &&
        !picker.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        dismiss()
    }
    const scroll = () => dismiss()
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape, true)
    document.addEventListener("focusin", focusOutside)
    document.addEventListener("scroll", scroll, true)
    window.addEventListener("resize", scroll)
    return () => {
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("keydown", escape, true)
      document.removeEventListener("focusin", focusOutside)
      document.removeEventListener("scroll", scroll, true)
      window.removeEventListener("resize", scroll)
    }
  }, [open, revealed])

  return (
    <>
      <button
        ref={trigger}
        data-message-action
        type="button"
        aria-label={`React or reply to ${message.playerName}'s message`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        title="React or reply"
        className={`mt-5 grid size-7 shrink-0 place-items-center rounded-full border border-white/12 bg-neutral-900 text-white/65 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-has-[:focus-visible]/message:pointer-events-auto group-has-[:focus-visible]/message:opacity-100 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-200 motion-reduce:transition-none ${open || revealed ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={(event) => {
          if (open) {
            dismiss()
            return
          }
          restoreFocus.current = event.detail === 0
          const rect = event.currentTarget.getBoundingClientRect()
          const width = Math.min(272, window.innerWidth - 24)
          const logNode = event.currentTarget.closest('[role="log"]')
          const log = (
            logNode?.closest('aside,[role="dialog"]') ?? logNode
          )?.getBoundingClientRect()
          const minLeft =
            log && log.width >= width + 16 ? Math.max(12, log.left + 8) : 12
          const maxLeft =
            log && log.width >= width + 16
              ? Math.min(window.innerWidth - width - 12, log.right - width - 8)
              : window.innerWidth - width - 12
          setPosition({
            left: Math.max(minLeft, Math.min(rect.left - width / 2, maxLeft)),
            top:
              rect.top > 132
                ? rect.top - 116
                : Math.min(rect.bottom + 8, window.innerHeight - 124),
          })
          setOpen(true)
        }}
      >
        <Smile className="size-4" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={picker}
            id={id}
            role="dialog"
            aria-label={`React to ${message.playerName}'s message`}
            className="fixed z-[170] w-[272px] max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-neutral-900 p-2 text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
            style={position}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[aria-pressed]"
                ),
              ]
              const current = buttons.indexOf(
                document.activeElement as HTMLButtonElement
              )
              if (current < 0) return
              event.preventDefault()
              buttons[
                (current +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  buttons.length) %
                  buttons.length
              ]?.focus()
            }}
          >
            <div className="flex justify-between gap-0.5">
              {CHAT_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  aria-pressed={Boolean(
                    message.reactions
                      ?.find((reaction) => reaction.emoji === emoji)
                      ?.playerIds.includes(selfId)
                  )}
                  className="grid size-10 place-items-center rounded-full text-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-yellow-200 aria-pressed:bg-yellow-200/15 aria-pressed:outline aria-pressed:outline-yellow-200/70"
                  onClick={() => {
                    onReact(message, emoji)
                    dismiss(restoreFocus.current)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={`Reply to ${message.playerName}'s message`}
              onClick={() => {
                dismiss(true)
                onReply(message.id)
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-t border-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-yellow-200"
            >
              <Reply className="size-3.5" aria-hidden="true" />
              Reply
            </button>
          </div>,
          trigger.current?.closest('[role="dialog"]') ?? document.body
        )}
    </>
  )
}

export function PublicMessageReactions({
  message,
  selfId,
  onReact,
  players = [],
}: Pick<Props, "message" | "selfId" | "onReact"> & { players?: Player[] }) {
  return (
    <ReactionAttribution
      message={message}
      selfId={selfId}
      players={players}
      onReact={onReact}
    />
  )
}
