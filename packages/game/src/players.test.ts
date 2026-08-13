import { describe, expect, it } from "vitest"

import { playerInitials, turnOrderFromSeating } from "./players"

describe("turnOrderFromSeating", () => {
  const seating = ["Rushil", "Nishant", "Palak", "Sourabh"]

  it("follows the seating list as written when play runs clockwise", () => {
    expect(turnOrderFromSeating(seating, 1)).toEqual(seating)
  })

  it("opens with the same seat but walks backwards counter-clockwise", () => {
    expect(turnOrderFromSeating(seating, -1)).toEqual([
      "Rushil",
      "Sourabh",
      "Palak",
      "Nishant",
    ])
  })

  it("is unchanged for tables too small for direction to matter", () => {
    expect(turnOrderFromSeating(["A", "B"], -1)).toEqual(["A", "B"])
    expect(turnOrderFromSeating(["A"], -1)).toEqual(["A"])
    expect(turnOrderFromSeating([], -1)).toEqual([])
  })

  it("does not mutate the seating it was given", () => {
    const original = [...seating]
    turnOrderFromSeating(seating, -1)
    expect(seating).toEqual(original)
  })
})

describe("playerInitials", () => {
  it("uses the first two letters of a single-word name", () => {
    expect(playerInitials("Rushil")).toBe("RU")
    expect(playerInitials("bea")).toBe("BE")
  })

  it("uses one letter per word when a name has several", () => {
    expect(playerInitials("Rushil Mehta")).toBe("RM")
    expect(playerInitials("ada  b  c")).toBe("AB")
  })

  it("ignores surrounding and repeated whitespace", () => {
    expect(playerInitials("   Nishant   ")).toBe("NI")
    expect(playerInitials("  Sam   Doe ")).toBe("SD")
  })

  it("copes with names too short or empty to abbreviate", () => {
    expect(playerInitials("R")).toBe("R")
    expect(playerInitials("")).toBe("??")
    expect(playerInitials("   ")).toBe("??")
  })

  it("passes non-latin names through rather than mangling them", () => {
    expect(playerInitials("नमस्ते")).toBe("नम")
    expect(playerInitials("نيخيل")).toBe("ني")
  })
})
