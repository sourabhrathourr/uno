import { useEffect, useState } from "react"
import { Maximize2, Minimize2 } from "lucide-react"

import { isEditableTarget } from "./controls"
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ON } from "@/components/toolbar"

// Standard and webkit-prefixed fullscreen calls; any of them may be missing
// (older Safari has only the prefixed ones, iPhone Safari has none).
type FullscreenDocument = {
  fullscreenElement?: Element | null
  webkitFullscreenElement?: Element | null
  fullscreenEnabled?: boolean
  webkitFullscreenEnabled?: boolean
  exitFullscreen?: () => Promise<void>
  webkitExitFullscreen?: () => Promise<void> | void
}
type FullscreenElement = {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>
  webkitRequestFullscreen?: () => Promise<void> | void
}

const fullscreenDoc = () => document as unknown as FullscreenDocument

function fullscreenElement() {
  const doc = fullscreenDoc()
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

function canFullscreen() {
  const doc = fullscreenDoc()
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
}

export function toggleFullscreen() {
  const doc = fullscreenDoc()
  if (fullscreenElement()) {
    void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
    return
  }
  const root = document.documentElement as unknown as FullscreenElement
  const request =
    root.requestFullscreen?.({ navigationUI: "hide" }) ??
    root.webkitRequestFullscreen?.()
  void Promise.resolve(request).catch(() => {
    // Refused (no user gesture, or blocked): nothing to undo.
  })
}

/**
 * Fills the whole screen with the lounge (F). Hidden where the browser
 * can't do it, like Safari on iPhone.
 */
export function FullscreenButton() {
  const [supported, setSupported] = useState(false)
  const [active, setActive] = useState(false)

  useEffect(() => {
    setSupported(canFullscreen())
    const sync = () => setActive(Boolean(fullscreenElement()))
    sync()
    document.addEventListener("fullscreenchange", sync)
    document.addEventListener("webkitfullscreenchange", sync)
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey)
        return
      if (event.key.toLowerCase() === "f") toggleFullscreen()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener("webkitfullscreenchange", sync)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  if (!supported) return null
  const label = active ? "Exit full screen" : "Full screen"
  return (
    <button
      type="button"
      onClick={toggleFullscreen}
      aria-label={label}
      aria-pressed={active}
      title={`${label} (F)`}
      className={TOOLBAR_BUTTON + (active ? " " + TOOLBAR_BUTTON_ON : "")}
    >
      {active ? (
        <Minimize2 className="size-4" strokeWidth={2} />
      ) : (
        <Maximize2 className="size-4" strokeWidth={2} />
      )}
    </button>
  )
}
