// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  SupportConfirmDialog,
  SupportRequestInbox,
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

    expect(container.textContent).toContain("Ride with Priya?")
    expect(container.textContent).toContain("No takebacks")
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Ride or die"
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

  it("asks for permission instead of locking in when the player was kicked before", async () => {
    const confirm = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(() => {
      root.render(
        <SupportConfirmDialog
          playerName="Priya"
          needsApproval
          onCancel={() => {}}
          onConfirm={confirm}
        />
      )
      return Promise.resolve()
    })

    expect(container.textContent).toContain("Ask Priya again?")
    expect(container.textContent).toContain("their call")
    // The unilateral wording must not survive into the request flow.
    expect(container.textContent).not.toContain("Ride or die")

    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Send request"
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

  it("lets the supported player approve or decline each waiting request", async () => {
    const respond = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(() => {
      root.render(
        <SupportRequestInbox
          requests={[
            { supporterPlayerId: "a", supporterName: "Rushil" },
            { supporterPlayerId: "b", supporterName: "Nishant" },
          ]}
          onRespond={respond}
        />
      )
      return Promise.resolve()
    })

    expect(container.textContent).toContain("Rushil")
    expect(container.textContent).toContain("Nishant")

    const buttons = [...container.querySelectorAll("button")]
    await act(() => {
      buttons.find((button) => button.textContent === "Let them in")?.click()
      return Promise.resolve()
    })
    expect(respond).toHaveBeenCalledWith("a", true)

    await act(() => {
      buttons.filter((button) => button.textContent === "Decline")[1]?.click()
      return Promise.resolve()
    })
    expect(respond).toHaveBeenCalledWith("b", false)

    await act(() => {
      root.unmount()
      return Promise.resolve()
    })
  })

  it("renders nothing when no requests are waiting", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(() => {
      root.render(<SupportRequestInbox requests={[]} onRespond={() => {}} />)
      return Promise.resolve()
    })

    expect(container.textContent).toBe("")
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
