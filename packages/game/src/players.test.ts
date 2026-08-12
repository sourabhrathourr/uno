import { describe, expect, it } from "vitest"

import { playerInitials } from "./players"

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
