import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { VoiceFilterPicker } from "./voice-filter-picker"

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
})

afterEach(() => {
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

async function mount(micOn = false) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const setFilter = vi.fn()
  const toggle = vi.fn()
  await act(() =>
    root.render(
      <VoiceFilterPicker
        filter="cat"
        filterError={null}
        setFilter={setFilter}
        micOn={micOn}
        connecting={false}
        onToggleMic={toggle}
      />
    )
  )
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label ||
        candidate.textContent === label
    )
    expect(button, label).toBeTruthy()
    await act(() => button!.click())
  }
  return { root, click, setFilter, toggle }
}

describe("voice filter picker", () => {
  it("chooses a filter without turning on the mic or asking for capture", async () => {
    const getUserMedia = vi.fn()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
    const { root, click, setFilter, toggle } = await mount()
    await click("Voice filters: Cat")
    expect(document.querySelector("dialog[open]")).toBeTruthy()
    await click("Robot: Metal mouth")
    expect(setFilter).toHaveBeenCalledWith("robot")
    expect(toggle).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    await click("Close voice filters")
    expect(document.querySelector("dialog")).toBeNull()
    await act(() => root.unmount())
  })

  it("blocks private recording while broadcasting", async () => {
    const { root, click } = await mount(true)
    await click("Voice filters: Cat")
    expect(document.body.textContent).toContain("Mute your mic to test")
    const record = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Record a test"
    )
    expect(record?.disabled).toBe(true)
    await act(() => root.unmount())
  })

  it("closes the sheet when starting voice and lets Escape dismiss it", async () => {
    const { root, click, toggle } = await mount()
    await click("Voice filters: Cat")
    await click("Go live as Cat")
    expect(toggle).toHaveBeenCalledOnce()
    expect(document.querySelector("dialog")).toBeNull()
    await click("Voice filters: Cat")
    await act(() => {
      document
        .querySelector("dialog")!
        .dispatchEvent(new Event("cancel", { cancelable: true }))
    })
    expect(document.querySelector("dialog")).toBeNull()
    await act(() => root.unmount())
  })
})
