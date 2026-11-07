import { useSyncExternalStore } from "react"

/**
 * Whether this tab is in the lounge, whether the player is sitting at the
 * table, and while seated, whether they play on the 3D table in first person
 * or with the classic view laid over the room.
 */
export type LoungeState = { open: boolean; seated: boolean; classic: boolean }

const STORAGE_KEY = "uno:lounge-open"
let state: LoungeState = { open: readOpen(), seated: false, classic: false }
const listeners = new Set<() => void>()

function readOpen() {
  try {
    return (
      typeof window !== "undefined" &&
      sessionStorage.getItem(STORAGE_KEY) === "1"
    )
  } catch {
    return false
  }
}

function set(next: Partial<LoungeState>) {
  const merged = { ...state, ...next }
  if (!merged.open) merged.seated = false
  if (!merged.seated) merged.classic = false
  if (
    merged.open === state.open &&
    merged.seated === state.seated &&
    merged.classic === state.classic
  )
    return
  state = merged
  try {
    sessionStorage.setItem(STORAGE_KEY, state.open ? "1" : "0")
  } catch {
    // Private mode: the lounge just won't survive a reload.
  }
  for (const listener of listeners) listener()
}

export const lounge = {
  get: () => state,
  open: () => set({ open: true, seated: false }),
  close: () => set({ open: false }),
  toggle: () => set({ open: !state.open, seated: false }),
  /** Sit down at the 3D table; the classic view is one tap away from there. */
  sit: () => set({ seated: true, classic: false }),
  stand: () => set({ seated: false }),
  showClassic: () => set({ classic: true }),
  showTable: () => set({ classic: false }),
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

const SERVER_STATE: LoungeState = { open: false, seated: false, classic: false }

export function useLounge(): LoungeState {
  return useSyncExternalStore(lounge.subscribe, lounge.get, () => SERVER_STATE)
}

/** Old devices and reduced-data setups get a lighter room. */
export function supportsWebGL(): boolean {
  if (typeof document === "undefined") return false
  try {
    const canvas = document.createElement("canvas")
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"))
  } catch {
    return false
  }
}
