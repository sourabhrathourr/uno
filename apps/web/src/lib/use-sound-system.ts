import { useEffect, useState } from "react"

import { isSfxEnabled, setSfxEnabled, startSoundSystem } from "./sound"

export function useSoundSystem() {
  const [enabled, setEnabledState] = useState(() => isSfxEnabled())

  useEffect(() => {
    startSoundSystem()
    setEnabledState(isSfxEnabled())
  }, [])

  function setEnabled(nextEnabled: boolean) {
    setSfxEnabled(nextEnabled)
    setEnabledState(nextEnabled)
  }

  return { enabled, setEnabled }
}
