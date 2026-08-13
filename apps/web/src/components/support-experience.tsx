import type { ReactNode } from "react"

import type { ChatChannel, PlayerGamePublic } from "@workspace/game"

export function mentionablePlayersForChannel<T extends { id: string }>(
  players: Array<T>,
  channel: ChatChannel,
  squadMemberIds: Array<string>
): Array<T> {
  if (channel === "public") return players
  const memberIds = new Set(squadMemberIds)
  return players.filter((player) => memberIds.has(player.id))
}

export function availableSupportCandidates(
  players: Array<
    Pick<
      PlayerGamePublic,
      "playerId" | "eliminated" | "waiting" | "winnerPlacement"
    > & {
      voteKicked?: boolean
    }
  >,
  blockedSupportedPlayerIds: Array<string>,
  supporterPlayerId: string
) {
  return players.filter(
    (player) =>
      player.playerId !== supporterPlayerId &&
      !player.eliminated &&
      !player.waiting &&
      !player.voteKicked &&
      !player.winnerPlacement &&
      !blockedSupportedPlayerIds.includes(player.playerId)
  )
}

/**
 * Shown to a player who kicked someone and is now being asked back. One card
 * per pending request, oldest first.
 */
export function SupportRequestInbox({
  requests,
  onRespond,
}: {
  requests: Array<{ supporterPlayerId: string; supporterName: string }>
  onRespond: (supporterPlayerId: string, approve: boolean) => void
}) {
  if (requests.length === 0) return null

  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      {requests.map((request) => (
        <div
          key={request.supporterPlayerId}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-50 shadow-[0_14px_34px_rgba(0,0,0,0.26)] backdrop-blur-md"
          role="group"
          aria-label={`Support request from ${request.supporterName}`}
        >
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">{request.supporterName}</span> wants
            to support you
          </span>
          <button
            type="button"
            onClick={() => onRespond(request.supporterPlayerId, false)}
            className="h-8 rounded-lg border border-white/12 bg-white/[0.06] px-3 text-xs font-medium text-white/72 hover:bg-white/[0.1]"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onRespond(request.supporterPlayerId, true)}
            className="h-8 rounded-lg bg-white px-3 text-xs font-semibold text-neutral-950 hover:bg-white/86"
          >
            Let them in
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * Centred card on desktop, bottom sheet on a phone — a modal pinned to the
 * middle of a small screen is awkward to reach and reads like an error.
 */
function SupportSheet({
  titleId,
  sheet,
  children,
}: {
  titleId: string
  sheet: boolean
  children: ReactNode
}) {
  return (
    <div
      className={
        "fixed inset-0 z-[90] bg-black/70 px-4 backdrop-blur-sm " +
        (sheet ? "flex items-end pb-0" : "grid place-items-center")
      }
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          "w-full border border-white/12 bg-[#11100d] p-5 text-white shadow-[0_-24px_90px_rgba(0,0,0,0.7)] " +
          (sheet
            ? "-mx-4 max-w-none animate-[support-sheet-up_240ms_cubic-bezier(0.2,0,0,1)] rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
            : "max-w-sm rounded-3xl shadow-[0_28px_90px_rgba(0,0,0,0.66)]")
        }
      >
        <style>
          {`@keyframes support-sheet-up {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }`}
        </style>
        {sheet && (
          <span
            aria-hidden="true"
            className="mx-auto mb-4 block h-1 w-10 rounded-full bg-white/20"
          />
        )}
        {children}
      </section>
    </div>
  )
}

export function SupportConfirmDialog({
  playerName,
  needsApproval = false,
  asSheet = false,
  onCancel,
  onConfirm,
}: {
  playerName: string
  /** True after this player was kicked once: the pick becomes a request. */
  needsApproval?: boolean
  /** Render as a bottom sheet instead of a centred dialog. */
  asSheet?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (needsApproval) {
    return (
      <SupportSheet titleId="support-request-title" sheet={asSheet}>
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-amber-200/20 bg-amber-300/12 text-2xl">
          ✋
        </div>
        <h2
          id="support-request-title"
          className="mt-4 text-center text-xl font-semibold"
        >
          Ask {playerName} again?
        </h2>
        <p className="mt-2 text-center text-sm leading-6 text-white/58">
          {playerName} removed you from their squad, so this one is their call.
          They&apos;ll get a request and can wave you back in—or not.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-xl border border-white/10 bg-white/[0.05] text-sm font-medium text-white/70 hover:bg-white/[0.08]"
          >
            Never mind
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-11 rounded-xl bg-white px-3 text-sm font-semibold text-neutral-950 hover:bg-white/86"
          >
            Send request
          </button>
        </div>
      </SupportSheet>
    )
  }

  return (
    <SupportSheet titleId="support-confirm-title" sheet={asSheet}>
      <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-pink-200/20 bg-pink-300/12 text-2xl">
        🙌
      </div>
      <h2
        id="support-confirm-title"
        className="mt-4 text-center text-xl font-semibold"
      >
        Ride with {playerName}?
      </h2>
      <p className="mt-2 text-center text-sm leading-6 text-white/58">
        You&apos;ll see {playerName}&apos;s full hand in real time and drop into
        their Squad chat.
        <br />
        Pick once—you&apos;re locked to them for the rest of this game. No
        takebacks.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl border border-white/10 bg-white/[0.05] text-sm font-medium text-white/70 hover:bg-white/[0.08]"
        >
          Not yet
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-11 rounded-xl bg-white px-3 text-sm font-semibold text-neutral-950 hover:bg-white/86"
        >
          Ride or die
        </button>
      </div>
    </SupportSheet>
  )
}
