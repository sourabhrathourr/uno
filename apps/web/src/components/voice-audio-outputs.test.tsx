import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { VoiceAudioOutputs } from "./voice-audio-outputs"
import type { Root } from "react-dom/client"

let root: Root
let container: HTMLDivElement
let track: EventTarget
let stream: MediaStream
let play: ReturnType<typeof vi.spyOn>
const drain = async () => {
  for (let n = 0; n < 10; n++) await Promise.resolve()
}
async function render(issues: Record<string, string> = {}) {
  await act(async () => {
    root.render(
      createElement(VoiceAudioOutputs, {
        streamsByPlayerId: { b: stream },
        connectionIssues: issues,
        playerNames: { b: "Priya" },
      })
    )
    await drain()
  })
}
beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  track = new EventTarget()
  stream = { getAudioTracks: () => [track] } as unknown as MediaStream
  play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined)
  vi.spyOn(console, "debug").mockImplementation(() => {})
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
    await drain()
  })
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

it("shows a named retry control when autoplay is blocked, and clears it after a tap", async () => {
  play.mockRejectedValue(new DOMException("blocked", "NotAllowedError"))
  await render()
  const button = container.querySelector("button")!
  expect(button.textContent).toContain("Tap to hear Priya")
  play.mockResolvedValue(undefined)
  await act(async () => {
    button.click()
    await drain()
  })
  expect(container.querySelector("button")).toBeNull()
})

it("reports a stalled output even if the transport has not failed", async () => {
  await render()
  await act(async () => {
    container.querySelector("audio")!.dispatchEvent(new Event("stalled"))
    await drain()
  })
  expect(container.textContent).toContain("Tap to hear Priya")
})

it("keeps the same audio element across status updates", async () => {
  await render()
  const original = container.querySelector("audio")
  await render({ b: "Reconnecting voice with Priya…" })
  expect(container.querySelector("audio")).toBe(original)
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Priya"
  )
})

it("retries playback when the received track resumes", async () => {
  await render()
  const calls = play.mock.calls.length
  await act(async () => {
    track.dispatchEvent(new Event("unmute"))
    await drain()
  })
  expect(play.mock.calls.length).toBe(calls + 1)
})

it("cleans up gesture listeners and late play failures on unmount", async () => {
  let reject!: (cause: Error) => void
  play.mockImplementation(
    () =>
      new Promise<void>((_, failure) => {
        reject = failure
      })
  )
  await render()
  await act(async () => {
    root.unmount()
    await drain()
  })
  root = createRoot(container)
  const calls = play.mock.calls.length
  await act(async () => {
    reject(new Error("late playback failure"))
    window.dispatchEvent(new Event("pointerdown"))
    track.dispatchEvent(new Event("unmute"))
    await drain()
  })
  expect(play.mock.calls.length).toBe(calls)
  expect(container.textContent).toBe("")
})

it("ignores an old play rejection after a later gesture has started playback", async () => {
  let reject!: (cause: Error) => void
  play.mockImplementationOnce(
    () =>
      new Promise<void>((_, failure) => {
        reject = failure
      })
  )
  await render()
  await act(async () => {
    window.dispatchEvent(new Event("keydown"))
    await drain()
  })
  await act(async () => {
    reject(new Error("old attempt"))
    await drain()
  })
  expect(container.querySelector("button")).toBeNull()
})
