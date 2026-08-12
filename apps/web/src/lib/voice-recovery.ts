/**
 * Policy for repairing a broken leg of the voice mesh.
 *
 * The failure this exists for: on some Wi-Fi networks a direct peer-to-peer
 * path can be negotiated between *some* pairs of players and not others, so
 * one player ends up able to hear half the table. The old behaviour closed a
 * failed peer connection for good, which made that state permanent for the
 * rest of the match. These rules escalate instead — retry the same path a
 * couple of times, then rebuild the connection forced through a TURN relay,
 * which is the path that works when neither side can be reached directly.
 */

/** How often the mesh is checked for peers that quietly stopped working. */
export const PEER_RECONCILE_INTERVAL_MS = 5_000
/** A peer that never reaches `connected` in this long is rebuilt from scratch. */
export const PEER_CONNECT_TIMEOUT_MS = 12_000
/** `disconnected` is often a blip; only act if it sticks around. */
export const PEER_DISCONNECT_GRACE_MS = 4_000
/** ICE restarts tried before falling back to a TURN-relay-only connection. */
export const MAX_ICE_RESTARTS = 2

export type RecoveryAction =
  /** Re-offer with `iceRestart` on the existing connection. */
  | "ice-restart"
  /** Throw the connection away and rebuild it forced through TURN. */
  | "rebuild-relay"
  /** Throw the connection away and rebuild it the normal way. */
  | "rebuild"

export function nextRecoveryAction({
  restartAttempts,
  relayOnly,
  turnAvailable,
}: {
  restartAttempts: number
  relayOnly: boolean
  turnAvailable: boolean
}): RecoveryAction {
  if (restartAttempts < MAX_ICE_RESTARTS) return "ice-restart"
  if (turnAvailable && !relayOnly) return "rebuild-relay"
  return "rebuild"
}

export function hasTurnServers(iceServers: RTCIceServer[] | undefined) {
  return (iceServers ?? []).some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
    return urls.some(
      (url) => url.startsWith("turn:") || url.startsWith("turns:")
    )
  })
}

/**
 * True once a peer has spent long enough short of `connected` that waiting is
 * no longer the right move.
 */
export function isPeerStalled({
  connectionState,
  createdAt,
  now,
}: {
  connectionState: RTCPeerConnectionState
  createdAt: number
  now: number
}) {
  if (connectionState === "connected") return false
  return now - createdAt >= PEER_CONNECT_TIMEOUT_MS
}
