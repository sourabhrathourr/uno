import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { createRoom } from "@/lib/realtime"
import {
  getPlayerSessionId,
  getSavedPlayerName,
  saveActiveRoomCode,
  savePlayerName,
} from "@/lib/session"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const navigate = useNavigate()
  const [playerName, setPlayerName] = useState(getSavedPlayerName)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateRoom() {
    const cleanName = playerName.trim()
    if (!cleanName) {
      setError("Enter your name to create a room.")
      return
    }

    setCreating(true)
    setError(null)
    savePlayerName(cleanName)

    try {
      const result = await createRoom({
        playerName: cleanName,
        sessionId: getPlayerSessionId(),
      })

      if (!result.ok) {
        setError(result.error.message)
        return
      }

      saveActiveRoomCode(result.data.room.code)
      await navigate({
        to: "/room/$roomCode",
        params: { roomCode: result.data.room.code },
      })
    } catch {
      setError("Could not reach the game server on localhost:4001.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-svh bg-neutral-950 p-6 text-white antialiased">
      <div className="mx-auto flex w-full max-w-4xl flex-col justify-center gap-8">
        <div className="max-w-xl">
          <p className="text-xs font-medium tracking-[0.18em] text-white/45 uppercase">
            UNO No Mercy
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Create a room and deal in.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/55">
            This MVP runs through one authoritative Node.js server. Share the room
            code or the URL, and every player joins the same Socket.IO lobby.
          </p>
        </div>

        <div className="max-w-xl rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <label className="text-sm font-medium text-white/80" htmlFor="player-name">
            Player name
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              id="player-name"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/30"
              placeholder="Sourabh"
              maxLength={24}
            />
            <Button
              type="button"
              disabled={creating}
              onClick={handleCreateRoom}
              className="bg-white text-neutral-950 hover:bg-white/85"
            >
              {creating ? "Creating..." : "Create room"}
            </Button>
          </div>
          {error && (
            <p className="mt-3 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          )}
        </div>

        <Link to="/cards" className="text-sm text-white/55 hover:text-white">
          Open card lab
        </Link>
      </div>
    </div>
  )
}
