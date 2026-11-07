import { createContext, useContext } from "react"

import { BeatState } from "../beat-engine"

const BeatContext = createContext<BeatState>(new BeatState())

export const BeatProvider = BeatContext.Provider

/** The room's live beat. Read it inside useFrame; it never re-renders. */
export function useBeat() {
  return useContext(BeatContext)
}
