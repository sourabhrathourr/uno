import { useCallback, useEffect, useRef, useState } from "react"
import {
  createVoiceFilterContext,
  createVoiceFilterNode,
} from "./voice-filter-audio"
import type { VoiceFilterId } from "./voice-filter-presets"

type PreviewStatus = "idle" | "permission" | "recording" | "ready" | "playing"

/** A short local sample. Never attached to a peer or uploaded anywhere. */
export function useVoiceFilterPreview(filter: VoiceFilterId, micOn: boolean) {
  const [status, setStatus] = useState<PreviewStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sampleRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const generationRef = useRef(0)
  const filterRef = useRef(filter)
  filterRef.current = filter
  const micOnRef = useRef(micOn)
  micOnRef.current = micOn
  const isMicOn = useCallback(() => micOnRef.current, [])

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null
      sourceRef.current.stop()
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    generationRef.current++
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    stopPlayback()
    nodeRef.current?.disconnect()
    nodeRef.current?.port.close()
    nodeRef.current = null
    if (contextRef.current) void contextRef.current.close().catch(() => {})
    contextRef.current = null
    sampleRef.current = null
    setStatus("idle")
  }, [stopPlayback])

  const play = useCallback(async () => {
    const context = contextRef.current
    const sample = sampleRef.current
    const node = nodeRef.current
    if (!context || !sample || !node || isMicOn()) return
    stopPlayback()
    try {
      await context.resume()
      if (context !== contextRef.current || isMicOn()) return
      const source = context.createBufferSource()
      source.buffer = sample
      source.connect(node)
      sourceRef.current = source
      source.onended = () => {
        source.disconnect()
        if (sourceRef.current === source) {
          sourceRef.current = null
          setStatus("ready")
        }
      }
      setStatus("playing")
      source.start()
    } catch {
      setError("Could not play the test. Record it again.")
    }
  }, [isMicOn, stopPlayback])

  const record = useCallback(async () => {
    if (isMicOn()) return
    cancel()
    const generation = generationRef.current
    setError(null)
    setStatus("permission")
    try {
      const mediaDevices = (
        navigator as unknown as {
          mediaDevices?: { getUserMedia?: MediaDevices["getUserMedia"] }
        }
      ).mediaDevices
      if (
        typeof mediaDevices?.getUserMedia !== "function" ||
        typeof MediaRecorder === "undefined"
      ) {
        throw new Error("Voice tests are not supported in this browser.")
      }
      const context = createVoiceFilterContext()
      contextRef.current = context
      await context.resume()
      const node = await createVoiceFilterNode(context, filter)
      if (generation !== generationRef.current) {
        node.disconnect()
        node.port.close()
        return
      }
      nodeRef.current = node
      node.port.postMessage(filterRef.current)
      const volume = context.createGain()
      volume.gain.value = 0.75
      node.connect(volume).connect(context.destination)
      const stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      if (generation !== generationRef.current || isMicOn()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      const chunks: Array<Blob> = []
      const clip = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data)
        }
        recorder.onerror = () => reject(new Error("Could not record the test."))
        recorder.onstop = () =>
          resolve(new Blob(chunks, { type: recorder.mimeType }))
      })
      recorder.start()
      setStatus("recording")
      timerRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop()
      }, 3000)
      const blob = await clip
      stream.getTracks().forEach((track) => track.stop())
      if (generation !== generationRef.current) return
      streamRef.current = null
      recorderRef.current = null
      sampleRef.current = await context.decodeAudioData(
        await blob.arrayBuffer()
      )
      if (generation !== generationRef.current || isMicOn()) return
      setStatus("ready")
      await play()
    } catch (cause) {
      if (generation !== generationRef.current) return
      cancel()
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Allow your mic to record a private test."
          : cause instanceof Error
            ? cause.message
            : "Could not record the test."
      )
    }
  }, [cancel, filter, isMicOn, play])

  useEffect(() => {
    nodeRef.current?.port.postMessage(filter)
  }, [filter])
  useEffect(() => {
    if (micOn) cancel()
  }, [micOn, cancel])
  useEffect(() => cancel, [cancel])

  return { status, error, record, play, cancel }
}
