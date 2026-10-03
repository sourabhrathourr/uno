import { randomUUID } from "node:crypto"
import type { Server, Socket } from "socket.io"
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  VoiceStateEvent,
} from "@workspace/game"

type VoiceSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>
type VoiceServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>
type Owner = { socketId: string; state: VoiceStateEvent }

/** A game seat may have many tabs; exactly one of them owns its voice stream. */
export class RoomVoice {
  private rooms = new Map<string, Map<string, Owner>>()
  constructor(private io: VoiceServer) {}

  private claim(socket: VoiceSocket, renew = false) {
    const { roomCode, playerId } = socket.data
    if (!roomCode || !playerId) return false
    const room = this.rooms.get(roomCode) ?? new Map<string, Owner>()
    const owner = room.get(playerId)
    if (owner && owner.socketId !== socket.id) return false
    if (!owner || renew) {
      room.set(playerId, {
        socketId: socket.id,
        state: {
          playerId,
          voiceSessionId: randomUUID(),
          enabled: true,
          muted: true,
          speaking: false,
        },
      })
      this.rooms.set(roomCode, room)
    }
    return true
  }

  private debug(event: string, details: Record<string, unknown>) {
    if (process.env.VOICE_DEBUG === "1" || process.env.VOICE_DEBUG === "true")
      console.debug(`[uno voice] ${event}`, details)
  }

  private unavailable(socket: VoiceSocket) {
    return {
      code: socket.data.roomCode ? "voice-in-another-tab" : "not-joined",
      message: socket.data.roomCode
        ? "Voice is active in another tab. Close that tab, then tap the mic here."
        : "Rejoin the room before starting voice.",
    }
  }

  attach(socket: VoiceSocket) {
    socket.on("voice:join", (ack) => {
      if (typeof ack !== "function") return
      if (!this.claim(socket, true)) {
        ack({ ok: false, error: this.unavailable(socket) })
        return
      }
      const roomCode = socket.data.roomCode!
      this.debug("voice claimed", {
        roomCode,
        playerId: socket.data.playerId,
        socketId: socket.id,
      })
      ack({
        ok: true,
        data: {
          sessionId: this.rooms.get(roomCode)!.get(socket.data.playerId!)!.state
            .voiceSessionId!,
          states: this.states(roomCode),
        },
      })
      this.io
        .to(roomCode)
        .emit(
          "voice:state",
          this.rooms.get(roomCode)!.get(socket.data.playerId!)!.state
        )
    })
    socket.on("voice:requestStates", () => this.sendStates(socket))
    socket.on("voice:setState", (input) => {
      const { roomCode, playerId } = socket.data
      if (!roomCode || !playerId) return
      const existing = this.rooms.get(roomCode)?.get(playerId)
      if (
        input.voiceSessionId &&
        existing?.state.voiceSessionId !== input.voiceSessionId
      )
        return
      if (!input.enabled) {
        this.release(socket)
        return
      }
      // Preserve old clients during rollout, but never let another tab overwrite an owner.
      if (!this.claim(socket)) {
        socket.emit("voice:unavailable", this.unavailable(socket))
        return
      }
      const owner = this.rooms.get(roomCode)!.get(playerId)!
      owner.state = {
        playerId,
        voiceSessionId: owner.state.voiceSessionId,
        enabled: true,
        muted: Boolean(input.muted),
        speaking: !input.muted && Boolean(input.speaking),
      }
      this.io.to(roomCode).emit("voice:state", owner.state)
    })
    socket.on("voice:signal", (input) => {
      const { roomCode, playerId } = socket.data
      if (!roomCode || !playerId || input.targetPlayerId === playerId) return
      const room = this.rooms.get(roomCode)
      if (!room || room.get(playerId)?.socketId !== socket.id) return
      const target = room.get(input.targetPlayerId)
      if (
        !target ||
        (input.targetSessionId &&
          input.targetSessionId !== target.state.voiceSessionId)
      )
        return
      this.debug("signal relayed", {
        roomCode,
        playerId,
        targetPlayerId: input.targetPlayerId,
        type: input.signal.type,
        exchangeId: input.signal.exchangeId,
      })
      this.io.to(target.socketId).emit("voice:signal", {
        ...input,
        fromPlayerId: playerId,
        fromSessionId: room.get(playerId)!.state.voiceSessionId,
        targetSessionId: target.state.voiceSessionId,
      })
    })
    socket.on("disconnect", () => this.release(socket))
  }

  states(roomCode: string): VoiceStateEvent[] {
    return Array.from(
      this.rooms.get(roomCode)?.values() ?? [],
      (owner) => owner.state
    )
  }

  sendStates(socket: VoiceSocket) {
    if (!socket.data.roomCode) return
    for (const state of this.states(socket.data.roomCode))
      socket.emit("voice:state", state)
  }

  release(socket: VoiceSocket) {
    const { roomCode, playerId } = socket.data
    if (!roomCode || !playerId) return
    const room = this.rooms.get(roomCode)
    if (!room || room.get(playerId)?.socketId !== socket.id) return
    const voiceSessionId = room.get(playerId)!.state.voiceSessionId
    room.delete(playerId)
    if (!room.size) this.rooms.delete(roomCode)
    this.io.to(roomCode).emit("voice:state", {
      playerId,
      voiceSessionId,
      enabled: false,
      muted: true,
      speaking: false,
    })
  }

  clearRoom(roomCode: string) {
    const owners = this.rooms.get(roomCode)
    this.rooms.delete(roomCode)
    for (const owner of owners?.values() ?? []) {
      this.io
        .to(owner.socketId)
        .emit("voice:unavailable", {
          code: "room-expired",
          message: "This room has expired.",
        })
    }
  }
}
