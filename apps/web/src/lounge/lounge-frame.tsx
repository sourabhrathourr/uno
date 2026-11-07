import { Component, Suspense, lazy, useEffect, useState } from "react"
import { Box, Orbit } from "lucide-react"
import { lounge, supportsWebGL, useLounge } from "./lounge-store"
import type { ReactNode } from "react"

import type { LoungeWorldProps } from "./lounge-world"
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ON } from "@/components/toolbar"

// three.js is big; only people who open the lounge download it.
const LoungeWorld = lazy(() => import("./lounge-world"))

/**
 * Wraps the room's classic view. With the lounge closed it renders the
 * classic view untouched. With it open, the 3D room fills the screen and the
 * classic view stays mounted (so selections, chat drafts and timers survive)
 * but hidden, until the player sits at the table: then it shows over the
 * room on a see-through backdrop and plays exactly as before.
 */
export function LoungeFrame({
  children,
  world,
}: {
  children: ReactNode
  world: LoungeWorldProps
}) {
  const { open, seated, classic } = useLounge()
  const showClassic = seated && classic
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!open || !mounted) return <>{children}</>

  return (
    <>
      <WorldBoundary>
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[5] grid place-items-center bg-[#050407] text-sm text-white/60">
              <span className="motion-safe:animate-pulse">
                Opening the lounge…
              </span>
            </div>
          }
        >
          <LoungeWorld {...world} />
        </Suspense>
      </WorldBoundary>
      <div
        data-lounge-classic={showClassic ? "seated" : "hidden"}
        aria-hidden={!showClassic}
        inert={!showClassic}
        className={
          "fixed inset-0 z-[10] transition-opacity duration-300 ease-out " +
          (showClassic
            ? "opacity-100 [&_main]:bg-[#070604]/70! [&_main]:backdrop-blur-[2px]"
            : "pointer-events-none invisible opacity-0")
        }
      >
        {children}
      </div>
    </>
  )
}

/** If WebGL dies, drop back to the classic view instead of a blank page. */
class WorldBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error("Lounge failed to render", error)
    lounge.close()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Header button for the classic view. Opens the lounge; while seated in the
 * lounge it stands you back up into the room.
 */
export function LoungeButton() {
  const { open, seated, classic } = useLounge()
  const [available, setAvailable] = useState(false)
  useEffect(() => setAvailable(supportsWebGL()), [])
  if (!available) return null
  // Only visible over the 3D room while seated with the classic view up.
  const backToTable = open && seated && classic
  const label = backToTable ? "Back to the 3D table" : "Enter the 3D lounge"
  return (
    <button
      type="button"
      onClick={() => (backToTable ? lounge.showTable() : lounge.open())}
      title={backToTable ? "3D table" : "3D lounge"}
      aria-label={label}
      className={TOOLBAR_BUTTON + (backToTable ? " " + TOOLBAR_BUTTON_ON : "")}
    >
      {backToTable ? (
        <Box className="size-4" strokeWidth={2} />
      ) : (
        <Orbit className="size-4" strokeWidth={2} />
      )}
    </button>
  )
}
