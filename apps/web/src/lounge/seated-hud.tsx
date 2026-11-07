import { useEffect, useState } from "react"
import { DoorOpen, Eye, LayoutGrid } from "lucide-react"

import { lounge } from "./lounge-store"
import { cardColorCss } from "./textures"
import { isEditableTarget } from "./controls"
import { FullscreenButton } from "./fullscreen-button"
import type { SeatedPlay } from "./seated-play"
import type { Spectate } from "./spectate"
import type { PlayColor, RoomSnapshot } from "@workspace/game"
import { MusicButton } from "@/components/music-player"
import {
  TOOLBAR_BUTTON,
  ToolbarDivider,
  ToolbarGroup,
} from "@/components/toolbar"

const COLORS: Array<PlayColor> = ["red", "yellow", "green", "blue"]

const PILL =
  "pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-[transform,background-color,opacity] duration-150 ease-out active:scale-[0.95] disabled:pointer-events-none disabled:opacity-35"
const PILL_PRIMARY = PILL + " bg-white text-black"
const PILL_QUIET =
  PILL +
  " border border-white/12 bg-[#0b0a0d]/70 text-white/90 backdrop-blur-md"

/**
 * Controls for playing at the 3D table. Cards are picked and thrown in 3D;
 * this bar holds what a hand can't: draw, pass, colour, UNO and friends.
 */
export type RoomActions = {
  setReady: (ready: boolean) => void
  startGame: () => void
  restartGame: () => void
  copyInvite: () => Promise<void>
}

export function SeatedHud({
  room,
  selfId,
  seated,
  spectate,
  roomActions,
}: {
  room: RoomSnapshot
  selfId: string
  seated: SeatedPlay
  spectate: Spectate
  roomActions: RoomActions
}) {
  const game = room.game
  const { play, choices } = seated
  const turnName =
    room.players.find((player) => player.id === game?.turnPlayerId)?.name ??
    "Someone"

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey)
        return
      const key = event.key.toLowerCase()
      if (key === "enter") {
        event.preventDefault()
        if (seated.selectedIds.length) seated.submit()
        else if (seated.canPassTurn) seated.actions.endTurn()
      }
      if (key === "d" && seated.canDraw) seated.actions.drawCard()
      if (key === "escape") seated.clear()
      if (key === "tab") {
        event.preventDefault()
        lounge.showClassic()
      }
      if (key === "u" && play.canDeclareUno)
        seated.updateChoices({ declaredUno: !choices.declaredUno })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [seated, play.canDeclareUno, choices.declaredUno])

  let status: string
  if (!game || room.status === "lobby")
    status = "Waiting for the match to start"
  else if (room.status === "finished") status = "Match over"
  else if (seated.rouletteForMe) status = "Colour roulette: draw until it lands"
  else if (seated.isMyTurn && play.needsColor && !choices.chosenColor)
    status = "Pick a colour"
  else if (seated.isMyTurn && seated.selectedIds.length)
    status = "Throw it on the pile, or press Play"
  else if (seated.isMyTurn && seated.drawStack)
    status = `+${seated.drawStack.amount} coming your way: stack or take it`
  else if (seated.isMyTurn) status = "Your turn: flick a card onto the pile"
  else status = `${turnName}'s turn`

  const showColors = seated.isMyTurn && play.needsColor
  const selectedCount = seated.selectedIds.length

  return (
    <div className="pointer-events-none absolute inset-0 text-white antialiased">
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <ToolbarGroup
          label="Table controls"
          className="pointer-events-auto bg-[#0b0a0d]/75 backdrop-blur-md"
        >
          <MusicButton />
          <FullscreenButton />
          <ToolbarDivider />
          <button
            type="button"
            className={TOOLBAR_BUTTON}
            onClick={() => lounge.showClassic()}
            aria-label="Switch to the classic table view"
            title="Table view (Tab)"
          >
            <LayoutGrid className="size-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            className={TOOLBAR_BUTTON}
            onClick={() => lounge.stand()}
            aria-label="Stand up"
            title="Stand up (E)"
          >
            <DoorOpen className="size-4" strokeWidth={2} />
          </button>
        </ToolbarGroup>
      </div>

      {seated.needsClassic && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 sm:top-4">
          <button
            type="button"
            onClick={() => lounge.showClassic()}
            className={
              PILL_PRIMARY + " shadow-[0_0_30px_rgba(255,255,255,0.3)]"
            }
          >
            Something needs your answer · open table view
          </button>
        </div>
      )}

      {!spectate.inactive &&
        (spectate.backers.length > 0 || spectate.requests.length > 0) && (
          <BackerChips spectate={spectate} />
        )}

      {room.status === "lobby" ? (
        <LobbyPanel room={room} selfId={selfId} actions={roomActions} />
      ) : room.status === "finished" ? (
        <MatchOverPanel room={room} selfId={selfId} actions={roomActions} />
      ) : spectate.inactive ? (
        <SpectatePanel spectate={spectate} room={room} />
      ) : (
        <>
          {/* Sits just above the held cards. */}
          <div className="absolute inset-x-0 bottom-[max(37%,13rem)] flex flex-col items-center gap-2 px-3">
            <p
              aria-live="polite"
              className={
                "rounded-full px-3 py-1 text-xs font-medium backdrop-blur-md " +
                (seated.isMyTurn
                  ? "bg-white/90 text-black"
                  : "bg-[#0b0a0d]/70 text-white/75")
              }
            >
              {status}
            </p>

            {showColors && (
              <div
                role="radiogroup"
                aria-label="Colour for the wild card"
                className="pointer-events-auto flex gap-2 rounded-full bg-[#0b0a0d]/70 p-1.5 backdrop-blur-md"
              >
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={choices.chosenColor === color}
                    aria-label={color}
                    onClick={() => seated.chooseColor(color)}
                    style={{ background: cardColorCss(color) }}
                    className={
                      "size-9 rounded-full transition-transform duration-150 ease-out active:scale-[0.9] " +
                      (choices.chosenColor === color
                        ? "ring-2 ring-white ring-offset-2 ring-offset-black"
                        : "")
                    }
                  />
                ))}
              </div>
            )}

            {seated.isMyTurn && play.canChooseSwap && (
              <div className="pointer-events-auto flex flex-wrap justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    seated.updateChoices({ wantsSwap: !choices.wantsSwap })
                  }
                  className={choices.wantsSwap ? PILL_PRIMARY : PILL_QUIET}
                >
                  Swap hands
                </button>
                {choices.wantsSwap &&
                  seated.swapTargets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() =>
                        seated.updateChoices({ swapWithPlayerId: target.id })
                      }
                      className={
                        choices.swapWithPlayerId === target.id
                          ? PILL_PRIMARY
                          : PILL_QUIET
                      }
                    >
                      {target.name}
                    </button>
                  ))}
              </div>
            )}

            {seated.isMyTurn && play.canChooseRotate && (
              <button
                type="button"
                onClick={() =>
                  seated.updateChoices({ wantsRotate: !choices.wantsRotate })
                }
                className={choices.wantsRotate ? PILL_PRIMARY : PILL_QUIET}
              >
                Rotate all hands
              </button>
            )}

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {seated.catchable.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => seated.actions.catchUno(target.id)}
                  className={PILL + " bg-[#ff3d5a] text-white"}
                >
                  Catch {target.name}!
                </button>
              ))}
              {seated.rouletteForMe && (
                <button
                  type="button"
                  onClick={() => seated.actions.drawRouletteCard()}
                  className={PILL_PRIMARY}
                >
                  Draw roulette card
                </button>
              )}
              {seated.canTakePenalty && (
                <button
                  type="button"
                  onClick={() => seated.actions.takePenalty()}
                  className={PILL_QUIET}
                >
                  Take +{seated.drawStack?.amount ?? ""}
                </button>
              )}
              {seated.canDraw && selectedCount === 0 && (
                <button
                  type="button"
                  onClick={() => seated.actions.drawCard()}
                  className={PILL_QUIET}
                  title="Draw (D), or click the deck"
                >
                  Draw
                </button>
              )}
              {play.canDeclareUno && (
                <button
                  type="button"
                  aria-pressed={choices.declaredUno}
                  onClick={() =>
                    seated.updateChoices({ declaredUno: !choices.declaredUno })
                  }
                  className={
                    choices.declaredUno
                      ? PILL + " bg-[#ffd23d] text-black"
                      : PILL_QUIET
                  }
                  title="Call UNO with this play (U)"
                >
                  UNO!
                </button>
              )}
              {selectedCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => seated.clear()}
                    className={PILL_QUIET}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!play.canSubmitPlay}
                    onClick={() => seated.submit()}
                    className={PILL_PRIMARY}
                    title="Play (Enter)"
                  >
                    Play {selectedCount > 1 ? `${selectedCount} cards` : ""}
                  </button>
                </>
              )}
              {seated.canPassTurn && (
                <button
                  type="button"
                  onClick={() => seated.actions.endTurn()}
                  className={PILL_PRIMARY}
                  title="Pass (Enter)"
                >
                  Pass
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** For a player still in: who's watching your hand, and who asks to. */
function BackerChips({ spectate }: { spectate: Spectate }) {
  return (
    <div className="absolute top-16 left-3 flex max-w-[calc(100vw-1.5rem)] flex-col items-start gap-1.5 sm:top-4 sm:left-4">
      {spectate.backers.map((backer) => (
        <div
          key={backer.id}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#0b0a0d]/75 py-1 pr-1 pl-3 text-xs text-white/85 backdrop-blur-md"
        >
          <Eye className="size-3.5 text-white/60" strokeWidth={2} />
          {backer.name} is watching your hand
          <button
            type="button"
            onClick={() => spectate.kick(backer.id)}
            className="rounded-full bg-white/[0.08] px-2.5 py-1 font-semibold active:scale-[0.95]"
          >
            Kick
          </button>
        </div>
      ))}
      {spectate.requests.map((request) => (
        <div
          key={request.id}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-amber-300/15 py-1 pr-1 pl-3 text-xs text-amber-50 backdrop-blur-md"
        >
          {request.name} asks to back you
          <button
            type="button"
            onClick={() => spectate.respond(request.id, true)}
            className="rounded-full bg-white px-2.5 py-1 font-semibold text-black active:scale-[0.95]"
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => spectate.respond(request.id, false)}
            className="rounded-full bg-white/[0.08] px-2.5 py-1 font-semibold active:scale-[0.95]"
          >
            Decline
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * Out of the match: pick someone to back and watch their hand over their
 * shoulder, like supporting on the classic table.
 */
function SpectatePanel({
  spectate,
  room,
}: {
  spectate: Spectate
  room: RoomSnapshot
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const game = room.game
  const watchedTurn =
    spectate.watchingId !== null && game?.turnPlayerId === spectate.watchingId
  // A pick that's no longer possible (they went out) is forgotten.
  useEffect(() => {
    if (confirming && !spectate.candidates.some((c) => c.id === confirming))
      setConfirming(null)
  }, [confirming, spectate.candidates])

  let status: string
  if (spectate.watchingName)
    status = watchedTurn
      ? `${spectate.watchingName}'s turn · you're watching their hand`
      : `Backing ${spectate.watchingName} · watching their hand`
  else if (spectate.waitingOn)
    status = `Asked ${spectate.waitingOn} to let you back them`
  else if (spectate.candidates.length)
    status = "You're out this match. Back someone to watch their hand"
  else status = "You're out this match"

  return (
    <div className="absolute inset-x-0 bottom-[max(37%,13rem)] flex flex-col items-center gap-2 px-3">
      <p
        aria-live="polite"
        className={
          "rounded-full px-3 py-1 text-xs font-medium backdrop-blur-md " +
          (watchedTurn
            ? "bg-white/90 text-black"
            : "bg-[#0b0a0d]/70 text-white/80")
        }
      >
        {status}
      </p>
      {!spectate.watchingId && !spectate.waitingOn && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {spectate.candidates.map((candidate) =>
            confirming === candidate.id ? (
              <span key={candidate.id} className="inline-flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    spectate.back(candidate)
                    setConfirming(null)
                  }}
                  className={PILL_PRIMARY}
                >
                  {candidate.askFirst
                    ? `Ask ${candidate.name}`
                    : `Back ${candidate.name}?`}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className={PILL_QUIET}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setConfirming(candidate.id)}
                className={PILL_QUIET}
              >
                <Eye className="size-3.5" strokeWidth={2} />
                {candidate.name}
                {candidate.askFirst && (
                  <span className="text-white/50">· ask</span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Waiting at the table before a match: who's here and ready, and the one
 * button that matters to you (ready up, or start as host). House rules and
 * seat order live in the classic view, one tap away.
 */
function LobbyPanel({
  room,
  selfId,
  actions,
}: {
  room: RoomSnapshot
  selfId: string
  actions: RoomActions
}) {
  const [copied, setCopied] = useState(false)
  const isHost = room.hostPlayerId === selfId
  const self = room.players.find((player) => player.id === selfId)
  const others = room.players.filter(
    (player) => player.id !== room.hostPlayerId
  )
  const notReady = others.filter((player) => !player.ready)
  const enough = room.players.length >= 2
  const canStart = isHost && enough && notReady.length === 0
  const hostName =
    room.players.find((player) => player.id === room.hostPlayerId)?.name ??
    "The host"

  let status: string
  if (!enough) status = "Waiting for friends · invite someone to play"
  else if (notReady.length > 0)
    status =
      notReady.length === 1
        ? `Waiting for ${notReady[0].id === selfId ? "you" : notReady[0].name} to get ready`
        : `${notReady.length} players still getting ready`
  else if (isHost) status = "Everyone's ready"
  else status = `Everyone's ready · waiting for ${hostName} to start`

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1_600)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="absolute inset-x-0 bottom-[max(18%,7rem)] flex flex-col items-center gap-2.5 px-3">
      <div className="pointer-events-auto flex flex-wrap justify-center gap-1.5">
        {room.players.map((player) => {
          const ready = player.id === room.hostPlayerId || player.ready
          return (
            <span
              key={player.id}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs backdrop-blur-md " +
                (ready
                  ? "bg-emerald-400/15 text-emerald-50"
                  : "bg-[#0b0a0d]/70 text-white/70")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "size-1.5 rounded-full " +
                  (ready ? "bg-emerald-300" : "bg-white/30")
                }
              />
              {player.id === selfId ? "You" : player.name}
              {player.id === room.hostPlayerId && (
                <span className="text-white/45">host</span>
              )}
            </span>
          )
        })}
      </div>
      <p
        aria-live="polite"
        className="rounded-full bg-[#0b0a0d]/70 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-md"
      >
        {status}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            void actions.copyInvite().then(() => setCopied(true))
          }}
          className={PILL_QUIET}
        >
          {copied ? "Link copied" : "Copy invite"}
        </button>
        {isHost ? (
          <button
            type="button"
            disabled={!canStart}
            onClick={() => actions.startGame()}
            className={PILL_PRIMARY}
          >
            Start game
          </button>
        ) : (
          <button
            type="button"
            aria-pressed={Boolean(self?.ready)}
            onClick={() => actions.setReady(!self?.ready)}
            className={self?.ready ? PILL_QUIET : PILL_PRIMARY}
          >
            {self?.ready ? "Not ready" : "I'm ready"}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Between matches: who won, and the next-match button for whoever gets to
 * press it (last winner, else the host), same as the classic table.
 */
function MatchOverPanel({
  room,
  selfId,
  actions,
}: {
  room: RoomSnapshot
  selfId: string
  actions: RoomActions
}) {
  const game = room.game
  const nameOf = (id: string | null | undefined) =>
    room.players.find((player) => player.id === id)?.name ?? "Someone"
  const winnerId =
    game?.winnerPlacements.find((placement) => placement.position === 1)
      ?.playerId ?? game?.winnerPlayerId
  const crownId =
    room.crownPlayerId &&
    room.players.some((player) => player.id === room.crownPlayerId)
      ? room.crownPlayerId
      : null
  const organiserId = crownId ?? room.hostPlayerId
  const isOrganiser = organiserId === selfId
  const enough = room.players.length >= 2

  return (
    <div className="absolute inset-x-0 bottom-[max(30%,10rem)] flex flex-col items-center gap-2.5 px-3">
      <p className="rounded-full bg-[#ffd23d] px-3.5 py-1.5 text-sm font-semibold text-[#1a1200]">
        🏆 {winnerId === selfId ? "You win!" : `${nameOf(winnerId)} wins`}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => lounge.showClassic()}
          className={PILL_QUIET}
        >
          Match recap
        </button>
        {isOrganiser ? (
          <button
            type="button"
            disabled={!enough}
            onClick={() => actions.restartGame()}
            className={PILL_PRIMARY}
          >
            Next match
          </button>
        ) : (
          <span className="rounded-full bg-[#0b0a0d]/70 px-3 py-2 text-xs text-white/70 backdrop-blur-md">
            Waiting for {nameOf(organiserId)} to start the next match
          </span>
        )}
      </div>
    </div>
  )
}
