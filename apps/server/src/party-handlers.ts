import type { Socket } from "socket.io"
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  RoomSnapshot,
  CommandResult,
} from "@workspace/game"
import type { RoomManager } from "./room-manager"

export function registerPartyHandlers(
  socket: Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >,
  rooms: RoomManager,
  publish: (code: string, room: RoomSnapshot) => void
) {
  function run(
    command: (code: string, playerId: string) => CommandResult<RoomSnapshot>,
    ack: (result: CommandResult<RoomSnapshot>) => void
  ) {
    if (typeof ack !== "function") return
    const { roomCode, playerId } = socket.data
    if (!roomCode || !playerId) {
      ack({
        ok: false,
        error: { code: "not-joined", message: "Join a room first." },
      })
      return
    }
    const result = command(roomCode, playerId)
    ack(result)
    if (result.ok) publish(roomCode, result.data)
  }

  socket.on("game:offerBlindTrade", (input, ack) =>
    run((code, id) => rooms.offerBlindTrade(code, id, input), ack)
  )
  socket.on("game:respondBlindTrade", (input, ack) =>
    run((code, id) => rooms.respondBlindTrade(code, id, input), ack)
  )
  socket.on("game:cancelBlindTrade", (input, ack) =>
    run((code, id) => rooms.cancelBlindTrade(code, id, input), ack)
  )
  socket.on("game:resolveLastGift", (input, ack) =>
    run((code, id) => rooms.resolveLastGift(code, id, input), ack)
  )
}
