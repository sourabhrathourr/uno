/* eslint @typescript-eslint/require-await: "off" -- Async WebRTC doubles preserve promise rejection semantics. */
// Regression tests run the real hook with controlled device and WebRTC behavior.
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Root } from "react-dom/client"
import type {
  RoomVoiceController,
  useRoomVoice as VoiceHook,
} from "./use-room-voice"

vi.mock("@/lib/realtime", () => ({ getRealtimeUrl: () => "http://voice.test" }))

class Track extends EventTarget {
  id = Math.random().toString(36)
  kind = "audio"
  enabled = true
  muted = false
  readyState = "live"
  stop() {
    this.readyState = "ended"
  }
}
class Stream {
  id = Math.random().toString(36)
  constructor(public tracks: Array<Track>) {}
  getTracks() {
    return this.tracks
  }
  getAudioTracks() {
    return this.tracks
  }
}
class Peer {
  static all: Array<Peer> = []
  connectionState = "new"
  iceConnectionState = "new"
  iceGatheringState = "new"
  signalingState = "stable"
  localDescription: { type: string; sdp?: string } | null = null
  remoteDescription: { type: string; sdp?: string } | null = null
  transceivers: Array<any> = []
  onicecandidate: any = null
  ontrack: any = null
  onconnectionstatechange: any = null
  oniceconnectionstatechange: any = null
  onsignalingstatechange: any = null
  rejectReplace = false
  addedCandidates: Array<any> = []
  candidateErrors: Array<string> = []
  setConfiguration(config: any) {
    this.config = config
  }
  packets = 1
  async getStats() {
    return new Map([
      [
        "audio",
        { type: "inbound-rtp", kind: "audio", packetsReceived: this.packets },
      ],
    ])
  }
  offers = 0
  answers = 0
  constructor(public config: any) {
    Peer.all.push(this)
  }
  getTransceivers() {
    return this.transceivers
  }
  getReceivers() {
    return this.transceivers.map((t) => t.receiver)
  }
  addTransceiver() {
    const sender = {
      track: null as Track | null,
      replaceTrack: async (track: Track) => {
        if (this.rejectReplace)
          throw new DOMException("sender failed", "InvalidStateError")
        sender.track = track
      },
    }
    const transceiver = {
      sender,
      receiver: { track: new Track() },
      direction: "sendrecv",
    }
    this.transceivers.push(transceiver)
    return transceiver
  }
  addTrack(track: Track) {
    this.addTransceiver().sender.track = track
  }
  async createOffer() {
    this.offers++
    return { type: "offer", sdp: "a=ice-ufrag:local" }
  }
  async createAnswer() {
    if (this.signalingState !== "have-remote-offer")
      throw new DOMException("no offer", "InvalidStateError")
    this.answers++
    return { type: "answer", sdp: "a=ice-ufrag:local" }
  }
  async setLocalDescription(description: any) {
    if (description.type === "rollback") {
      this.signalingState = "stable"
      this.localDescription = null
      return
    }
    this.localDescription = description
    this.signalingState =
      description.type === "offer" ? "have-local-offer" : "stable"
  }
  async setRemoteDescription(description: any) {
    this.remoteDescription = description
    this.signalingState =
      description.type === "offer" ? "have-remote-offer" : "stable"
  }
  async addIceCandidate(candidate: any) {
    if (candidate.invalid)
      throw new DOMException("invalid candidate", "OperationError")
    const ufrag = this.remoteDescription?.sdp?.split("a=ice-ufrag:")[1]
    if (candidate.usernameFragment !== ufrag) {
      this.candidateErrors.push(candidate.usernameFragment)
      throw new DOMException("wrong ICE generation", "OperationError")
    }
    this.addedCandidates.push(candidate)
  }
  close() {
    this.connectionState = "closed"
    this.signalingState = "closed"
  }
  state(value: string) {
    this.connectionState = value
    this.onconnectionstatechange?.()
  }
}
class Socket {
  id = "socket-a"
  connected = true
  joinAccepted = true
  timeout() {
    return this
  }
  sent: Array<{ event: string; payload: any }> = []
  listeners = new Map<string, Set<(...args: Array<any>) => void>>()
  on(event: string, callback: (...args: Array<any>) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(callback)
  }
  off(event: string, callback: (...args: Array<any>) => void) {
    this.listeners.get(event)?.delete(callback)
  }
  emit(event: string, payload?: any) {
    this.sent.push({ event, payload })
    if (event === "voice:join")
      payload(
        null,
        this.joinAccepted
          ? { ok: true, data: { sessionId: "voice-a", states: [] } }
          : {
              ok: false,
              error: {
                code: "voice-in-another-tab",
                message: "Voice is active in another tab.",
              },
            }
      )
  }
  receive(event: string, payload?: any) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }
}

let roots: Array<Root> = []
let getUserMedia: ReturnType<typeof vi.fn>
let mic: Track
let fetchConfig: ReturnType<typeof vi.fn>
let useRoomVoice: typeof VoiceHook

async function drain() {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}
async function mount(
  self = "a",
  socket = new Socket(),
  joinedSocketId: string | null = socket.id
) {
  let value!: RoomVoiceController
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  function Probe() {
    value = useRoomVoice({
      socket: socket as any,
      joinedSocketId,
      roomCode: "AUDIT",
      selfPlayerId: self,
      players: ["a", "b", "c", "z"].map((id) => ({ id })) as any,
    })
    return null
  }
  await act(async () => {
    root.render(createElement(Probe))
    await drain()
  })
  return {
    socket,
    root,
    voice: () => value,
    async rejoin(id: string | null) {
      joinedSocketId = id
      await act(async () => {
        root.render(createElement(Probe))
        await drain()
      })
    },
  }
}
async function receive(socket: Socket, event: string, payload: any) {
  await act(async () => {
    socket.receive(event, payload)
    await drain()
  })
}
async function remote(socket: Socket, playerId: string) {
  await receive(socket, "voice:state", {
    playerId,
    enabled: true,
    muted: false,
    speaking: false,
  })
  return Peer.all.at(-1)!
}
async function signal(
  socket: Socket,
  self: string,
  from: string,
  inputSignal: any
) {
  await receive(socket, "voice:signal", {
    targetPlayerId: self,
    fromPlayerId: from,
    signal: inputSignal,
  })
}
async function time(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await drain()
  })
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  Peer.all = []
  vi.stubGlobal("RTCPeerConnection", Peer)
  vi.stubGlobal("MediaStream", Stream)
  mic = new Track()
  getUserMedia = vi.fn(async () => new Stream([mic]))
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
  fetchConfig = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      iceServers: [
        { urls: "stun:test" },
        { urls: "turn:test", username: "test", credential: "test" },
      ],
    }),
  }))
  vi.stubGlobal("fetch", fetchConfig)
  vi.spyOn(console, "debug").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  useRoomVoice = (await import("./use-room-voice")).useRoomVoice
})
afterEach(async () => {
  for (const root of roots)
    await act(async () => {
      root.unmount()
      await drain()
    })
  roots = []
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  document.body.innerHTML = ""
})

describe("room voice reliability", () => {
  it("sends the filtered track, switches without new offers, and mutes capture and output", async () => {
    const p = await mount()
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "a", "b", {
      type: "answer",
      sdp: "a=ice-ufrag:good",
    })
    const output = new Track()
    const postMessage = vi.fn()
    const node = {
      port: { postMessage, close: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      onprocessorerror: null,
    }
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        constructor() {
          return node
        }
      }
    )
    vi.stubGlobal(
      "AudioContext",
      class {
        audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
        resume = vi.fn().mockResolvedValue(undefined)
        close = vi.fn().mockResolvedValue(undefined)
        createMediaStreamSource() {
          return { connect: () => node, disconnect: vi.fn() }
        }
        createMediaStreamDestination() {
          return { stream: new Stream([output]), channelCount: 2 }
        }
      }
    )
    await act(async () => {
      p.voice().setFilter("cat")
      p.voice().toggle()
      await drain()
    })
    expect(peer.transceivers[0].sender.track).toBe(output)
    expect(peer.transceivers[0].sender.track).not.toBe(mic)
    expect(output.enabled).toBe(true)
    const offers = peer.offers
    await act(async () => {
      p.voice().setFilter("robot")
      await drain()
    })
    expect(postMessage).toHaveBeenLastCalledWith("robot")
    expect(peer.offers).toBe(offers)
    expect(peer.transceivers[0].sender.track).toBe(output)
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    expect(mic.enabled).toBe(false)
    expect(output.enabled).toBe(false)
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    expect(mic.enabled).toBe(true)
    expect(output.enabled).toBe(true)
  })

  it("keeps capture muted during processor loading and disposes it on room exit", async () => {
    const p = await mount()
    let resolveModule!: () => void
    const close = vi.fn().mockResolvedValue(undefined)
    const output = new Track()
    const node = {
      port: { postMessage: vi.fn(), close: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      onprocessorerror: null,
    }
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        constructor() {
          return node
        }
      }
    )
    vi.stubGlobal(
      "AudioContext",
      class {
        audioWorklet = {
          addModule: () =>
            new Promise<void>((resolve) => {
              resolveModule = resolve
            }),
        }
        resume = vi.fn().mockResolvedValue(undefined)
        close = close
        createMediaStreamSource() {
          return { connect: () => node, disconnect: vi.fn() }
        }
        createMediaStreamDestination() {
          return { stream: new Stream([output]), channelCount: 2 }
        }
      }
    )
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    expect(mic.enabled).toBe(false)
    expect(p.voice().muted).toBe(true)
    expect(p.voice().connecting).toBe(true)
    await act(async () => {
      p.root.unmount()
      await drain()
    })
    roots = roots.filter((root) => root !== p.root)
    expect(mic.readyState).toBe("ended")
    expect(close).toHaveBeenCalled()
    await act(async () => {
      resolveModule()
      await drain()
    })
    expect(output.readyState).toBe("ended")
  })

  it("baseline: joins as listener and swaps in a live mic", async () => {
    const p = await mount()
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "a", "b", {
      type: "answer",
      sdp: "a=ice-ufrag:good",
    })
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    expect(peer.transceivers[0].sender.track).toBe(mic)
    expect(p.voice().muted).toBe(false)
    expect(mic.readyState).toBe("live")
  })

  it("discards stale ICE candidates and still answers with valid candidates", async () => {
    const p = await mount("z")
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "z", "b", {
      type: "ice-candidate",
      candidate: { usernameFragment: "old" },
    })
    await signal(p.socket, "z", "b", {
      type: "ice-candidate",
      candidate: { usernameFragment: "good" },
    })
    await signal(p.socket, "z", "b", { type: "offer", sdp: "a=ice-ufrag:good" })
    expect(peer.candidateErrors).toEqual([])
    expect(peer.addedCandidates).toHaveLength(1)
    expect(peer.answers).toBe(1)
    expect(peer.signalingState).toBe("stable")
    expect(
      p.socket.sent.filter(
        (packet) => packet.payload?.signal?.type === "answer"
      )
    ).toHaveLength(1)
  })

  it("keeps ignored collision candidates out of the accepted answer", async () => {
    const p = await mount()
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "a", "b", {
      type: "offer",
      sdp: "a=ice-ufrag:ignored",
    })
    await signal(p.socket, "a", "b", {
      type: "ice-candidate",
      candidate: { usernameFragment: "ignored" },
    })
    await signal(p.socket, "a", "b", {
      type: "ice-candidate",
      candidate: { usernameFragment: "good" },
    })
    await signal(p.socket, "a", "b", {
      type: "answer",
      sdp: "a=ice-ufrag:good",
    })
    expect(peer.remoteDescription?.type).toBe("answer")
    expect(peer.candidateErrors).toEqual([])
    expect(peer.addedCandidates).toHaveLength(1)
  })

  it("rebuilds an unanswered offer at the first timeout and sends a new offer", async () => {
    const p = await mount()
    const peer = await remote(p.socket, "b")
    await time(15_000)
    expect(peer.connectionState).toBe("closed")
    expect(
      p.socket.sent.filter((packet) => packet.payload?.signal?.type === "offer")
    ).toHaveLength(2)
  })

  it("preserves relay-only mode on every later rebuild", async () => {
    const p = await mount()
    await remote(p.socket, "b")
    await time(45_000)
    const relay = Peer.all.at(-1)!
    expect(relay.config.iceTransportPolicy).toBe("relay")
    await time(45_000)
    expect(relay.connectionState).toBe("closed")
    expect(Peer.all.at(-1)!.config.iceTransportPolicy).toBe("relay")
  })

  it("repairs a rejected sender without stopping the shared mic", async () => {
    const p = await mount()
    const b = await remote(p.socket, "b")
    const c = await remote(p.socket, "c")
    b.rejectReplace = true
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    expect(c.transceivers[0].sender.track).toBe(mic)
    expect(mic.readyState).toBe("live")
    expect(b.connectionState).toBe("closed")
    expect(p.voice().enabled).toBe(true)
    expect(p.voice().muted).toBe(false)
    expect(p.voice().error).toBeNull()
    expect(
      p.socket.sent
        .filter((packet) => packet.event === "voice:setState")
        .at(-1)!.payload.muted
    ).toBe(false)
  })

  it("reports an ended mic and captures a new one on the next tap", async () => {
    const p = await mount()
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    await act(async () => {
      mic.readyState = "ended"
      mic.dispatchEvent(new Event("ended"))
      await drain()
    })
    expect(p.voice().muted).toBe(true)
    expect(p.voice().error).toContain("Microphone stopped")
    const replacement = new Track()
    getUserMedia.mockResolvedValueOnce(new Stream([replacement]))
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(replacement.readyState).toBe("live")
    expect(p.voice().muted).toBe(false)
  })

  it("stops a late permission result without publishing or sending it", async () => {
    let resolve!: (stream: Stream) => void
    getUserMedia.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const p = await mount()
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    await act(async () => {
      p.root.unmount()
      await drain()
    })
    roots = roots.filter((r) => r !== p.root)
    const sentBefore = p.socket.sent.length
    await act(async () => {
      resolve(new Stream([mic]))
      await drain()
    })
    expect(mic.readyState).toBe("ended")
    expect(
      p.socket.sent
        .slice(sentBefore)
        .some(
          (packet) =>
            packet.event === "voice:setState" && packet.payload.enabled
        )
    ).toBe(false)
  })

  it("retries a failed ICE settings fetch when rejoining", async () => {
    fetchConfig.mockRejectedValueOnce(new Error("temporary network outage"))
    const p = await mount()
    await act(async () => {
      p.root.unmount()
      await drain()
    })
    roots = roots.filter((r) => r !== p.root)
    await mount()
    expect(fetchConfig).toHaveBeenCalledTimes(2)
  })

  it("repairs an ended remote track even when transport remains connected", async () => {
    const p = await mount()
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "a", "b", {
      type: "answer",
      sdp: "a=ice-ufrag:good",
    })
    await act(async () => {
      peer.state("connected")
      await drain()
    })
    peer.transceivers[0].receiver.track.readyState = "ended"
    await time(5_000)
    expect(peer.connectionState).toBe("closed")
    expect(Peer.all).toHaveLength(2)
    expect(p.voice().connectionIssues.b).toContain("Reconnecting")
  })

  it("preserves build-time TURN when runtime only supplies STUN", async () => {
    vi.stubEnv(
      "VITE_RTC_ICE_SERVERS",
      JSON.stringify([
        {
          urls: ["stun:build", "turn:build"],
          username: "test",
          credential: "test",
        },
      ])
    )
    vi.resetModules()
    useRoomVoice = (await import("./use-room-voice")).useRoomVoice
    fetchConfig.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ iceServers: [{ urls: "stun:runtime" }] }),
    })
    const p = await mount()
    const peer = await remote(p.socket, "b")
    expect(peer.config.iceServers[0].urls).toContain("turn:build")
  })

  it("does not build peers or send offers while offline, and waits for rejoin", async () => {
    const p = await mount()
    await remote(p.socket, "b")
    p.socket.connected = false
    await receive(p.socket, "disconnect", undefined)
    await p.rejoin(null)
    const sentBefore = p.socket.sent.length
    await time(20_000)
    expect(Peer.all).toHaveLength(1)
    expect(p.socket.sent).toHaveLength(sentBefore)
    p.socket.connected = true
    p.socket.id = "socket-new"
    await receive(p.socket, "connect", undefined)
    expect(p.socket.sent).toHaveLength(sentBefore)
    await p.rejoin("socket-new")
    await remote(p.socket, "b")
    expect(
      p.socket.sent
        .slice(sentBefore)
        .some((packet) => packet.payload?.signal?.type === "offer")
    ).toBe(true)
  })

  it("does not start voice before room membership is acknowledged", async () => {
    const p = await mount("a", new Socket(), null)
    expect(p.socket.sent).toHaveLength(0)
    expect(p.voice().enabled).toBe(false)
    await p.rejoin(p.socket.id)
    expect(p.voice().enabled).toBe(true)
  })

  it("shows an ownership error for a second tab without opening a mic", async () => {
    const socket = new Socket()
    socket.joinAccepted = false
    const p = await mount("a", socket)
    expect(p.voice().enabled).toBe(false)
    expect(p.voice().error).toContain("another tab")
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it("ignores answers from an older exchange", async () => {
    const p = await mount()
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "a", "b", {
      type: "answer",
      sdp: "a=ice-ufrag:old",
      exchangeId: "old",
    })
    expect(peer.remoteDescription).toBeNull()
    const exchangeId = p.socket.sent.find(
      (packet) => packet.payload?.signal?.type === "offer"
    )!.payload.signal.exchangeId
    await signal(p.socket, "a", "b", {
      type: "answer",
      sdp: "a=ice-ufrag:good",
      exchangeId,
    })
    expect(peer.signalingState).toBe("stable")
  })

  it("recovers missing incoming packets during speech without disturbing silent peers", async () => {
    const p = await mount()
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "a", "b", {
      type: "answer",
      sdp: "a=ice-ufrag:good",
    })
    await act(async () => {
      peer.state("connected")
      await drain()
    })
    await time(60_000)
    expect(peer.offers).toBe(1)
    await receive(p.socket, "voice:state", {
      playerId: "b",
      enabled: true,
      muted: false,
      speaking: true,
    })
    await time(25_000)
    expect(peer.offers).toBe(2)
  })
  it("does not let one rejected candidate discard the next candidate or the answer", async () => {
    const p = await mount("z")
    const peer = await remote(p.socket, "b")
    await signal(p.socket, "z", "b", {
      type: "ice-candidate",
      candidate: { usernameFragment: "good", invalid: true },
    })
    await signal(p.socket, "z", "b", {
      type: "ice-candidate",
      candidate: { usernameFragment: "good" },
    })
    await signal(p.socket, "z", "b", { type: "offer", sdp: "a=ice-ufrag:good" })
    expect(peer.addedCandidates).toHaveLength(1)
    expect(peer.answers).toBe(1)
  })

  it("stops a pending mic when the socket disconnects", async () => {
    let resolve!: (stream: Stream) => void
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const p = await mount()
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    p.socket.connected = false
    await receive(p.socket, "disconnect", undefined)
    const sent = p.socket.sent.length
    await act(async () => {
      resolve(new Stream([mic]))
      await drain()
    })
    expect(mic.readyState).toBe("ended")
    expect(p.socket.sent).toHaveLength(sent)
  })

  it("stops a retained mic when another tab wins voice ownership after reconnect", async () => {
    const p = await mount()
    await act(async () => {
      p.voice().toggle()
      await drain()
    })
    p.socket.connected = false
    await receive(p.socket, "disconnect", undefined)
    await p.rejoin(null)
    p.socket.connected = true
    p.socket.id = "new-socket"
    p.socket.joinAccepted = false
    await p.rejoin(p.socket.id)
    expect(mic.readyState).toBe("ended")
    expect(p.voice().enabled).toBe(false)
    expect(p.voice().muted).toBe(true)
    expect(p.voice().error).toContain("another tab")
  })

  it("rejects messages from an old tab session", async () => {
    const p = await mount()
    await receive(p.socket, "voice:state", {
      playerId: "b",
      voiceSessionId: "current-b",
      enabled: true,
      muted: false,
      speaking: false,
    })
    const peer = Peer.all.at(-1)!
    await receive(p.socket, "voice:signal", {
      targetPlayerId: "a",
      targetSessionId: "voice-a",
      fromPlayerId: "b",
      fromSessionId: "old-b",
      signal: { type: "answer", sdp: "a=ice-ufrag:old" },
    })
    expect(peer.remoteDescription).toBeNull()
  })

  it("never claims voice after a pending config load outlives the room", async () => {
    let resolve!: (value: any) => void
    fetchConfig.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const p = await mount()
    await act(async () => {
      p.root.unmount()
      await drain()
    })
    roots = roots.filter((root) => root !== p.root)
    await act(async () => {
      resolve({
        ok: true,
        json: () => Promise.resolve({ iceServers: [{ urls: "stun:test" }] }),
      })
      await drain()
    })
    expect(p.socket.sent.some((packet) => packet.event === "voice:join")).toBe(
      false
    )
  })
})
