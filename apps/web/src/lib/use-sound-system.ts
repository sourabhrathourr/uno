import { useEffect } from "react"
import { useSoundEnabled } from "react-sounds"

import { startSoundSystem } from "./sound"

export function useSoundSystem() {
  const [enabled, setEnabled] = useSoundEnabled()

  useEffect(() => {
    startSoundSystem()
  }, [])

  return { enabled, setEnabled }
}
