import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AudioLines,
  Baby,
  Bot,
  Cat,
  Check,
  Feather,
  Ghost,
  Mic,
  Radio,
  Rat,
  Sparkles,
  Square,
  Squirrel,
  TestTube2,
  X,
} from "lucide-react"
import { VOICE_FILTERS, getVoiceFilter } from "../lib/voice-filter-presets"
import { useVoiceFilterPreview } from "../lib/use-voice-filter-preview"
import type { VoiceFilterId } from "../lib/voice-filter-presets"
import type { VoiceFilterControls } from "../lib/use-voice-filters"

const FILTER_ICONS = {
  normal: AudioLines,
  cat: Cat,
  robot: Bot,
  kid: Baby,
  fairy: Feather,
  giant: Ghost,
  monster: Rat,
  alien: Sparkles,
  chipmunk: Squirrel,
  radio: Radio,
}

type PickerProps = VoiceFilterControls & {
  micOn: boolean
  connecting: boolean
  voiceError?: string | null
  onToggleMic: () => void
}

export function VoiceFilterPicker(props: PickerProps) {
  const [open, setOpen] = useState(false)
  const active = getVoiceFilter(props.filter)
  const Icon = FILTER_ICONS[active.id]
  const changed = active.id !== "normal"
  return (
    <>
      <button
        type="button"
        aria-label={`Voice filters: ${active.name}`}
        aria-haspopup="dialog"
        title={`Voice filters: ${active.name}`}
        onClick={() => setOpen(true)}
        className={
          "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 " +
          (changed
            ? "border-violet-300/35 bg-violet-400/15 text-violet-200 hover:bg-violet-400/25"
            : "border-white/10 bg-white/[0.045] text-white/70 hover:bg-white/10")
        }
      >
        <Icon className="size-[18px]" strokeWidth={2} />
        {changed && (
          <span className="absolute right-1.5 bottom-1.5 size-1.5 rounded-full bg-violet-300" />
        )}
      </button>
      {open &&
        createPortal(
          <VoiceFilterSheet {...props} onClose={() => setOpen(false)} />,
          document.body
        )}
    </>
  )
}

function VoiceFilterSheet({
  filter,
  filterError,
  setFilter,
  micOn,
  connecting,
  voiceError,
  onToggleMic,
  onClose,
}: PickerProps & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const helpId = useId()
  const preview = useVoiceFilterPreview(filter, micOn)
  const active = getVoiceFilter(filter)
  const Icon = FILTER_ICONS[active.id]
  const busy = preview.status === "permission" || preview.status === "recording"
  const hasSample = preview.status === "ready" || preview.status === "playing"

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  function select(id: VoiceFilterId) {
    setFilter(id)
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose()
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[min(85dvh,720px)] w-full max-w-none overflow-hidden rounded-t-3xl border border-white/15 bg-[#15121e] p-0 text-white shadow-[0_24px_100px_#0009] backdrop:bg-black/65 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(680px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
    >
      <div className="flex max-h-[min(85dvh,720px)] flex-col">
        <div
          aria-hidden="true"
          className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-white/20 sm:hidden"
        />
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-4 sm:px-6 sm:pt-6">
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-violet-300 uppercase">
              Sound different. Play dirty.
            </p>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              Voice filters
            </h2>
            <p id={helpId} className="mt-1 text-xs leading-5 text-white/55">
              Pick a voice. Everyone hears it when your mic is on.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close voice filters"
            onClick={onClose}
            className="-mt-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-white/55 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-violet-300"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6">
          <div
            className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3 sm:grid-cols-5"
            role="group"
            aria-label="Choose a voice"
          >
            {VOICE_FILTERS.map((preset) => {
              const TileIcon = FILTER_ICONS[preset.id]
              const selected = filter === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${preset.name}: ${preset.detail}`}
                  disabled={Boolean(filterError) && preset.id !== "normal"}
                  onClick={() => select(preset.id)}
                  className={
                    "relative flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:opacity-40 " +
                    (selected
                      ? "border-violet-300/70 bg-violet-400/15 text-violet-100"
                      : "border-white/8 bg-white/[0.035] text-white/65 hover:border-white/20 hover:bg-white/[0.07]")
                  }
                >
                  {selected && (
                    <Check
                      className="absolute top-2 right-2 size-3 text-violet-300"
                      strokeWidth={3}
                    />
                  )}
                  <TileIcon className="size-6" strokeWidth={1.7} />
                  <span className="text-xs font-semibold">{preset.name}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-violet-300/15 bg-violet-400/[0.06] px-3.5 py-3">
            <Icon className="size-5 shrink-0 text-violet-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {active.name}
                <span className="ml-2 text-xs font-normal text-white/50">
                  {active.detail}
                </span>
              </p>
              <p className="mt-1 text-xs text-white/50">
                {micOn
                  ? "Live now. Your table hears this voice."
                  : "Ready for when you turn your mic on."}
              </p>
            </div>
            <span
              className={
                "size-2 shrink-0 rounded-full " +
                (micOn ? "bg-emerald-400" : "bg-white/20")
              }
            />
          </div>
          <div className="mt-4 rounded-2xl border border-white/8 bg-black/15 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <TestTube2 className="size-4 text-white/45" />
              Private voice test
            </div>
            <p className="mt-1.5 text-xs leading-5 text-white/50">
              {micOn
                ? "Mute your mic to test without the table hearing."
                : busy
                  ? preview.status === "permission"
                    ? "Allow your mic. Your test stays on this device."
                    : "Say something for 3 seconds. Then hear it back."
                  : hasSample
                    ? "Same clip, new voice. Pick any filter and press play."
                    : "Record 3 seconds. Only you hear the playback."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={micOn || connecting}
                onClick={() => {
                  if (busy || preview.status === "playing") preview.cancel()
                  else if (hasSample) void preview.play()
                  else void preview.record()
                }}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.055] px-3 text-xs font-semibold text-white/85 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:opacity-35"
              >
                {busy || preview.status === "playing" ? (
                  <Square className="size-3.5" />
                ) : (
                  <AudioLines className="size-4" />
                )}
                {busy
                  ? "Cancel test"
                  : preview.status === "playing"
                    ? "Stop test"
                    : hasSample
                      ? "Play test"
                      : "Record a test"}
              </button>
              {hasSample && (
                <button
                  type="button"
                  disabled={micOn || connecting}
                  onClick={() => void preview.record()}
                  className="min-h-11 rounded-xl px-3 text-xs text-white/55 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-violet-300 disabled:opacity-35"
                >
                  Record again
                </button>
              )}
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mt-2 text-xs text-violet-200"
            >
              {preview.status === "recording"
                ? "Recording…"
                : preview.status === "playing"
                  ? "Playing your test…"
                  : ""}
            </p>
            {preview.error && (
              <p role="alert" className="mt-2 text-xs leading-5 text-red-200">
                {preview.error}
              </p>
            )}
          </div>
          {filterError && (
            <p role="alert" className="mt-3 text-xs leading-5 text-amber-200">
              {filterError}
            </p>
          )}
          {voiceError && (
            <p role="alert" className="mt-3 text-xs leading-5 text-red-200">
              {voiceError}
            </p>
          )}
        </div>
        <footer className="flex shrink-0 gap-2 border-t border-white/8 bg-[#15121e] px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
          <button
            type="button"
            disabled={connecting || busy}
            onClick={() => {
              preview.cancel()
              onToggleMic()
              if (!micOn) onClose()
            }}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 text-sm font-semibold text-[#20132e] hover:bg-violet-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-200 disabled:opacity-40"
          >
            <Mic className="size-4" />
            {connecting
              ? "Connecting…"
              : micOn
                ? "Mute mic"
                : active.id === "normal"
                  ? "Turn mic on"
                  : `Go live as ${active.name}`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-medium text-white/70 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-violet-300"
          >
            Done
          </button>
        </footer>
      </div>
    </dialog>
  )
}
