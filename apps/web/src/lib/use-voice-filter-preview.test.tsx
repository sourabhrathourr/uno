import { act } from "react"
import { createRoot } from "react-dom/client"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { useVoiceFilterPreview } from "./use-voice-filter-preview"

const mocks = vi.hoisted(() => ({ context: vi.fn(), node: vi.fn() }))
vi.mock("./voice-filter-audio", () => ({
  createVoiceFilterContext: mocks.context,
  createVoiceFilterNode: mocks.node,
}))

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
beforeEach(() => {
  mocks.context.mockReturnValue({
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    destination: {},
  })
  mocks.node.mockResolvedValue({
    connect: vi.fn(() => ({ connect: vi.fn() })),
    disconnect: vi.fn(),
    port: { postMessage: vi.fn(), close: vi.fn() },
  })
  vi.stubGlobal("MediaRecorder", class {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.innerHTML = ""
})

async function mount() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let preview!: ReturnType<typeof useVoiceFilterPreview>
  function Harness({ micOn }: { micOn: boolean }) {
    preview = useVoiceFilterPreview("cat", micOn)
    return null
  }
  await act(() => root.render(<Harness micOn={false} />))
  return {
    root,
    get: () => preview,
    live: async () => {
      await act(() => root.render(<Harness micOn />))
    },
  }
}

describe("private voice preview lifecycle", () => {
  it("stops late capture after the sheet is closed", async () => {
    let resolve!: (stream: MediaStream) => void
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done
        })
    )
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
    const { root, get } = await mount()
    let recording!: Promise<void>
    await act(() => {
      recording = get().record()
    })
    expect(getUserMedia).toHaveBeenCalledOnce()
    await act(() => root.unmount())
    const stop = vi.fn()
    await act(async () => {
      resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
      await recording
    })
    expect(stop).toHaveBeenCalledOnce()
    expect(mocks.context.mock.results[0].value.close).toHaveBeenCalledOnce()
  })

  it("cancels pending capture when live mic turns on and blocks another test", async () => {
    let resolve!: (stream: MediaStream) => void
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done
        })
    )
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
    const { root, get, live } = await mount()
    let recording!: Promise<void>
    await act(() => {
      recording = get().record()
    })
    await live()
    const stop = vi.fn()
    await act(async () => {
      resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
      await recording
    })
    expect(stop).toHaveBeenCalledOnce()
    await act(async () => {
      await get().record()
    })
    expect(getUserMedia).toHaveBeenCalledOnce()
    await act(() => root.unmount())
  })
})
