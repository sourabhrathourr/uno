import { ArrowLeftRight, Check, Gift, LoaderCircle, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type {
  PartyReceipt,
  Card,
  CommandResult,
  PlayerGameSnapshot,
  RoomSnapshot,
} from "@workspace/game"
import { Button } from "@workspace/ui/components/button"
import { UnoCard } from "@workspace/ui/components/uno-card"
import type { GameSocket } from "../lib/realtime"

const button =
  "min-h-11 min-w-11 rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed"

export function PartyExperience({
  room,
  playerId,
  playerGame,
  socket,
  onOpen,
  asSheet = false,
}: {
  room: RoomSnapshot
  playerId: string
  playerGame: PlayerGameSnapshot | null
  socket: GameSocket | null
  onOpen: () => void
  asSheet?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [cardId, setCardId] = useState("")
  const [targetId, setTargetId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  const requestRef = useRef(0)
  const requestTimerRef = useRef<number | null>(null)
  const [receipt, setReceipt] = useState<PartyReceipt | null>(null)
  const game = room.game
  const offer = game?.tradeOffer
  const gift = game?.lastGift
  const ownGift = gift?.playerId === playerId
  const incoming = offer?.targetPlayerId === playerId
  const outgoing = offer?.playerId === playerId
  const mode = ownGift
    ? "gift"
    : incoming
      ? "incoming"
      : outgoing
        ? "outgoing"
        : open && playerGame?.canOfferTrade
          ? "offer"
          : null
  const deadline = gift?.expiresAt ?? offer?.expiresAt
  const seconds = deadline
    ? Math.max(0, Math.ceil((deadline - now) / 1000))
    : 10
  const cards = ownGift
    ? (playerGame?.lastGiftCards ?? [])
    : (playerGame?.hand ?? [])
  const targetIds = ownGift
    ? (playerGame?.giftTargetPlayerIds ?? [])
    : (playerGame?.tradeTargetPlayerIds ?? [])
  const targets = room.players.filter((player) => targetIds.includes(player.id))
  const selected = cards.find((card) => card.id === cardId)
  const selectedTarget = targets.find((player) => player.id === targetId)
  const name = (id?: string) =>
    room.players.find((player) => player.id === id)?.name ?? "Player"
  const connected = Boolean(socket?.connected)

  useEffect(() => {
    const next = playerGame?.partyReceipt
    setReceipt(next ?? null)
    if (!next) return
    const timer = window.setTimeout(
      () => setReceipt(null),
      Math.max(0, next.createdAt + 4_000 - Date.now())
    )
    return () => window.clearTimeout(timer)
  }, [playerGame?.partyReceipt?.id])

  useEffect(
    () => () => {
      requestRef.current += 1
      if (requestTimerRef.current) window.clearTimeout(requestTimerRef.current)
    },
    []
  )

  useEffect(() => {
    setCardId("")
    setTargetId("")
    setError(null)
    requestRef.current += 1
    if (requestTimerRef.current) window.clearTimeout(requestTimerRef.current)
    busyRef.current = false
    setBusy(false)
    if (ownGift || incoming || outgoing) setOpen(false)
  }, [offer?.id, gift?.id, room.game?.matchId])

  useEffect(() => {
    if (!playerGame?.canOfferTrade) setOpen(false)
  }, [playerGame?.canOfferTrade])

  useEffect(() => {
    if (!deadline) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [deadline])

  useEffect(() => {
    if (!mode) return
    const previous = document.activeElement as HTMLElement | null
    const panel = dialog.current
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [tabindex='0']"
        ) ?? []
      ).filter((element) => !element.closest("[inert]"))
    focusable()[0]?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && mode === "offer" && !busyRef.current)
        setOpen(false)
      if (event.key !== "Tab") return
      const elements = focusable()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", keydown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", keydown)
      document.body.style.overflow = previousOverflow
      if (previous?.isConnected) previous.focus()
    }
  }, [mode])

  function send(
    action: (ack: (result: CommandResult<RoomSnapshot>) => void) => void
  ) {
    if (!socket?.connected || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const requestId = ++requestRef.current
    const timer = window.setTimeout(() => {
      if (requestRef.current !== requestId) return
      requestRef.current += 1
      busyRef.current = false
      setBusy(false)
      setError("The connection is slow. Check your choice and try again.")
    }, 5_000)
    requestTimerRef.current = timer
    action((result) => {
      window.clearTimeout(timer)
      if (requestRef.current !== requestId) return
      busyRef.current = false
      setBusy(false)
      if (!result.ok) setError(result.error.message)
      else {
        setOpen(false)
        setCardId("")
        setTargetId("")
      }
    })
  }

  const title = ownGift
    ? "One last move."
    : incoming
      ? `${name(offer?.playerId)} wants to trade.`
      : outgoing
        ? "Your card is locked."
        : "Make a blind trade."
  const description = ownGift
    ? "Leave one card with someone still in the game. Your choice."
    : incoming
      ? "Pick one card to send. Their card stays hidden until you both swap."
      : outgoing
        ? `Waiting for ${name(offer?.targetPlayerId)}. You keep your turn.`
        : "Pick someone and one card. They choose what comes back. One trade each per match."

  return (
    <>
      {receipt && !mode && (
        <div
          role="status"
          className="pointer-events-none fixed top-[max(5rem,env(safe-area-inset-top))] left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-background/95 px-4 py-3 text-sm text-white/90 shadow-xl"
        >
          {receipt.kind === "gift" ? (
            <Gift size={18} className="shrink-0 text-white/60" />
          ) : (
            <ArrowLeftRight size={18} className="shrink-0 text-white/60" />
          )}
          <span className="min-w-0 break-words">
            Received <strong>{cardName(receipt.card)}</strong> from{" "}
            {name(receipt.fromPlayerId)}
          </span>
        </div>
      )}
      {playerGame?.canOfferTrade && (
        <Button
          type="button"
          variant="outline"
          aria-label="Blind trade"
          disabled={Boolean(mode)}
          onClick={() => {
            onOpen()
            setOpen(true)
          }}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-white/12 bg-white/[0.055] px-3 text-xs font-semibold text-white/80 shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition-colors hover:bg-white/[0.09]"
        >
          <ArrowLeftRight size={15} aria-hidden="true" />
          {asSheet ? "Trade" : "Blind trade"}
        </Button>
      )}
      {gift && !ownGift && (
        <div
          role="status"
          className="pointer-events-none fixed top-[max(5rem,env(safe-area-inset-top))] left-1/2 z-40 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-background/95 px-4 py-3 text-xs text-white/70 shadow-lg"
        >
          <Gift size={15} aria-hidden="true" />
          <span className="truncate">
            {name(gift.playerId)} is choosing a last gift
          </span>
          <span className="tabular-nums">{seconds}s</span>
        </div>
      )}
      {mode &&
        createPortal(
          <div
            className={`party-backdrop fixed inset-0 z-[95] flex justify-center bg-black/55 backdrop-blur-[2px] ${asSheet ? "items-end" : "items-center p-4"}`}
          >
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className={`party-panel flex max-h-[92dvh] w-full flex-col overflow-hidden border-white/10 bg-background text-white ${asSheet ? "party-sheet rounded-t-2xl border shadow-[0_-28px_80px_rgba(0,0,0,0.55)]" : "max-w-2xl rounded-2xl border shadow-[0_28px_80px_rgba(0,0,0,0.55)]"}`}
            >
              {asSheet && (
                <span
                  aria-hidden="true"
                  className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-white/20"
                />
              )}
              <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
                <div className="min-w-0 flex-1">
                  <h2
                    id={titleId}
                    className="text-base font-semibold tracking-tight text-white sm:text-lg"
                  >
                    {title}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-white/50 sm:text-sm">
                    {description}
                  </p>
                </div>
                {mode === "offer" ? (
                  <Button
                    type="button"
                    aria-label="Close trade"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                    variant="ghost"
                    className="size-11 shrink-0 rounded-lg text-white/60 hover:bg-white/[0.06] hover:text-white"
                  >
                    <X size={20} />
                  </Button>
                ) : (
                  <span
                    aria-label={`${seconds} seconds left`}
                    className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/65 tabular-nums"
                  >
                    {seconds}s
                  </span>
                )}
              </header>
              {deadline && (
                <div
                  aria-hidden="true"
                  className="h-0.5 shrink-0 overflow-hidden bg-white/8"
                >
                  <div
                    className="h-full origin-left bg-white/70 transition-transform duration-200 motion-reduce:transition-none"
                    style={{
                      transform: `scaleX(${Math.min(1, seconds / 10)})`,
                    }}
                  />
                </div>
              )}
              <div className="uno-scrollbar min-h-0 overflow-y-auto overscroll-contain px-4 pt-4 pb-2 sm:px-6">
                {(mode === "offer" || mode === "gift") && (
                  <fieldset disabled={busy}>
                    <legend className="mb-2 text-xs font-medium text-white/45">
                      {ownGift
                        ? "Who gets your last card"
                        : "Choose your trade partner"}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {targets.map((player) => (
                        <Button
                          key={player.id}
                          type="button"
                          variant="outline"
                          aria-pressed={targetId === player.id}
                          onClick={() => setTargetId(player.id)}
                          className={`${button} max-w-full border ${targetId === player.id ? "border-white bg-white text-neutral-950 hover:bg-white/86" : "border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white"}`}
                        >
                          <span className="block max-w-48 truncate">
                            {player.name}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                )}
                {mode === "outgoing" ? (
                  <div
                    inert
                    className="flex items-center justify-center gap-8 py-7"
                  >
                    {playerGame?.hand.find(
                      (card) => card.id === playerGame.offeredTradeCardId
                    ) && (
                      <UnoCard
                        card={
                          playerGame.hand.find(
                            (card) => card.id === playerGame.offeredTradeCardId
                          )!
                        }
                        size="sm"
                        static
                      />
                    )}
                    <ArrowLeftRight className="text-white/35" size={24} />
                    <UnoCard card={backCard} faceDown size="sm" static />
                  </div>
                ) : (
                  <fieldset disabled={busy} className="mt-5">
                    <legend className="mb-3 text-xs font-medium text-white/45">
                      {ownGift
                        ? `Your frozen hand · ${cards.length} cards`
                        : "Choose one card to send"}
                    </legend>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] items-start justify-items-center gap-x-2 gap-y-4 pt-2 pb-3">
                      {cards.map((card) => (
                        <div
                          key={card.id}
                          className={`relative flex rounded-[8px] outline-2 outline-offset-2 transition-[outline-color] ${cardId === card.id ? "outline-white/85" : "outline-transparent"}`}
                        >
                          <UnoCard
                            card={card}
                            size="sm"
                            static
                            style={{ transform: "none" }}
                            disabled={busy}
                            onClick={() => setCardId(card.id)}
                            ariaLabel={`Choose ${cardName(card)}`}
                          />
                          {cardId === card.id && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border border-neutral-950 bg-white text-neutral-950 shadow-sm"
                            >
                              <Check size={12} strokeWidth={2.5} />
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
              <footer className="shrink-0 border-t border-white/10 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
                {error && (
                  <p role="alert" className="mb-3 text-sm text-red-300">
                    {error}
                  </p>
                )}
                {!connected && (
                  <p role="status" className="mb-3 text-sm text-white/60">
                    Reconnecting…
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !connected}
                    className={`${button} border border-white/10 text-white/65 hover:bg-white/5`}
                    onClick={() => {
                      if (ownGift && gift)
                        send((ack) =>
                          socket!.emit(
                            "game:resolveLastGift",
                            { giftId: gift.id },
                            ack
                          )
                        )
                      else if (incoming && offer)
                        send((ack) =>
                          socket!.emit(
                            "game:respondBlindTrade",
                            { offerId: offer.id, accept: false },
                            ack
                          )
                        )
                      else if (outgoing && offer)
                        send((ack) =>
                          socket!.emit(
                            "game:cancelBlindTrade",
                            { offerId: offer.id },
                            ack
                          )
                        )
                      else setOpen(false)
                    }}
                  >
                    {ownGift
                      ? "Leave no gift"
                      : incoming
                        ? "Decline"
                        : "Cancel"}
                  </Button>
                  {mode !== "outgoing" && (
                    <Button
                      type="button"
                      disabled={
                        busy ||
                        !connected ||
                        !selected ||
                        ((mode === "offer" || ownGift) && !selectedTarget) ||
                        (Boolean(deadline) && seconds === 0)
                      }
                      className={`${button} flex min-w-0 flex-1 items-center justify-center gap-2 bg-white text-neutral-950 hover:bg-white/86`}
                      onClick={() => {
                        if (ownGift && gift)
                          send((ack) =>
                            socket!.emit(
                              "game:resolveLastGift",
                              {
                                giftId: gift.id,
                                cardId,
                                targetPlayerId: targetId,
                              },
                              ack
                            )
                          )
                        else if (incoming && offer)
                          send((ack) =>
                            socket!.emit(
                              "game:respondBlindTrade",
                              { offerId: offer.id, accept: true, cardId },
                              ack
                            )
                          )
                        else
                          send((ack) =>
                            socket!.emit(
                              "game:offerBlindTrade",
                              { cardId, targetPlayerId: targetId },
                              ack
                            )
                          )
                      }}
                    >
                      {busy ? (
                        <LoaderCircle
                          size={17}
                          className="animate-spin motion-reduce:animate-none"
                        />
                      ) : ownGift ? (
                        <Gift size={17} />
                      ) : (
                        <ArrowLeftRight size={17} />
                      )}
                      <span className="truncate">
                        {ownGift
                          ? `Give to ${selectedTarget?.name ?? "…"}`
                          : incoming
                            ? "Lock card & trade"
                            : "Offer face down"}
                      </span>
                    </Button>
                  )}
                </div>
              </footer>
            </div>
            <style>{`@keyframes party-in { from { opacity: 0; transform: translateY(16px) scale(.985) } to { opacity: 1; transform: translateY(0) scale(1) } } @keyframes party-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } } .party-panel { animation: party-in 180ms ease-out } .party-sheet { animation: party-sheet-up 240ms cubic-bezier(0.2,0,0,1) } @media (prefers-reduced-motion: reduce) { .party-panel { animation: none } }`}</style>
          </div>,
          document.body
        )}
    </>
  )
}

const backCard: Card = { id: "hidden", color: "wild", face: { kind: "wild" } }

function cardName(card: Card) {
  const face = card.face
  return `${card.color} ${face.kind === "number" ? face.value : face.kind === "draw" || face.kind === "wild-draw" ? `plus ${face.count}` : face.kind.replaceAll("-", " ")}`
}
