import { createFileRoute, useNavigate } from "@tanstack/react-router"
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
      setError("Tell the table who you are first.")
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
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not reach the game server."
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="flex min-h-dvh bg-[#0A0A0A] px-4 py-5 text-white antialiased sm:p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col justify-center gap-6 py-8 sm:gap-8">
        <section className="max-w-2xl">
          <p className="text-[11px] font-medium tracking-[0.2em] text-white/45 uppercase sm:text-xs">
            UNO No Mercy
          </p>
          <h1 className="mt-3 max-w-xl text-4xl leading-[1.04] font-semibold tracking-tight text-balance sm:text-5xl">
            Book a private No Mercy table.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-pretty text-white/58">
            Send the code, pull everyone into one live room, and let the
            stack-offs, color calls, and UNO catches unfold in real time.
          </p>
        </section>

        <form
          className="w-full max-w-xl rounded-xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_16px_46px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreateRoom()
          }}
        >
          <label
            className="text-sm font-medium text-white/82"
            htmlFor="player-name"
          >
            Player name
          </label>
          <p className="mt-1 text-xs leading-5 text-white/42">
            This shows on your seat, in chat, and when you get caught.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              id="player-name"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              className="min-h-11 w-full flex-none rounded-lg border border-white/10 bg-black/42 px-3.5 text-base text-white transition-[border-color,background-color,box-shadow] duration-200 outline-none placeholder:text-white/30 focus:border-white/28 focus:bg-black/58 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.055)] sm:h-10 sm:flex-1 sm:text-sm"
              placeholder="Arc"
              maxLength={24}
              autoComplete="nickname"
            />
            <Button
              type="submit"
              disabled={creating}
              className="h-10 self-start rounded-lg bg-white px-4 text-sm text-neutral-950 shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-[background-color,opacity,scale] hover:bg-white/86 active:scale-[0.96] sm:self-auto"
            >
              {creating ? "Creating..." : "Create room"}
            </Button>
          </div>
          {error && (
            <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  )
}
