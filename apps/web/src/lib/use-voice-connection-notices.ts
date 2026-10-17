import { useEffect, useRef, useState } from "react"

const NOTICE_DURATION_MS = 6_000

/** One brief notice per player's reconnect episode; recovery state stays intact. */
export function useVoiceConnectionNotices(issues: Record<string, string>) {
  const deadlines = useRef(new Map<string, number>())
  const [visiblePlayerIds, setVisiblePlayerIds] = useState<Array<string>>([])
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const playerIds = Object.keys(issues)
    const activeIds = new Set(playerIds)
    for (const playerId of deadlines.current.keys()) {
      if (!activeIds.has(playerId)) deadlines.current.delete(playerId)
    }
    const now = Date.now()
    for (const playerId of playerIds) {
      if (!deadlines.current.has(playerId))
        deadlines.current.set(playerId, now + NOTICE_DURATION_MS)
    }
    const visibleIds = playerIds.filter(
      (playerId) => deadlines.current.get(playerId)! > now
    )
    setVisiblePlayerIds(visibleIds)
    // Preserve the original deadline across watchdog updates and rerenders.
    const timers = visibleIds.map((playerId) =>
      window.setTimeout(() => {
        setVisiblePlayerIds((current) => current.filter((id) => id !== playerId))
      }, deadlines.current.get(playerId)! - now)
    )
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [issues, revision])

  function showNotices() {
    const until = Date.now() + NOTICE_DURATION_MS
    for (const playerId of Object.keys(issues))
      deadlines.current.set(playerId, until)
    setRevision((current) => current + 1)
  }

  return {
    visibleIssues: Object.fromEntries(
      visiblePlayerIds
        .filter((playerId) => issues[playerId])
        .map((playerId) => [playerId, issues[playerId]!])
    ),
    showNotices,
  }
}
