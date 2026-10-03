import { afterEach, describe, expect, it, vi } from "vitest"
import { createVoiceFilterPipeline } from "./voice-filter-audio"

function audioMocks() {
  const track = { enabled: true, stop: vi.fn() }
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
  const destination = { stream }
  const node = {
    port: { postMessage: vi.fn(), close: vi.fn() },
    onprocessorerror: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const source = { connect: vi.fn(() => node), disconnect: vi.fn() }
  const context = {
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createMediaStreamDestination: vi.fn(() => destination),
  }
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return context
      }
    }
  )
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor() {
        return node
      }
    }
  )
  return { context, source, node, track, stream, destination }
}

afterEach(() => vi.unstubAllGlobals())

describe("outbound voice filters", () => {
  it("keeps the same output track when changing presets and gates mute immediately", async () => {
    const { stream, track, node } = audioMocks()
    const pipeline = await createVoiceFilterPipeline(
      {} as MediaStream,
      "cat",
      vi.fn()
    )
    expect(track.enabled).toBe(false)
    pipeline.setFilter("robot")
    expect(pipeline.stream).toBe(stream)
    expect(node.port.postMessage).toHaveBeenLastCalledWith("robot")
    pipeline.setMuted(true)
    expect(track.enabled).toBe(false)
    pipeline.setMuted(false)
    expect(track.enabled).toBe(true)
    pipeline.close()
  })

  it("falls back to raw sound on worklet failure without replacing the output", async () => {
    const { source, destination, stream, node } = audioMocks()
    const fail = vi.fn()
    const pipeline = await createVoiceFilterPipeline(
      {} as MediaStream,
      "robot",
      fail
    )
    node.onprocessorerror?.()
    expect(fail).toHaveBeenCalledOnce()
    expect(source.connect).toHaveBeenLastCalledWith(destination)
    expect(pipeline.stream).toBe(stream)
    pipeline.close()
  })

  it("closes output and context once without stopping caller-owned raw capture", async () => {
    const { context, track, node } = audioMocks()
    const rawTrack = { stop: vi.fn() }
    const raw = { getTracks: () => [rawTrack] } as unknown as MediaStream
    const pipeline = await createVoiceFilterPipeline(raw, "normal", vi.fn())
    pipeline.close()
    pipeline.close()
    expect(context.close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(node.port.close).toHaveBeenCalledOnce()
    expect(rawTrack.stop).not.toHaveBeenCalled()
  })

  it("releases resources if the module fails to load", async () => {
    const { context } = audioMocks()
    context.audioWorklet.addModule.mockRejectedValue(new Error("load failed"))
    await expect(
      createVoiceFilterPipeline({} as MediaStream, "cat", vi.fn())
    ).rejects.toThrow("load failed")
    expect(context.close).toHaveBeenCalledOnce()
  })
})
