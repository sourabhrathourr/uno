import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { useVoiceFilters } from "./use-voice-filters"
import type { VoiceFilterPipeline } from "./voice-filter-audio"

const mocks = vi.hoisted(() => ({ context: vi.fn(), pipeline: vi.fn() }))
vi.mock("./voice-filter-audio", () => ({
  createVoiceFilterContext: mocks.context,
  createVoiceFilterPipeline: mocks.pipeline,
}))

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ""
})

async function mount() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let filters!: ReturnType<typeof useVoiceFilters>
  function Harness() {
    filters = useVoiceFilters()
    return null
  }
  await act(() => root.render(<Harness />))
  return { root, get: () => filters }
}

function pipeline() {
  return {
    stream: {} as MediaStream,
    close: vi.fn(),
    setFilter: vi.fn(),
    setMuted: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
  }
}

describe("room voice filter lifecycle", () => {
  it("keeps the context resumed by the mic tap through startup capture cleanup", async () => {
    const context = {
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mocks.context.mockReturnValue(context)
    const output = pipeline()
    mocks.pipeline.mockResolvedValue(output)
    const { root, get } = await mount()
    get().prepareFilters()
    get().stopFilters(true)
    const raw = {} as MediaStream
    await act(async () => {
      await get().attachFilters(raw)
    })
    expect(mocks.context).toHaveBeenCalledOnce()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.close).not.toHaveBeenCalled()
    expect(mocks.pipeline).toHaveBeenCalledWith(
      raw,
      "normal",
      expect.any(Function),
      context
    )
    await act(() => root.unmount())
    expect(output.close).toHaveBeenCalledOnce()
  })

  it("disposes a processor that finishes loading after room teardown", async () => {
    const context = {
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mocks.context.mockReturnValue(context)
    let resolve!: (pipeline: VoiceFilterPipeline) => void
    mocks.pipeline.mockImplementation(
      () =>
        new Promise<VoiceFilterPipeline>((done) => {
          resolve = done
        })
    )
    const { root, get } = await mount()
    let attachment!: Promise<void>
    let error: unknown
    await act(() => {
      attachment = get()
        .attachFilters({} as MediaStream)
        .catch((cause) => {
          error = cause
        })
    })
    await act(() => get().stopFilters())
    expect(context.close).toHaveBeenCalledOnce()
    const late = pipeline()
    await act(async () => {
      resolve(late)
      await attachment
    })
    expect(late.close).toHaveBeenCalledOnce()
    expect(get().getFilteredStream()).toBeNull()
    expect((error as DOMException).name).toBe("AbortError")
    await act(() => root.unmount())
  })

  it("applies the latest selection during startup and gates the processed stream", async () => {
    mocks.context.mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    })
    const output = pipeline()
    let resolve!: (pipeline: VoiceFilterPipeline) => void
    mocks.pipeline.mockImplementation(
      () =>
        new Promise<VoiceFilterPipeline>((done) => {
          resolve = done
        })
    )
    const { root, get } = await mount()
    let attachment!: Promise<void>
    await act(() => {
      attachment = get().attachFilters({} as MediaStream)
    })
    await act(() => get().setFilter("robot"))
    await act(async () => {
      resolve(output)
      await attachment
    })
    expect(output.setFilter).toHaveBeenLastCalledWith("robot")
    expect(get().getFilteredStream()).toBe(output.stream)
    get().muteFilters(true)
    expect(output.setMuted).toHaveBeenCalledWith(true)
    await act(() => root.unmount())
    expect(output.close).toHaveBeenCalledOnce()
  })

  it("leaves normal mic available when worklet setup fails", async () => {
    mocks.context.mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    })
    mocks.pipeline.mockRejectedValue(new Error("unsupported"))
    const { root, get } = await mount()
    await act(async () => {
      get().setFilter("cat")
      await get().attachFilters({} as MediaStream)
    })
    expect(get().filter).toBe("normal")
    expect(get().filterError).toContain("normal voice still works")
    expect(get().getFilteredStream()).toBeNull()
    await act(() => root.unmount())
  })
})
