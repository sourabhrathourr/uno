import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import type { ChatMessage, Player } from "@workspace/game"

export function ReactionAttribution({
  message,
  selfId,
  players,
  onReact,
}: {
  message: ChatMessage
  selfId: string
  players: Player[]
  onReact: (message: ChatMessage, emoji: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 12, left: 12 })
  const anchor = useRef<HTMLButtonElement | null>(null)
  const messageNode = useRef<HTMLElement | null>(null)
  const returnFocus = useRef<{
    badge: HTMLButtonElement | null
    action: HTMLButtonElement | null
  } | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const reactions = message.reactions?.filter((r) => r.playerIds.length) ?? []
  function dismiss(focus = false) {
    if (focus) {
      // Removing the final reaction can remove the badge itself.
      returnFocus.current = {
        badge: anchor.current,
        action:
          messageNode.current?.querySelector<HTMLButtonElement>(
            "[data-message-action]"
          ) ?? null,
      }
    }
    setOpen(false)
  }
  useLayoutEffect(() => {
    if (!open) {
      const destination = returnFocus.current
      returnFocus.current = null
      if (destination)
        (destination.badge?.isConnected
          ? destination.badge
          : destination.action
        )?.focus({ preventScroll: true })
      return
    }
    const rect = anchor.current?.getBoundingClientRect()
    const bounds = panel.current?.getBoundingClientRect()
    if (!rect || !bounds) return
    const logNode = anchor.current?.closest('[role="log"]')
    const log = (
      logNode?.closest('aside,[role="dialog"]') ?? logNode
    )?.getBoundingClientRect()
    const min =
      log && log.width >= bounds.width + 16 ? Math.max(12, log.left + 8) : 12
    const max =
      log && log.width >= bounds.width + 16
        ? Math.min(innerWidth - bounds.width - 12, log.right - bounds.width - 8)
        : innerWidth - bounds.width - 12
    setPosition({
      left: Math.max(min, Math.min(rect.left, max)),
      top: Math.max(
        12,
        Math.min(rect.top - bounds.height - 8, innerHeight - bounds.height - 12)
      ),
    })
    panel.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    if (!open) return
    if (!reactions.length) {
      dismiss(true)
      return
    }
    function outside(event: Event) {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target))
        dismiss()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      dismiss(true)
    }
    function scroll(event: Event) {
      if (!panel.current?.contains(event.target as Node)) dismiss()
    }
    const resize = () => dismiss()
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("focusin", outside)
    document.addEventListener("keydown", escape, true)
    document.addEventListener("scroll", scroll, true)
    window.addEventListener("resize", resize)
    return () => {
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("focusin", outside)
      document.removeEventListener("keydown", escape, true)
      document.removeEventListener("scroll", scroll, true)
      window.removeEventListener("resize", resize)
    }
  }, [open, reactions.length])
  if (!reactions.length) return null
  return (
    <>
      <div
        className={`mt-1 flex flex-wrap gap-1 ${message.playerId === selfId ? "justify-end" : ""}`}
      >
        {reactions.map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            aria-label={`${reaction.emoji} reactions, ${reaction.playerIds.length}. View who reacted`}
            aria-haspopup="dialog"
            aria-expanded={
              open && anchor.current?.dataset.emoji === reaction.emoji
            }
            aria-controls={open ? id : undefined}
            data-emoji={reaction.emoji}
            data-own-reaction={reaction.playerIds.includes(selfId) || undefined}
            className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 focus-visible:outline-2 focus-visible:outline-yellow-200 data-[own-reaction]:border-yellow-200 data-[own-reaction]:text-yellow-100"
            onClick={(event) => {
              if (open && anchor.current === event.currentTarget) {
                dismiss()
                return
              }
              anchor.current = event.currentTarget
              messageNode.current = event.currentTarget.closest<HTMLElement>(
                "[data-chat-message]"
              )
              setOpen(true)
            }}
          >
            {reaction.emoji} {reaction.playerIds.length}
          </button>
        ))}
      </div>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-labelledby={`${id}-title`}
            style={position}
            className="fixed z-[170] w-72 max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-neutral-900 p-3 text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id={`${id}-title`} className="text-sm font-semibold">
                Reactions
              </h3>
              <button
                type="button"
                aria-label="Close reactions"
                onClick={() => dismiss(true)}
                className="grid size-8 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-yellow-200"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[min(220px,40dvh)] space-y-3 overflow-y-auto overscroll-contain">
              {reactions.map((reaction) => (
                <section
                  key={reaction.emoji}
                  aria-label={`${reaction.emoji}, ${reaction.playerIds.length} reactions`}
                >
                  <h4 className="mb-1 text-sm">
                    {reaction.emoji}{" "}
                    <span className="text-xs text-white/50">
                      {reaction.playerIds.length}
                    </span>
                  </h4>
                  <ul className="space-y-1">
                    {reaction.playerIds.map((playerId) => (
                      <li
                        key={playerId}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-xs"
                      >
                        <span className="min-w-0 [overflow-wrap:anywhere] break-words">
                          {playerId === selfId
                            ? "You"
                            : (players.find((player) => player.id === playerId)
                                ?.name ?? "Player no longer in room")}
                        </span>
                        {playerId === selfId && (
                          <button
                            type="button"
                            aria-label={`Remove my ${reaction.emoji} reaction`}
                            onClick={() => {
                              onReact(message, reaction.emoji)
                              dismiss(true)
                            }}
                            className="shrink-0 rounded px-2 py-1 text-yellow-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-yellow-200"
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-lg border border-white/15 px-3 py-2 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-yellow-200"
              onClick={() => {
                const action = anchor.current
                  ?.closest("[data-chat-message]")
                  ?.querySelector<HTMLButtonElement>("[data-message-action]")
                dismiss()
                action?.click()
              }}
            >
              Add or change reaction
            </button>
          </div>,
          anchor.current?.closest('[role="dialog"]') ?? document.body
        )}
    </>
  )
}
