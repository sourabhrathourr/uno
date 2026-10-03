import workletUrl from "./voice-filter-worklet.ts?worker&url"
import type { VoiceFilterId } from "./voice-filter-presets"

export type VoiceFilterPipeline = {
  stream: MediaStream
  setFilter: (id: VoiceFilterId) => void
  setMuted: (muted: boolean) => void
  resume: () => Promise<void>
  close: () => void
}

export function createVoiceFilterContext() {
  const audioWindow = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const AudioContextClass =
    audioWindow.AudioContext ?? audioWindow.webkitAudioContext
  if (!AudioContextClass)
    throw new Error("Voice filters are not supported in this browser.")
  return new AudioContextClass({ latencyHint: "interactive" })
}

export async function createVoiceFilterNode(
  context: AudioContext,
  filter: VoiceFilterId
) {
  const worklet = (context as unknown as { audioWorklet?: AudioWorklet })
    .audioWorklet
  if (!worklet || typeof AudioWorkletNode === "undefined") {
    throw new Error("Voice filters are not supported in this browser.")
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      worklet.addModule(workletUrl),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Voice filters took too long to load.")),
          5000
        )
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
  const node = new AudioWorkletNode(context, "uno-voice-filter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
  })
  node.port.postMessage(filter)
  return node
}

/** Owns processing only. The room voice hook retains ownership of the raw mic. */
export async function createVoiceFilterPipeline(
  raw: MediaStream,
  filter: VoiceFilterId,
  onFailure: () => void,
  context = createVoiceFilterContext()
): Promise<VoiceFilterPipeline> {
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  let destination: MediaStreamAudioDestinationNode | undefined
  try {
    await context.resume()
    node = await createVoiceFilterNode(context, filter)
    source = context.createMediaStreamSource(raw)
    destination = context.createMediaStreamDestination()
    destination.channelCount = 1
    // Startup and teardown can race a mesh update. Open the gate only when
    // the room hook has checked that this mic still belongs to the session.
    destination.stream.getAudioTracks().forEach((track) => {
      track.enabled = false
    })
    source.connect(node).connect(destination)
    let closed = false
    // A crashed worklet must not silently kill voice. Keep the outbound track.
    const activeSource = source
    const activeDestination = destination
    node.onprocessorerror = () => {
      if (closed) return
      activeSource.disconnect()
      activeSource.connect(activeDestination)
      onFailure()
    }
    const activeNode = node
    return {
      stream: destination.stream,
      setFilter: (id) => {
        if (!closed) activeNode.port.postMessage(id)
      },
      setMuted: (muted) => {
        for (const track of activeDestination.stream.getAudioTracks())
          track.enabled = !muted
      },
      resume: () => (closed ? Promise.resolve() : context.resume()),
      close: () => {
        if (closed) return
        closed = true
        activeNode.onprocessorerror = null
        activeSource.disconnect()
        activeNode.disconnect()
        activeNode.port.close()
        activeDestination.stream.getTracks().forEach((track) => track.stop())
        void context.close().catch(() => {})
      },
    }
  } catch (cause) {
    source?.disconnect()
    node?.disconnect()
    node?.port.close()
    destination?.stream.getTracks().forEach((track) => track.stop())
    void context.close().catch(() => {})
    throw cause
  }
}
