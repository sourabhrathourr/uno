import { describe, expect, it } from "vitest"

import {
  MAX_ICE_RESTARTS,
  PEER_CONNECT_TIMEOUT_MS,
  hasTurnServers,
  isPeerStalled,
  nextRecoveryAction,
} from "./voice-recovery"

describe("voice peer recovery", () => {
  it("retries the existing path before giving up on it", () => {
    for (let attempt = 0; attempt < MAX_ICE_RESTARTS; attempt += 1) {
      expect(
        nextRecoveryAction({
          restartAttempts: attempt,
          relayOnly: false,
          turnAvailable: true,
        })
      ).toBe("ice-restart")
    }
  })

  it("falls back to a TURN relay once restarts stop helping", () => {
    expect(
      nextRecoveryAction({
        restartAttempts: MAX_ICE_RESTARTS,
        relayOnly: false,
        turnAvailable: true,
      })
    ).toBe("rebuild-relay")
  })

  it("does not promise a relay that is not configured", () => {
    expect(
      nextRecoveryAction({
        restartAttempts: MAX_ICE_RESTARTS,
        relayOnly: false,
        turnAvailable: false,
      })
    ).toBe("rebuild")
  })

  it("keeps rebuilding rather than looping the relay switch forever", () => {
    expect(
      nextRecoveryAction({
        restartAttempts: MAX_ICE_RESTARTS + 5,
        relayOnly: true,
        turnAvailable: true,
      })
    ).toBe("rebuild")
  })

  it("recognises TURN servers in either string or array form", () => {
    expect(hasTurnServers(undefined)).toBe(false)
    expect(hasTurnServers([{ urls: "stun:stun.l.google.com:19302" }])).toBe(
      false
    )
    expect(hasTurnServers([{ urls: "turn:relay.example.com:80" }])).toBe(true)
    expect(
      hasTurnServers([
        { urls: ["stun:stun.example.com", "turns:relay.example.com:443"] },
      ])
    ).toBe(true)
  })

  it("only calls a peer stalled once it has had long enough to connect", () => {
    const createdAt = 1_000

    expect(
      isPeerStalled({
        connectionState: "connecting",
        createdAt,
        now: createdAt + PEER_CONNECT_TIMEOUT_MS - 1,
      })
    ).toBe(false)
    expect(
      isPeerStalled({
        connectionState: "connecting",
        createdAt,
        now: createdAt + PEER_CONNECT_TIMEOUT_MS,
      })
    ).toBe(true)
    // A working leg is never disturbed, however old it is.
    expect(
      isPeerStalled({
        connectionState: "connected",
        createdAt,
        now: createdAt + PEER_CONNECT_TIMEOUT_MS * 100,
      })
    ).toBe(false)
  })
})
