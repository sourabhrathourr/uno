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
import { Button } from "@workspace/ui/components/button"
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
      <Button
        type="button"
        variant="ghost"
        aria-label={`Voice filters: ${active.name}`}
        aria-haspopup="dialog"
        title={`Voice filters: ${active.name}`}
        onClick={() => setOpen(true)}
        className={
          "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 " +
          (changed
            ? "border-white/25 bg-white/[0.12] text-white hover:bg-white/[0.18]"
            : "border-white/10 bg-white/[0.045] text-white/74 hover:border-white/18 hover:bg-white/[0.075] hover:text-white/88")
        }
      >
        <Icon className="size-[18px]" strokeWidth={2} />
        {changed && (
          <span className="absolute right-1.5 bottom-1.5 size-1.5 rounded-full bg-white/80" />
        )}
      </Button>
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
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl border border-white/10 bg-background p-0 text-white shadow-[0_-28px_80px_rgba(0,0,0,0.55)] backdrop:bg-black/55 backdrop:backdrop-blur-[2px] sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(560px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:shadow-[0_28px_80px_rgba(0,0,0,0.55)]"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div
          aria-hidden="true"
          className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-white/20 sm:hidden"
        />
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight sm:text-lg"
            >
              Voice filters
            </h2>
            <p id={helpId} className="mt-1 text-xs leading-5 text-white/55">
              Choose how you sound at the table.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-label="Close voice filters"
            onClick={onClose}
            className="size-11 shrink-0 rounded-lg text-white/60 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-white/70"
          >
            <X className="size-5" />
          </Button>
        </header>
        <div className="uno-scrollbar min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <div
            className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3 sm:grid-cols-5"
            role="group"
            aria-label="Choose a voice"
          >
            {VOICE_FILTERS.map((preset) => {
              const TileIcon = FILTER_ICONS[preset.id]
              const selected = filter === preset.id
              return (
                <Button
                  key={preset.id}
                  type="button"
                  variant="ghost"
                  aria-pressed={selected}
                  aria-label={`${preset.name}: ${preset.detail}`}
                  disabled={Boolean(filterError) && preset.id !== "normal"}
                  onClick={() => select(preset.id)}
                  className={
                    "relative flex h-auto min-h-[76px] min-w-0 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-40 " +
                    (selected
                      ? "border-white bg-white text-neutral-950 hover:bg-white/86 hover:text-neutral-950"
                      : "border-white/10 bg-white/[0.04] text-white/65 hover:border-white/20 hover:bg-white/[0.08] hover:text-white")
                  }
                >
                  {selected && (
                    <Check
                      className="absolute top-2 right-2 size-3 text-neutral-950"
                      strokeWidth={3}
                    />
                  )}
                  <TileIcon className="size-5" strokeWidth={1.9} />
                  <span className="text-xs font-semibold">{preset.name}</span>
                </Button>
              )
            })}
          </div>
          <div className="mt-4 flex items-center gap-3 px-1">
            <Icon className="size-5 shrink-0 text-white/65" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium">
                {active.name}
                <span className="text-xs font-normal text-white/50">
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
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
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
              <Button
                type="button"
                variant="ghost"
                disabled={micOn || connecting}
                onClick={() => {
                  if (busy || preview.status === "playing") preview.cancel()
                  else if (hasSample) void preview.play()
                  else void preview.record()
                }}
                className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm font-medium text-white/70 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-white/70 disabled:opacity-35"
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
              </Button>
              {hasSample && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={micOn || connecting}
                  onClick={() => void preview.record()}
                  className="min-h-11 rounded-lg px-3 text-xs text-white/65 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-white/70 disabled:opacity-35"
                >
                  Record again
                </Button>
              )}
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mt-2 text-xs text-white/65"
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
        <footer className="flex shrink-0 gap-2 border-t border-white/10 bg-background px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
          <Button
            type="button"
            variant="ghost"
            disabled={connecting || busy}
            onClick={() => {
              preview.cancel()
              onToggleMic()
              if (!micOn) onClose()
            }}
            className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold whitespace-normal text-neutral-950 hover:bg-white/86 hover:text-neutral-950 disabled:opacity-40"
          >
            <Mic className="size-4" />
            {connecting
              ? "Connecting…"
              : micOn
                ? "Mute mic"
                : active.id === "normal"
                  ? "Turn mic on"
                  : `Go live as ${active.name}`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-sm font-medium text-white/70 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-white/70"
          >
            Done
          </Button>
        </footer>
      </div>
    </dialog>
  )
}
