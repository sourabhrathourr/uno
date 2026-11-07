import { describe, expect, it } from "vitest"

import { guessGrid, moodForTempo, sampleBeat, tempoFromTaps } from "./beat"
import { STAGE, TABLE, seatPosition } from "./layout"
import { JUMP_SPEED, stepBody } from "./physics"
import type { Body } from "./physics"

describe("beat grid", () => {
  it("guesses a mood from the title", () => {
    expect(guessGrid("lofi hip hop radio - beats to relax/study to").mood).toBe(
      "chill"
    )
    expect(guessGrid("Levels (Avicii Remix) - Festival Mix").mood).toBe("hype")
    expect(guessGrid("Some Song").mood).toBe("groove")
  })

  it("feels very fast songs in half time", () => {
    expect(moodForTempo(171, "Blinding Lights")).toBe("groove")
    expect(moodForTempo(128, "Titanium")).toBe("hype")
    expect(moodForTempo(75, "Someone Like You")).toBe("chill")
    expect(moodForTempo(140, "Tum Hi Ho (Slowed + Reverb)")).toBe("chill")
  })

  it("lands kicks on the grid", () => {
    const grid = {
      bpm: 120,
      offsetSec: 0.25,
      mood: "groove",
      source: "tap",
    } as const
    const onBeat = sampleBeat(0.25 + 2, grid)
    expect(onBeat.beat).toBeCloseTo(4)
    expect(onBeat.kick).toBeCloseTo(1)
    expect(onBeat.bar).toBe(1)
    const offBeat = sampleBeat(0.25 + 2.25, grid)
    expect(offBeat.phase).toBeCloseTo(0.5)
    expect(offBeat.kick).toBeLessThan(0.2)
  })

  it("derives tempo and downbeat from taps", () => {
    const taps = [10.1, 10.6, 11.1, 11.6, 12.1, 12.6]
    const tempo = tempoFromTaps(taps)
    expect(tempo?.bpm).toBeCloseTo(120, 0)
    // Every tap should land on a beat of the derived grid.
    for (const tap of taps) {
      const beats = ((tap - tempo!.offsetSec) * tempo!.bpm) / 60
      expect(Math.abs(beats - Math.round(beats))).toBeLessThan(0.05)
    }
  })

  it("ignores too few or erratic taps", () => {
    expect(tempoFromTaps([1, 1.5, 2])).toBeNull()
    expect(tempoFromTaps([1, 1.3, 2.4, 2.6, 3.9])).toBeNull()
  })
})

describe("lounge physics", () => {
  const standing: Body = { x: 0, y: 0, z: -7, vy: 0, grounded: true }

  it("can't walk through the stage edge", () => {
    let body = { ...standing, x: 4 }
    for (let frame = 0; frame < 60; frame++)
      body = stepBody(body, 0, -0.1, 1 / 60)
    expect(body.z).toBeGreaterThan(STAGE.maxZ)
    expect(body.y).toBe(0)
  })

  it("climbs the stage steps", () => {
    let body = { ...standing }
    for (let frame = 0; frame < 60; frame++)
      body = stepBody(body, 0, -0.06, 1 / 60)
    expect(body.z).toBeLessThan(STAGE.maxZ)
    expect(body.y).toBeCloseTo(STAGE.top)
  })

  it("jumps and lands", () => {
    let body = { ...standing, z: 8, vy: JUMP_SPEED, grounded: false }
    let peak = 0
    for (let frame = 0; frame < 120; frame++) {
      body = stepBody(body, 0, 0, 1 / 60)
      peak = Math.max(peak, body.y)
    }
    expect(peak).toBeGreaterThan(0.8)
    expect(body.y).toBe(0)
    expect(body.grounded).toBe(true)
  })

  it("keeps players out of the game table", () => {
    let body = { ...standing, x: 0, z: TABLE.z + 3 }
    for (let frame = 0; frame < 90; frame++)
      body = stepBody(body, 0, -0.05, 1 / 60)
    expect(Math.hypot(body.x - TABLE.x, body.z - TABLE.z)).toBeGreaterThan(
      TABLE.radius
    )
  })

  it("puts seats around the table facing it", () => {
    const seat = seatPosition(0, 4)
    expect(seat.z).toBeGreaterThan(TABLE.z)
    expect(Math.cos(seat.heading)).toBeLessThan(-0.99)
  })
})
