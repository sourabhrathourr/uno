import { Check, Heart, Music2, Plus } from "lucide-react"
import { useState } from "react"

import { formatTrackDuration } from "@workspace/game"
import type { ChatMessage, MusicTrack } from "@workspace/game"
import type { ReactNode } from "react"

import { useLikedSongs, useMusicController } from "@/lib/room-music"

const DJ_PREFIX = /^@DJ(?=$|[\s,:])/i

/** Length of a leading `@DJ` command prefix, or 0 when there is none. */
export function djCommandPrefixLength(body: string): number {
  return DJ_PREFIX.exec(body)?.[0].length ?? 0
}

export function DjAvatar({ className = "size-7" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={
        "grid shrink-0 place-items-center rounded-full bg-violet-400/14 text-violet-200 shadow-[inset_0_0_0_1px_rgba(196,181,253,0.22)] " +
        className
      }
    >
      <Music2 className="size-[55%]" strokeWidth={2} />
    </span>
  )
}

export function DjMentionToken({ isSelf }: { isSelf: boolean }) {
  return (
    <span
      className={
        "font-semibold " + (isSelf ? "text-violet-600" : "text-violet-300")
      }
    >
      @DJ
    </span>
  )
}

export function DjMessageBubble({
  message,
  replyPreview,
  actions,
  time,
}: {
  message: ChatMessage
  replyPreview?: ReactNode
  actions?: ReactNode
  time: string
}) {
  return (
    <div className="flex items-start gap-1.5">
      <div className="max-w-[calc(100%-2.25rem)] min-w-0">
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-white/60">
          <DjAvatar className="size-4" />
          <span className="text-violet-200/90">DJ</span>
          <span className="tabular-nums">{time}</span>
        </div>
        <div className="overflow-hidden rounded-2xl rounded-bl-md bg-white/[0.06] px-3 py-2 text-white/82 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),0_10px_24px_rgba(0,0,0,0.22)]">
          {replyPreview}
          {message.body && (
            <p className="text-sm leading-relaxed text-pretty [overflow-wrap:anywhere] whitespace-pre-line">
              {message.body}
            </p>
          )}
          {message.track && <ChatTrackCard track={message.track} />}
        </div>
      </div>
      {actions}
    </div>
  )
}

function ChatTrackCard({ track }: { track: MusicTrack }) {
  const music = useMusicController()
  const { isLiked, toggle } = useLikedSongs()
  const [queued, setQueued] = useState(false)
  const liked = isLiked(track.id)

  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-black/24 p-1.5 pr-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
      <img
        src={track.thumbnailUrl}
        alt=""
        loading="lazy"
        draggable={false}
        className="size-10 shrink-0 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-white/10"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-5 font-medium text-white/90">
          {track.title}
        </p>
        <p className="truncate text-[11px] leading-4 text-white/48">
          {track.artist} · {formatTrackDuration(track.durationSec)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => toggle(track)}
        aria-pressed={liked}
        aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
        title={liked ? "Unlike" : "Like"}
        className={
          "grid size-7 shrink-0 place-items-center rounded-full transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.94] [@media(hover:hover)]:hover:bg-white/[0.08] " +
          (liked
            ? "text-rose-300"
            : "text-white/44 [@media(hover:hover)]:hover:text-white/80")
        }
      >
        <Heart
          className="size-3.5"
          strokeWidth={2}
          fill={liked ? "currentColor" : "none"}
        />
      </button>
      {music && (
        <button
          type="button"
          disabled={queued}
          onClick={async () => {
            if (await music.enqueue(track.id)) setQueued(true)
          }}
          aria-label={queued ? "Queued" : `Queue ${track.title} again`}
          title={queued ? "Queued" : "Queue again"}
          className="grid size-7 shrink-0 place-items-center rounded-full text-white/44 transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.94] disabled:text-violet-200/70 [@media(hover:hover)]:hover:bg-white/[0.08] [@media(hover:hover)]:hover:text-white/80"
        >
          {queued ? (
            <Check className="size-3.5" strokeWidth={2.2} />
          ) : (
            <Plus className="size-3.5" strokeWidth={2.2} />
          )}
        </button>
      )}
    </div>
  )
}
