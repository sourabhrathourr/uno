import { createServer } from "node:http"
import { Server } from "socket.io"
import { io as connect } from "socket.io-client"
import { describe, expect, it } from "vitest"
import type { GameState, RoomSnapshot } from "@workspace/game"
import { RoomManager } from "./room-manager"
import { registerPartyHandlers } from "./party-handlers"

describe("party socket dry run", () => {
  it("runs a private trade, roulette knockout, gift of the 26th card, and resumed play across three clients", async () => {
    const http = createServer()
    const io = new Server(http)
    const manager = new RoomManager()
    const created = manager.createRoom({
      playerName: "A",
      sessionId: "dry-run-a",
    })
    if (!created.ok) throw new Error(created.error.message)
    const code = created.data.room.code
    const sockets: ReturnType<typeof connect>[] = []
    function publish(_code: string, room: RoomSnapshot) {
      io.emit("room:snapshot", room)
      for (const serverSocket of io.sockets.sockets.values()) {
        if (!serverSocket.data.playerId) continue
        const state = manager.getPlayerGame(code, serverSocket.data.playerId)
        if (state) serverSocket.emit("game:playerState", state)
      }
    }
    io.on("connection", (socket) => {
      registerPartyHandlers(socket, manager, publish)
      socket.on("room:join", (input, ack) => {
        const result = manager.joinRoom(input)
        if (result.ok) {
          socket.data.roomCode = code
          socket.data.playerId = result.data.player.id
          manager.registerConnection(code, result.data.player.id, socket.id)
        }
        ack(result)
      })
      socket.on("disconnect", () => {
        if (socket.data.playerId)
          manager.unregisterConnection(code, socket.data.playerId, socket.id)
      })
    })
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
    const address = http.address()
    if (!address || typeof address === "string")
      throw new Error("Expected a test port")
    try {
      for (const id of ["a", "b", "c"]) {
        const socket = connect(`http://127.0.0.1:${address.port}`, {
          transports: ["websocket"],
          forceNew: true,
        })
        sockets.push(socket)
        await new Promise<void>((resolve) => socket.once("connect", resolve))
        if (id === "a") {
          const denied = await socket.emitWithAck("game:offerBlindTrade", {
            cardId: "forged",
            targetPlayerId: "b",
          })
          expect(denied).toMatchObject({
            ok: false,
            error: { code: "not-joined" },
          })
        }
        const joined = await socket.emitWithAck("room:join", {
          code,
          playerName: id.toUpperCase(),
          sessionId: `dry-run-${id}`,
        })
        expect(joined.ok).toBe(true)
        manager.setReady(code, joined.data.player.id, true)
      }
      const ids = (
        manager.getRoom(code) as { ok: true; data: RoomSnapshot }
      ).data.players.map((player) => player.id)
      const [a, b, c] = ids as [string, string, string]
      expect(manager.startRoom(code, a).ok).toBe(true)
      const game = (
        manager as unknown as { rooms: Map<string, { gameState: GameState }> }
      ).rooms.get(code)!.gameState
      game.handsByPlayerId = Object.fromEntries(
        ids.map((id) => [
          id,
          [
            {
              id: `${id}-red`,
              color: "red",
              face: { kind: "number", value: 1 },
            },
            {
              id: `${id}-blue`,
              color: "blue",
              face: { kind: "number", value: 2 },
            },
          ],
        ])
      )
      const [clientA, clientB, clientC] = sockets as [
        ReturnType<typeof connect>,
        ReturnType<typeof connect>,
        ReturnType<typeof connect>,
      ]
      const offered = await clientA.emitWithAck("game:offerBlindTrade", {
        cardId: `${a}-blue`,
        targetPlayerId: b,
      })
      expect(offered.ok).toBe(true)
      expect(offered.data.game.tradeOffer).not.toHaveProperty("cardId")
      const offerId = offered.data.game.tradeOffer.id
      expect(
        await clientC.emitWithAck("game:respondBlindTrade", {
          offerId,
          accept: true,
          cardId: `${c}-red`,
        })
      ).toMatchObject({ ok: false })
      expect(
        await clientB.emitWithAck("game:respondBlindTrade", {
          offerId,
          accept: true,
          cardId: `${b}-red`,
        })
      ).toMatchObject({ ok: true })
      expect(game.handsByPlayerId.a).toBeUndefined()
      expect(game.handsByPlayerId[a]?.map((card) => card.id)).toContain(
        `${b}-red`
      )
      expect(game.handsByPlayerId[b]?.map((card) => card.id)).toContain(
        `${a}-blue`
      )
      expect(game.turnPlayerId).toBe(a)
      expect(
        await clientB.emitWithAck("game:respondBlindTrade", {
          offerId,
          accept: true,
          cardId: `${b}-red`,
        })
      ).toMatchObject({ ok: false })

      game.handsByPlayerId[a] = Array.from({ length: 25 }, (_, i) => ({
        id: `frozen-${i}`,
        color: "yellow",
        face: { kind: "number", value: 1 },
      }))
      game.discardPile = [
        {
          id: "roulette",
          color: "wild",
          face: { kind: "wild-color-roulette" },
        },
      ]
      game.drawPile = [
        { id: "26th-card", color: "blue", face: { kind: "number", value: 7 } },
        {
          id: "untouched-red",
          color: "red",
          face: { kind: "number", value: 3 },
        },
      ]
      game.currentColor = "red"
      game.pendingChoice = {
        type: "roulette-draw",
        playerId: a,
        color: "red",
        drawnCards: [],
      }
      const knockedOut = manager.drawRouletteCard(code, a)
      expect(knockedOut.ok).toBe(true)
      const giftId = game.lastGifts[0]!.id
      expect(manager.getPlayerGame(code, a)?.lastGiftCards).toHaveLength(26)
      expect(manager.getPlayerGame(code, b)?.lastGiftCards).toEqual([])
      expect(manager.drawOne(code, b)).toMatchObject({
        ok: false,
        error: { code: "last-gift-pending" },
      })
      expect(
        await clientC.emitWithAck("game:resolveLastGift", {
          giftId,
          cardId: "26th-card",
          targetPlayerId: b,
        })
      ).toMatchObject({ ok: false })
      const given = await clientA.emitWithAck("game:resolveLastGift", {
        giftId,
        cardId: "26th-card",
        targetPlayerId: b,
      })
      expect(given).toMatchObject({ ok: true })
      expect(game.lastGifts).toEqual([])
      expect(
        manager.getPlayerGame(code, b)?.hand.map((card) => card.id)
      ).toContain("26th-card")
      expect(game.drawPile.map((card) => card.id)).toEqual(["untouched-red"])
      expect(manager.drawOne(code, b).ok).toBe(true)
      expect(manager.endTurn(code, b).ok).toBe(true)
      expect(game.turnPlayerId).toBe(c)
      expect(
        await clientA.emitWithAck("game:resolveLastGift", {
          giftId,
          cardId: "26th-card",
          targetPlayerId: b,
        })
      ).toMatchObject({ ok: false })
      expect(
        await clientC.emitWithAck("game:offerBlindTrade", null)
      ).toMatchObject({ ok: false, error: { code: "invalid-party-input" } })
    } finally {
      sockets.forEach((socket) => socket.disconnect())
      await new Promise<void>((resolve) => io.close(() => resolve()))
    }
  })
})
