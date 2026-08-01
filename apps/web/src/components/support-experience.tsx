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

export function SupportConfirmDialog({
  playerName,
  onCancel,
  onConfirm,
}: {
  playerName: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-confirm-title"
        className="w-full max-w-sm rounded-3xl border border-white/12 bg-[#11100d] p-5 text-white shadow-[0_28px_90px_rgba(0,0,0,0.66)]"
      >
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
          You&apos;ll see {playerName}&apos;s full hand in real time and drop
          into their Squad chat.
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
      </section>
    </div>
  )
}
