import { Link, createFileRoute } from "@tanstack/react-router"
import {
  Activity,
  ArrowUpRight,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Trophy,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import type {
  AnalysisRoomSummary,
  AnalysisRoomsResponse,
  RoomStatus,
} from "@workspace/game"

import { getAnalysisRooms } from "@/lib/realtime"

export const Route = createFileRoute("/analysis")({
  component: AnalysisPage,
  head: () => ({
    meta: [{ title: "Live Room Analysis | UNO No Mercy" }],
  }),
})

type RoomFilter = "all" | RoomStatus

const statusPriority: Record<RoomStatus, number> = {
  playing: 0,
  lobby: 1,
  finished: 2,
}

function AnalysisPage() {
  const [data, setData] = useState<AnalysisRoomsResponse | null>(null)
  const [filter, setFilter] = useState<RoomFilter>("all")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)

  const loadRooms = useCallback(async () => {
    setRefreshing(true)

    try {
      const result = await getAnalysisRooms()
      if (!result.ok) {
        setError(result.error.message)
        return
      }

      setData(result.data)
      setLastRefreshedAt(result.data.generatedAt)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not reach the game server."
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadRooms()
    const intervalId = window.setInterval(() => void loadRooms(), 5000)

    return () => window.clearInterval(intervalId)
  }, [loadRooms])

  const rooms = useMemo(() => {
    const filteredRooms = (data?.rooms ?? []).filter(
      (room) => filter === "all" || room.status === filter
    )

    return filteredRooms.slice().sort((a, b) => {
      const statusDifference =
        statusPriority[a.status] - statusPriority[b.status]
      if (statusDifference !== 0) return statusDifference
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    })
  }, [data?.rooms, filter])

  const totals = data?.totals ?? {
    rooms: 0,
    playing: 0,
    lobby: 0,
    finished: 0,
    totalPlayers: 0,
    onlinePlayers: 0,
  }

  return (
    <main className="min-h-dvh bg-[#090909] text-white antialiased">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-9">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.2em] text-white/45 uppercase">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
              </span>
              Live room monitor
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Table activity
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/52">
              A live view of every room held in the current game server memory.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.09] hover:text-white sm:self-auto"
            onClick={() => void loadRooms()}
            disabled={refreshing}
            aria-label="Refresh room data"
            title="Refresh room data"
          >
            {refreshing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Refresh
          </Button>
        </header>

        <section
          aria-label="Live room totals"
          className="grid grid-cols-2 border-b border-white/10 sm:grid-cols-3 lg:grid-cols-6"
        >
          <Metric label="Rooms" value={totals.rooms} icon={<Activity />} />
          <Metric
            label="Playing"
            value={totals.playing}
            tone="text-emerald-300"
            icon={<span className="size-2 rounded-full bg-emerald-300" />}
          />
          <Metric
            label="Lobby"
            value={totals.lobby}
            tone="text-sky-300"
            icon={<span className="size-2 rounded-full bg-sky-300" />}
          />
          <Metric
            label="Finished"
            value={totals.finished}
            tone="text-amber-200"
            icon={<span className="size-2 rounded-full bg-amber-200" />}
          />
          <Metric
            label="Players"
            value={totals.totalPlayers}
            icon={<Users />}
          />
          <Metric
            label="Online now"
            value={totals.onlinePlayers}
            tone="text-emerald-300"
            icon={<Wifi />}
          />
        </section>

        <section className="mt-7 flex flex-col gap-4 sm:mt-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Rooms</h2>
            <p className="mt-1 text-sm text-white/42">
              {rooms.length} {rooms.length === 1 ? "room" : "rooms"} in this
              view
            </p>
          </div>

          <div
            className="flex w-full overflow-x-auto rounded-lg border border-white/10 bg-white/[0.035] p-1 sm:w-auto"
            role="group"
            aria-label="Filter rooms by status"
          >
            <FilterButton
              active={filter === "all"}
              label="All"
              count={totals.rooms}
              onClick={() => setFilter("all")}
            />
            <FilterButton
              active={filter === "playing"}
              label="Playing"
              count={totals.playing}
              onClick={() => setFilter("playing")}
            />
            <FilterButton
              active={filter === "lobby"}
              label="Lobby"
              count={totals.lobby}
              onClick={() => setFilter("lobby")}
            />
            <FilterButton
              active={filter === "finished"}
              label="Finished"
              count={totals.finished}
              onClick={() => setFilter("finished")}
            />
          </div>
        </section>

        {error ? (
          <div className="mt-5 flex flex-col gap-3 rounded-lg border border-red-300/20 bg-red-400/[0.08] px-4 py-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
            <p>{error}</p>
            <button
              type="button"
              className="self-start font-medium text-red-100 underline decoration-red-100/35 underline-offset-4 hover:decoration-red-100 sm:self-auto"
              onClick={() => void loadRooms()}
            >
              Try again
            </button>
          </div>
        ) : null}

        {loading ? (
          <LoadingState />
        ) : rooms.length === 0 ? (
          <EmptyState hasRooms={Boolean(data?.rooms.length)} />
        ) : (
          <>
            <div className="mt-5 hidden overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] lg:block">
              <div className="grid grid-cols-[minmax(150px,1.25fr)_96px_126px_minmax(220px,1.6fr)_124px_minmax(180px,1fr)] items-center gap-4 border-b border-white/10 px-5 py-3 text-[10px] font-medium tracking-[0.16em] text-white/35 uppercase">
                <span>Room</span>
                <span>Status</span>
                <span>Players</span>
                <span>Participants</span>
                <span>Duration</span>
                <span>Game detail</span>
              </div>
              {rooms.map((room) => (
                <DesktopRoomRow key={room.code} room={room} />
              ))}
            </div>

            <div className="mt-5 space-y-3 lg:hidden">
              {rooms.map((room) => (
                <MobileRoomRow key={room.code} room={room} />
              ))}
            </div>
          </>
        )}

        <footer className="mt-7 flex flex-col gap-1 text-xs text-white/32 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Auto-refreshes every 5 seconds
          </span>
          <span>
            {lastRefreshedAt
              ? `Last refreshed ${formatTimestamp(lastRefreshedAt)}`
              : "Waiting for the first refresh"}
          </span>
        </footer>
      </div>
    </main>
  )
}

function Metric({
  label,
  value,
  tone = "text-white",
  icon,
}: {
  label: string
  value: number
  tone?: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex min-h-[94px] flex-col justify-between border-r border-white/10 px-3 py-4 first:border-l sm:px-4 lg:min-h-[104px] lg:px-5">
      <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.15em] text-white/38 uppercase">
        <span className="flex size-3 items-center justify-center">{icon}</span>
        {label}
      </div>
      <strong className={`text-2xl font-semibold tracking-tight ${tone}`}>
        {value}
      </strong>
    </div>
  )
}

function FilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors ${
        active
          ? "bg-white text-neutral-950 shadow-sm"
          : "text-white/48 hover:bg-white/[0.07] hover:text-white/80"
      }`}
      onClick={onClick}
    >
      {label}
      <span className={active ? "text-neutral-950/50" : "text-white/28"}>
        {count}
      </span>
    </button>
  )
}

function DesktopRoomRow({ room }: { room: AnalysisRoomSummary }) {
  return (
    <div className="grid grid-cols-[minmax(150px,1.25fr)_96px_126px_minmax(220px,1.6fr)_124px_minmax(180px,1fr)] items-start gap-4 border-b border-white/[0.07] px-5 py-4 last:border-b-0 hover:bg-white/[0.025]">
      <RoomCode room={room} />
      <StatusBadge status={room.status} />
      <PlayerCount room={room} />
      <PlayerList room={room} />
      <DurationDetail room={room} />
      <GameDetail room={room} />
    </div>
  )
}

function MobileRoomRow({ room }: { room: AnalysisRoomSummary }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.025] p-4 shadow-[0_12px_32px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <RoomCode room={room} />
        <StatusBadge status={room.status} />
      </div>

      <div className="mt-4 grid grid-cols-3 border-y border-white/[0.08] py-3">
        <MiniDetail label="Players">
          <PlayerCount room={room} compact />
        </MiniDetail>
        <MiniDetail label="Duration">
          <span className="inline-flex items-center gap-1.5 text-sm text-white/80">
            <Clock3 className="size-3.5 text-white/38" />
            {formatDuration(room.durationMs)}
          </span>
        </MiniDetail>
        <MiniDetail label="Idle">
          <span className="text-sm text-white/80">
            {formatIdle(room.idleDurationMs)}
          </span>
        </MiniDetail>
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-medium tracking-[0.16em] text-white/35 uppercase">
          Participants
        </p>
        <PlayerList room={room} />
      </div>

      {room.game ? (
        <div className="mt-4 border-t border-white/[0.08] pt-3">
          <GameDetail room={room} />
        </div>
      ) : null}
    </article>
  )
}

function RoomCode({ room }: { room: AnalysisRoomSummary }) {
  return (
    <div className="min-w-0">
      <Link
        to="/room/$roomCode"
        params={{ roomCode: room.code }}
        className="group inline-flex max-w-full items-center gap-1.5 font-mono text-sm font-semibold tracking-[0.12em] text-white transition-colors hover:text-amber-200"
      >
        <span className="truncate">{room.code}</span>
        <ArrowUpRight className="size-3.5 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-amber-200" />
      </Link>
      <p className="mt-1 text-xs text-white/35">
        v{room.version} - {formatTimestamp(room.createdAt)}
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: RoomStatus }) {
  const styles = {
    playing: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
    lobby: "border-sky-300/20 bg-sky-300/10 text-sky-200",
    finished: "border-amber-200/20 bg-amber-200/10 text-amber-100",
  }

  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium capitalize ${styles[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

function PlayerCount({
  room,
  compact = false,
}: {
  room: AnalysisRoomSummary
  compact?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-2 ${compact ? "text-sm" : "text-xs"}`}
    >
      <Users className="size-3.5 shrink-0 text-white/38" />
      <span className="text-white/80">{room.playerCount}</span>
      <span className="text-white/28">/</span>
      <span className="inline-flex items-center gap-1 text-emerald-200/75">
        <Wifi className="size-3" />
        {room.connectedPlayerCount}
      </span>
    </div>
  )
}

function PlayerList({ room }: { room: AnalysisRoomSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {room.players.map((player) => (
        <span
          key={`${room.code}-${player.seat}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-xs text-white/70"
          title={`${player.name} - seat ${player.seat}`}
        >
          {player.connected ? (
            <Wifi className="size-3 shrink-0 text-emerald-300/80" />
          ) : (
            <WifiOff className="size-3 shrink-0 text-white/25" />
          )}
          <span className="truncate">{player.name}</span>
          <span
            className={
              player.connected
                ? "text-[9px] text-emerald-200/70"
                : "text-[9px] text-white/30"
            }
          >
            {player.connected ? "Online" : "Away"}
          </span>
          {player.isHost ? (
            <span className="text-[9px] text-amber-200/70">H</span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function DurationDetail({ room }: { room: AnalysisRoomSummary }) {
  return (
    <div className="text-xs">
      <div className="inline-flex items-center gap-1.5 text-white/80">
        <Clock3 className="size-3.5 text-white/38" />
        {formatDuration(room.durationMs)}
      </div>
      <p className="mt-1 text-[11px] text-white/35">
        {formatIdle(room.idleDurationMs)}
      </p>
    </div>
  )
}

function GameDetail({ room }: { room: AnalysisRoomSummary }) {
  if (!room.game) {
    return <span className="text-xs text-white/30">Waiting to start</span>
  }

  return (
    <div className="space-y-1.5 text-xs text-white/58">
      {room.game.winner ? (
        <span className="flex items-center gap-1.5 text-amber-100/85">
          <Trophy className="size-3.5" />
          {room.game.winner}
        </span>
      ) : room.game.currentTurnPlayer ? (
        <span className="flex items-center gap-1.5 text-emerald-200/85">
          <Activity className="size-3.5" />
          {room.game.currentTurnPlayer}'s turn
        </span>
      ) : null}
      <span className="block text-[11px] text-white/32">
        {room.game.eventCount} {room.game.eventCount === 1 ? "event" : "events"}
        {room.game.matchFinishedAt ? " - Complete" : " - In progress"}
      </span>
    </div>
  )
}

function MiniDetail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 border-r border-white/[0.08] px-2 first:pl-0 last:border-r-0 last:pr-0">
      <p className="text-[9px] font-medium tracking-[0.12em] text-white/30 uppercase">
        {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex items-center gap-3 text-sm text-white/55">
        <LoaderCircle className="size-4 animate-spin text-emerald-300" />
        Reading live room state...
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {["a", "b", "c"].map((key) => (
          <div
            key={key}
            className="h-28 animate-pulse rounded-lg bg-white/[0.04]"
          />
        ))}
      </div>
    </div>
  )
}

function EmptyState({ hasRooms }: { hasRooms: boolean }) {
  return (
    <div className="mt-5 flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-white/12 bg-white/[0.02] px-6 text-center">
      <div className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/40">
        {hasRooms ? (
          <Activity className="size-4" />
        ) : (
          <Users className="size-4" />
        )}
      </div>
      <h3 className="mt-4 text-sm font-medium text-white/80">
        {hasRooms ? "No rooms match this filter" : "No rooms in server memory"}
      </h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-white/38">
        {hasRooms
          ? "Try another status to see the rooms currently held by the server."
          : "Create or join a room and it will appear here while the server is running."}
      </p>
    </div>
  )
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return `${hours}h ${remainingMinutes}m`

  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function formatIdle(milliseconds: number): string {
  if (milliseconds < 15_000) return "Active now"
  return `${formatDuration(milliseconds)} idle`
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}
