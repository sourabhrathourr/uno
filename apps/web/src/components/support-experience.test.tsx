import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  SupportConfirmDialog,
  availableSupportCandidates,
  mentionablePlayersForChannel,
} from "./support-experience"

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ""
})

describe("support experience", () => {
  it("requires an explicit confirmation before creating a support link", async () => {
    const confirm = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(() => {
      root.render(
        <SupportConfirmDialog
          playerName="Priya"
          onCancel={() => {}}
          onConfirm={confirm}
        />
      )
      return Promise.resolve()
    })

    expect(container.textContent).toContain("Support Priya?")
    expect(container.textContent).toContain("cannot switch")
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Lock in support"
    )
    await act(() => {
      button?.click()
      return Promise.resolve()
    })
    expect(confirm).toHaveBeenCalledOnce()
    await act(() => {
      root.unmount()
      return Promise.resolve()
    })
  })

  it("offers only active players who have not blocked this supporter", () => {
    const candidates = availableSupportCandidates(
      [
        { playerId: "a", eliminated: true, winnerPlacement: null },
        { playerId: "b", eliminated: false, winnerPlacement: null },
        {
          playerId: "c",
          eliminated: false,
          winnerPlacement: {
            playerId: "c",
            position: 1,
            createdAt: "2026-07-10T00:00:00.000Z",
          },
        },
      ],
      ["b"],
      "a"
    )

    expect(candidates).toEqual([])
  })

  it("uses player identities to limit squad mentions even when names collide", () => {
    const players = [
      { id: "a", name: "Sam" },
      { id: "b", name: "Sam" },
      { id: "c", name: "Priya" },
    ]

    expect(
      mentionablePlayersForChannel(players, "squad", ["b", "c"]).map(
        (player) => player.id
      )
    ).toEqual(["b", "c"])
    expect(mentionablePlayersForChannel(players, "public", ["b", "c"])).toEqual(
      players
    )
  })
})
