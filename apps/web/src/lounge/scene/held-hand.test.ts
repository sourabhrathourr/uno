import { describe, expect, it } from "vitest"

import { layoutHand } from "./held-hand"

// View sizes at the hand's depth for a 16:10 laptop and a tall phone.
const screens = {
  desktop: { halfWidth: 0.573, halfHeight: 0.358, portrait: false },
  phone: { halfWidth: 0.232, halfHeight: 0.502, portrait: true },
}

describe("layoutHand", () => {
  for (const [name, screen] of Object.entries(screens)) {
    const cardW = screen.portrait
      ? Math.min(screen.halfWidth * 0.4, screen.halfHeight * 0.2)
      : Math.min(screen.halfHeight * 0.25, screen.halfWidth * 0.2)
    const cardH = cardW * 1.414
    const options = {
      halfWidth: screen.halfWidth,
      halfHeight: screen.halfHeight,
      cardW,
      cardH,
      maxRows: screen.portrait ? 3 : 2,
      idealStep: cardW * (screen.portrait ? 0.62 : 0.78),
    }

    it(`keeps every card fully on a ${name} screen, 1 to 30 cards`, () => {
      for (let count = 1; count <= 30; count++) {
        const slots = layoutHand(count, options)
        expect(slots).toHaveLength(count)
        for (const slot of slots) {
          // Allow for the tilt widening the card's footprint slightly.
          const reachX = cardW * 0.62
          const reachY = cardH * 0.52
          expect(Math.abs(slot.x) + reachX).toBeLessThanOrEqual(
            screen.halfWidth
          )
          expect(slot.y - reachY).toBeGreaterThanOrEqual(-screen.halfHeight)
          expect(slot.y + reachY).toBeLessThan(0)
        }
      }
    })

    it(`shows each card's corner index on a ${name} screen up to 25 cards`, () => {
      for (let count = 2; count <= 25; count++) {
        const slots = layoutHand(count, options)
        const rows = new Map<number, Array<number>>()
        for (const slot of slots) {
          const key = Math.round(slot.y * 1000)
          rows.set(key, [...(rows.get(key) ?? []), slot.x])
        }
        for (const xs of rows.values()) {
          const sorted = [...xs].sort((a, b) => a - b)
          for (let i = 1; i < sorted.length; i++)
            expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(
              cardW * 0.3
            )
        }
      }
    })
  }

  it("puts later rows in front, so they win the pointer", () => {
    const slots = layoutHand(20, {
      halfWidth: 0.232,
      halfHeight: 0.502,
      cardW: 0.093,
      cardH: 0.131,
      maxRows: 3,
      idealStep: 0.058,
    })
    const back = slots[0]
    const front = slots[slots.length - 1]
    expect(front.z).toBeGreaterThan(back.z)
    expect(front.order).toBeGreaterThan(back.order)
    expect(front.y).toBeLessThan(back.y)
  })
})
