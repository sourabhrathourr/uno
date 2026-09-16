import { describe, expect, it } from "vitest"

import { shouldPlayTurnAlert } from "./turn-notification"

describe("shouldPlayTurnAlert", () => {
  it("alerts only when a later turn change hands control to the local player", () => {
    expect(
      shouldPlayTurnAlert({
        previousTurnPlayerId: null,
        turnPlayerId: "player-1",
        localPlayerId: "player-1",
      })
    ).toBe(false)
    expect(
      shouldPlayTurnAlert({
        previousTurnPlayerId: "player-2",
        turnPlayerId: "player-2",
        localPlayerId: "player-1",
      })
    ).toBe(false)
    expect(
      shouldPlayTurnAlert({
        previousTurnPlayerId: "player-2",
        turnPlayerId: "player-3",
        localPlayerId: "player-1",
      })
    ).toBe(false)
    expect(
      shouldPlayTurnAlert({
        previousTurnPlayerId: "player-2",
        turnPlayerId: "player-1",
        localPlayerId: "player-1",
      })
    ).toBe(true)
  })
})
