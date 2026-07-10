import { createFileRoute } from "@tanstack/react-router"
import confetti from "canvas-confetti"
import {
  ArrowRight,
  Check,
  Circle,
  Clipboard,
  ImageIcon,
  MessageCircle,
  Mic,
  MicOff,
  Play,
  RotateCw,
  SendHorizontal,
  Smile,
  Sparkles,
  Trophy,
  UserRound,
  UsersRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useWebHaptics } from "web-haptics/react"

import {
  CHAT_EMOJIS,
  CHAT_GIFS,
  CHAT_PRESETS,
  TABLE_REACTION_EMOJIS,
  TABLE_REACTION_PRESETS,
} from "@workspace/game"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { UnoCard } from "@workspace/ui/components/uno-card"
import type {
  Card,
  ChatChannel,
  ChatMessage,
  GameError,
  GameEvent,
  JoinRoomResponse,
  PlayCardsInput,
  PlayColor,
  Player,
  PlayerGameSnapshot,
  PlayerSocialSnapshot,
  RoomSnapshot,
  SendChatMessageInput,
  SendTableReactionInput,
  StageCardsInput,
} from "@workspace/game"
import type { PointerEvent, ReactNode } from "react"
import type { Options as ConfettiOptions } from "canvas-confetti"

import type { GameSocket } from "@/lib/realtime"
import type { RoomVoiceController } from "@/lib/use-room-voice"
import type { ChatTray } from "@/components/use-channel-chat"
import {
  SupportConfirmDialog,
  availableSupportCandidates,
} from "@/components/support-experience"
import { useChannelChat } from "@/components/use-channel-chat"

import { getGameSocket, getRoomPreview } from "@/lib/realtime"
import {
  getActiveRoomCode,
  getPlayerSessionId,
  getSavedPlayerName,
  saveActiveRoomCode,
  savePlayerName,
} from "@/lib/session"
import {
  playCardSound,
  playFx,
  playShuffleSound,
  playWinnerSound,
} from "@/lib/sound"
import { useSoundSystem } from "@/lib/use-sound-system"
import { logRoomVoiceDebug, useRoomVoice } from "@/lib/use-room-voice"

type ResponsiveCardSize = "sm" | "md"
type DeckDrawFlightState = {
  id: string
  eventId: string
  targetPlayerId: string
  cardCount: number
}

export const Route = createFileRoute("/room/$roomCode")({
  component: RoomPage,
})

function RoomPage() {
  const { roomCode } = Route.useParams()
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [playerName, setPlayerName] = useState(getSavedPlayerName)
  const [connected, setConnected] = useState(false)
  const [joining, setJoining] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [socket, setSocket] = useState<GameSocket | null>(null)
  const [playerGame, setPlayerGame] = useState<PlayerGameSnapshot | null>(null)
  const [playerSocial, setPlayerSocial] = useState<PlayerSocialSnapshot | null>(
    null
  )
  const [startIntroPhase, setStartIntroPhase] = useState<
    "idle" | "lights" | "shuffle" | "deal" | "done"
  >("idle")
  const roomRef = useRef<RoomSnapshot | null>(null)
  const playerRef = useRef<Player | null>(null)
  const playerGameRoomVersionRef = useRef(0)
  const joinInFlightRef = useRef(false)
  const lastEventIdRef = useRef<string | null>(null)
  const lastTurnPlayerIdRef = useRef<string | null>(null)
  const lastStatusRef = useRef<RoomSnapshot["status"] | null>(null)
  const seenInitialGameSnapshotRef = useRef(false)
  const seenMentionMessageIdsRef = useRef(new Set<string>())
  const mentionSnapshotInitializedRef = useRef(false)
  useSoundSystem()
  const haptic = useWebHaptics()

  const normalizedRoomCode = roomCode.toUpperCase()
  const isHost = room?.hostPlayerId === player?.id
  const currentPlayer = room?.players.find(
    (candidate) => candidate.id === player?.id
  )
  const voice = useRoomVoice({
    socket,
    roomCode: normalizedRoomCode,
    selfPlayerId: player?.id ?? null,
    players: room?.players ?? [],
  })

  function applyRoomSnapshot(nextRoom: RoomSnapshot | null) {
    const currentRoom = roomRef.current

    if (
      nextRoom &&
      currentRoom &&
      nextRoom.code === currentRoom.code &&
      nextRoom.version < currentRoom.version
    ) {
      return false
    }

    roomRef.current = nextRoom
    setRoom(nextRoom)
    return true
  }

  function applyPlayer(nextPlayer: Player | null) {
    playerRef.current = nextPlayer
    setPlayer(nextPlayer)
  }

  function applyPlayerGameSnapshot(nextPlayerGame: PlayerGameSnapshot | null) {
    if (!nextPlayerGame) {
      playerGameRoomVersionRef.current = 0
      setPlayerGame(null)
      return
    }

    if (nextPlayerGame.playerId !== playerRef.current?.id) return

    const incomingVersion =
      nextPlayerGame.roomVersion ?? roomRef.current?.version ?? 0
    const currentRoomVersion = roomRef.current?.version ?? 0
    if (incomingVersion < currentRoomVersion) return
    if (incomingVersion < playerGameRoomVersionRef.current) return

    playerGameRoomVersionRef.current = incomingVersion
    setPlayerGame(nextPlayerGame)
  }

  function applyPlayerSocialSnapshot(nextSocial: PlayerSocialSnapshot | null) {
    setPlayerSocial(nextSocial)
  }

  function applyJoinSuccess(result: JoinRoomResponse) {
    saveActiveRoomCode(result.room.code)
    applyPlayer(result.player)
    applyRoomSnapshot(result.room)
    applyPlayerGameSnapshot(result.playerGame ?? null)
    for (const message of result.playerSocial?.squadChatMessages ?? []) {
      seenMentionMessageIdsRef.current.add(message.id)
    }
    applyPlayerSocialSnapshot(result.playerSocial ?? null)
  }

  function restoreSocketSeat(activeSocket: GameSocket) {
    if (joinInFlightRef.current) return

    const activePlayer = playerRef.current
    const cleanName = (activePlayer?.name || getSavedPlayerName()).trim()
    const shouldRestore =
      Boolean(activePlayer) || getActiveRoomCode() === normalizedRoomCode

    if (!cleanName || !shouldRestore) return

    joinInFlightRef.current = true
    activeSocket.emit(
      "room:join",
      {
        code: normalizedRoomCode,
        playerName: cleanName,
        sessionId: getPlayerSessionId(),
      },
      (result) => {
        joinInFlightRef.current = false
        if (!result.ok) {
          if (!playerRef.current) setError(result.error.message)
          return
        }

        setError(null)
        applyJoinSuccess(result.data)
      }
    )
  }

  function applyCommandError(nextError: GameError) {
    const activeRoom = roomRef.current
    const activePlayer = playerRef.current
    if (
      nextError.code === "not-your-turn" &&
      activeRoom?.game?.turnPlayerId !== activePlayer?.id
    ) {
      return
    }

    setError(nextError.message)
    haptic.trigger("error")
  }

  function isActiveTurnPlayer() {
    return Boolean(
      roomRef.current?.game?.turnPlayerId === playerRef.current?.id
    )
  }

  useEffect(() => {
    const activeSocket = getGameSocket()
    setSocket(activeSocket)

    function handleSnapshot(snapshot: RoomSnapshot) {
      if (snapshot.code !== normalizedRoomCode) return
      applyRoomSnapshot(snapshot)
    }

    function handlePlayerState(snapshot: PlayerGameSnapshot) {
      applyPlayerGameSnapshot(snapshot)
    }

    function handlePlayerSocial(snapshot: PlayerSocialSnapshot) {
      applyPlayerSocialSnapshot(snapshot)
    }

    function handleError(nextError: GameError) {
      applyCommandError(nextError)
    }

    function handleConnect() {
      setConnected(true)
      restoreSocketSeat(activeSocket)
    }

    function handleDisconnect() {
      joinInFlightRef.current = false
      setConnected(false)
    }

    activeSocket.on("room:snapshot", handleSnapshot)
    activeSocket.on("game:playerState", handlePlayerState)
    activeSocket.on("room:playerSocial", handlePlayerSocial)
    activeSocket.on("room:error", handleError)
    activeSocket.on("connect", handleConnect)
    activeSocket.on("disconnect", handleDisconnect)

    setConnected(activeSocket.connected)
    if (activeSocket.connected) restoreSocketSeat(activeSocket)

    return () => {
      activeSocket.off("room:snapshot", handleSnapshot)
      activeSocket.off("game:playerState", handlePlayerState)
      activeSocket.off("room:playerSocial", handlePlayerSocial)
      activeSocket.off("room:error", handleError)
      activeSocket.off("connect", handleConnect)
      activeSocket.off("disconnect", handleDisconnect)
    }
  }, [normalizedRoomCode])

  useEffect(() => {
    const messages = [
      ...(room?.chatMessages ?? []),
      ...(playerSocial?.squadChatMessages ?? []),
    ]
    if (!mentionSnapshotInitializedRef.current) {
      mentionSnapshotInitializedRef.current = true
      for (const message of messages)
        seenMentionMessageIdsRef.current.add(message.id)
      return
    }

    let mentionCount = 0
    for (const message of messages) {
      if (seenMentionMessageIdsRef.current.has(message.id)) continue
      seenMentionMessageIdsRef.current.add(message.id)
      if (
        message.playerId !== player?.id &&
        player?.id &&
        message.mentionPlayerIds.includes(player.id)
      ) {
        mentionCount += 1
      }
    }
    for (let index = 0; index < mentionCount; index += 1) {
      window.setTimeout(
        () => playFx("notify", { volume: 0.24, playbackRate: 1.12 }),
        index * 120
      )
    }
  }, [room?.chatMessages, playerSocial?.squadChatMessages, player?.id])

  useEffect(() => {
    if (!room) return
    const previousStatus = lastStatusRef.current
    lastStatusRef.current = room.status

    if (
      previousStatus !== null &&
      previousStatus !== "playing" &&
      room.status === "playing" &&
      room.game
    ) {
      if (startIntroPhase === "idle" || startIntroPhase === "done") {
        setStartIntroPhase("lights")
      }
    }

    if (!room.game) {
      lastTurnPlayerIdRef.current = null
      lastEventIdRef.current = null
      seenInitialGameSnapshotRef.current = false
      return
    }

    lastTurnPlayerIdRef.current = room.game.turnPlayerId

    const events = room.game.events

    if (!seenInitialGameSnapshotRef.current) {
      seenInitialGameSnapshotRef.current = true
      lastEventIdRef.current = events[events.length - 1]?.id ?? null
      return
    }

    if (events.length === 0) return
    const lastSeenId = lastEventIdRef.current
    const startIndex = lastSeenId
      ? events.findIndex((event) => event.id === lastSeenId) + 1
      : 0
    if (startIndex <= 0) {
      lastEventIdRef.current = events[events.length - 1].id
      return
    }
    const newEvents = events.slice(startIndex)
    if (newEvents.length === 0) return
    lastEventIdRef.current = newEvents[newEvents.length - 1].id

    for (const nextEvent of newEvents) {
      const isSelfEvent = nextEvent.playerId === player?.id
      switch (nextEvent.type) {
        case "card-played":
          if (isSelfEvent) haptic.trigger("success")
          break
        case "card-drawn":
          if (nextEvent.drawKind !== "roulette-complete") {
            playCardSound("draw", nextEvent.cards?.length ?? 1)
          }
          if (isSelfEvent && nextEvent.drawKind === "single") {
            haptic.trigger("light")
          }
          break
        case "draw-penalty":
          playCardSound("draw", Math.min(nextEvent.cards?.length ?? 1, 4))
          if (isSelfEvent) haptic.trigger("heavy")
          break
        case "hand-swapped":
        case "hands-rotated":
          playShuffleSound()
          haptic.trigger("medium")
          break
        case "uno-called":
          playFx("successBlip", { volume: 0.55 })
          if (isSelfEvent) haptic.trigger("success")
          break
        case "uno-caught":
          playFx("blocked", { volume: 0.5 })
          haptic.trigger(
            nextEvent.targetPlayerId === player?.id ? "error" : "warning"
          )
          break
        case "player-eliminated":
          playFx("blocked", { volume: 0.6 })
          if (isSelfEvent) haptic.trigger("error")
          break
        case "support-started":
          playFx("successBlip", { volume: 0.3, playbackRate: 1.08 })
          if (
            nextEvent.playerId === player?.id ||
            nextEvent.targetPlayerId === player?.id
          ) {
            haptic.trigger("light")
          }
          break
        case "support-kicked":
          playFx("blocked", { volume: 0.34 })
          if (nextEvent.targetPlayerId === player?.id) haptic.trigger("warning")
          break
        case "support-ended":
          if (nextEvent.playerId === player?.id) {
            playFx("notify", { volume: 0.22 })
          }
          break
        case "game-won": {
          const isFirstPlace =
            room.game?.winnerPlacements.some(
              (placement) =>
                placement.playerId === nextEvent.playerId &&
                placement.position === 1
            ) ?? false
          playWinnerSound(isFirstPlace)
          if (isSelfEvent) {
            haptic.trigger(isFirstPlace ? "heavy" : "success")
          }
          break
        }
        default:
          break
      }
    }
  }, [room, player?.id, startIntroPhase, haptic])

  useEffect(() => {
    let cancelled = false
    applyRoomSnapshot(null)
    applyPlayer(null)
    applyPlayerGameSnapshot(null)
    applyPlayerSocialSnapshot(null)
    seenMentionMessageIdsRef.current.clear()
    mentionSnapshotInitializedRef.current = false
    setError(null)

    async function loadPreview() {
      setLoadingPreview(true)
      try {
        const result = await getRoomPreview(normalizedRoomCode)
        if (cancelled) return

        setLoadingPreview(false)
        if (!result.ok) {
          applyRoomSnapshot(null)
          setError(result.error.message)
          return
        }

        setError(null)
        applyRoomSnapshot(result.data)
      } catch (cause) {
        if (cancelled) return
        setLoadingPreview(false)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not reach the game server."
        )
      }
    }

    void loadPreview()

    const savedName = getSavedPlayerName()
    if (savedName && getActiveRoomCode() === normalizedRoomCode) {
      void joinRoom(savedName)
    }

    return () => {
      cancelled = true
    }
  }, [roomCode])

  async function joinRoom(nextName = playerName) {
    if (joinInFlightRef.current) return

    const cleanName = nextName.trim()
    if (!cleanName) {
      setError("Enter a name to join this room.")
      return
    }

    setJoining(true)
    joinInFlightRef.current = true
    setError(null)
    savePlayerName(cleanName)

    const activeSocket = socket ?? getGameSocket()
    if (!socket) setSocket(activeSocket)
    if (!activeSocket.connected) activeSocket.connect()

    activeSocket.emit(
      "room:join",
      {
        code: roomCode,
        playerName: cleanName,
        sessionId: getPlayerSessionId(),
      },
      (result) => {
        joinInFlightRef.current = false
        setJoining(false)
        if (!result.ok) {
          setError(result.error.message)
          return
        }

        applyJoinSuccess(result.data)
      }
    )
  }

  function setReady(ready: boolean) {
    if (!socket) return
    setError(null)
    playFx(ready ? "toggleOn" : "toggleOff", { volume: 0.55 })
    socket.emit("room:setReady", { ready }, (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function startGame() {
    if (!socket) return
    setError(null)
    playFx("buttonHard", { volume: 0.6 })
    socket.emit("room:start", (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function restartGame() {
    if (!socket) return
    setError(null)
    playFx("buttonHard", { volume: 0.6 })
    socket.emit("room:restart", (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      setStartIntroPhase("lights")
      applyRoomSnapshot(result.data)
    })
  }

  function sendChatMessage(input: SendChatMessageInput) {
    if (!socket) return
    setError(null)
    socket.emit("room:sendChatMessage", input, (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function supportPlayer(supportedPlayerId: string) {
    if (!socket) return
    setError(null)
    socket.emit("game:supportPlayer", { supportedPlayerId }, (result) => {
      if (!result.ok) return applyCommandError(result.error)
      playFx("successBling", { volume: 0.48 })
      applyRoomSnapshot(result.data)
    })
  }

  function kickSupporter(supporterPlayerId: string) {
    if (!socket) return
    setError(null)
    socket.emit("game:kickSupporter", { supporterPlayerId }, (result) => {
      if (!result.ok) return applyCommandError(result.error)
      playFx("blocked", { volume: 0.42 })
      applyRoomSnapshot(result.data)
    })
  }

  function sendTableReaction(input: SendTableReactionInput) {
    if (!socket) return
    socket.emit("game:sendReaction", input, (result) => {
      if (!result.ok) return applyCommandError(result.error)
      applyRoomSnapshot(result.data)
    })
  }

  function playCards(input: PlayCardsInput) {
    if (!socket || !isActiveTurnPlayer()) return
    setError(null)
    socket.emit("game:playCards", input, (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function stageCards(input: StageCardsInput) {
    if (!socket || !isActiveTurnPlayer()) return
    socket.emit("game:stageCards", input, (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      setError(null)
      applyRoomSnapshot(result.data)
    })
  }

  function drawCard() {
    if (!socket || !isActiveTurnPlayer()) return
    setError(null)
    socket.emit("game:drawOne", (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function endTurn() {
    if (!socket || !isActiveTurnPlayer()) return
    setError(null)
    socket.emit("game:endTurn", (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function takePenalty() {
    if (!socket || !isActiveTurnPlayer()) return
    setError(null)
    socket.emit("game:takeDrawPenalty", (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function drawRouletteCard() {
    if (!socket || !isActiveTurnPlayer()) return
    setError(null)
    socket.emit("game:drawRouletteCard", (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  function catchUno(targetPlayerId: string) {
    if (!socket) return
    setError(null)
    socket.emit("game:catchUno", { targetPlayerId }, (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

      applyRoomSnapshot(result.data)
    })
  }

  async function copyInvite() {
    const inviteUrl = new URL(
      `/room/${normalizedRoomCode}`,
      window.location.origin
    )
    await copyTextToClipboard(inviteUrl.toString())
  }

  if (!player) {
    return (
      <InviteJoinScreen
        roomCode={normalizedRoomCode}
        room={room}
        playerName={playerName}
        loadingPreview={loadingPreview}
        joining={joining}
        error={error}
        onPlayerName={setPlayerName}
        onJoin={() => joinRoom()}
        onCopyInvite={copyInvite}
      />
    )
  }

  if (
    (room?.status === "playing" || room?.status === "finished") &&
    !room.game
  ) {
    return (
      <main className="grid min-h-svh place-items-center bg-neutral-950 px-6 text-white antialiased">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5 text-sm text-white/62">
          Loading game state...
        </div>
      </main>
    )
  }

  if (
    (room?.status === "playing" || room?.status === "finished") &&
    room.game
  ) {
    const showIntro = startIntroPhase !== "idle" && startIntroPhase !== "done"
    return (
      <>
        <GameTable
          room={room}
          player={player}
          playerGame={playerGame?.playerId === player.id ? playerGame : null}
          playerSocial={playerSocial}
          connected={connected}
          error={error}
          onCopyInvite={copyInvite}
          onPlayCards={playCards}
          onStageCards={stageCards}
          onDrawCard={drawCard}
          onEndTurn={endTurn}
          onTakePenalty={takePenalty}
          onDrawRouletteCard={drawRouletteCard}
          onCatchUno={catchUno}
          onSupportPlayer={supportPlayer}
          onKickSupporter={kickSupporter}
          onSendReaction={sendTableReaction}
          onSendChatMessage={sendChatMessage}
          onRestartGame={restartGame}
          voice={voice}
          socket={socket}
        />
        {showIntro && (
          <GameStartIntro
            room={room}
            selfPlayerId={player.id}
            phase={startIntroPhase}
            onPhaseChange={setStartIntroPhase}
            onFinish={() => setStartIntroPhase("done")}
          />
        )}
      </>
    )
  }

  return (
    <LobbyWaitingRoom
      room={room}
      player={player}
      roomCode={normalizedRoomCode}
      connected={connected}
      error={error}
      isHost={isHost}
      currentPlayerReady={Boolean(currentPlayer?.ready)}
      onReady={setReady}
      onStart={startGame}
      onCopyInvite={copyInvite}
      onSendChatMessage={sendChatMessage}
      voice={voice}
    />
  )
}

function GameTable({
  room,
  player,
  playerGame,
  playerSocial,
  connected,
  error,
  onCopyInvite,
  onPlayCards,
  onStageCards,
  onDrawCard,
  onEndTurn,
  onTakePenalty,
  onDrawRouletteCard,
  onCatchUno,
  onSupportPlayer,
  onKickSupporter,
  onSendReaction,
  onSendChatMessage,
  onRestartGame,
  voice,
  socket,
}: {
  room: RoomSnapshot
  player: Player
  playerGame: PlayerGameSnapshot | null
  playerSocial: PlayerSocialSnapshot | null
  connected: boolean
  error: string | null
  onCopyInvite: () => Promise<void>
  onPlayCards: (input: PlayCardsInput) => void
  onStageCards: (input: StageCardsInput) => void
  onDrawCard: () => void
  onEndTurn: () => void
  onTakePenalty: () => void
  onDrawRouletteCard: () => void
  onCatchUno: (targetPlayerId: string) => void
  onSupportPlayer: (supportedPlayerId: string) => void
  onKickSupporter: (supporterPlayerId: string) => void
  onSendReaction: (input: SendTableReactionInput) => void
  onSendChatMessage: (input: SendChatMessageInput) => void
  onRestartGame: () => void
  voice: RoomVoiceController
  socket: GameSocket | null
}) {
  const game = room.game
  const tableDropRef = useRef<HTMLDivElement | null>(null)

  const selfState = game?.players.find((p) => p.playerId === player.id)
  const isSelfEliminated = Boolean(
    selfState?.eliminated || selfState?.winnerPlacement
  )
  const supportLink = game?.supportLinks.find(
    (link) => link.supporterPlayerId === player.id
  )
  const spectatingPlayerId = supportLink?.supportedPlayerId ?? null
  const [supportView, setSupportView] = useState<PlayerGameSnapshot | null>(
    null
  )
  const supportViewRequestRef = useRef(0)
  const [pendingSupportPlayerId, setPendingSupportPlayerId] = useState<
    string | null
  >(null)

  const [selectedCardIds, setSelectedCardIds] = useState<Array<string>>([])
  const [pendingPlayedCardIds, setPendingPlayedCardIds] = useState<
    Array<string>
  >([])
  const [declaredUno, setDeclaredUno] = useState(false)
  const [chosenColor, setChosenColor] = useState<PlayColor | null>(null)
  const [wantsSwap, setWantsSwap] = useState(false)
  const [wantsRotate, setWantsRotate] = useState(false)
  const [swapWithPlayerId, setSwapWithPlayerId] = useState<string>("")
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [tableDragActive, setTableDragActive] = useState(false)
  const [celebratingWinnerId, setCelebratingWinnerId] = useState<string | null>(
    null
  )
  const celebratedWinnerIdsRef = useRef(new Set<string>())
  const acknowledgedWinnerIdsRef = useRef<Set<string> | null>(null)
  const lastHypeCelebrationRef = useRef(game?.hypeMeter.celebrationCount ?? 0)
  const [rouletteFly, setRouletteFly] = useState<{
    sessionId: string
    cards: Array<Card>
    targetPlayerId: string
  } | null>(null)
  const [rouletteConsumedKey, setRouletteConsumedKey] = useState<string | null>(
    null
  )
  const [deckDrawFlights, setDeckDrawFlights] = useState<
    Array<DeckDrawFlightState>
  >([])
  const rouletteAcceptedKeyRef = useRef<string | null>(null)
  const drawAnimationInitializedRef = useRef(false)
  const drawAnimationLastEventIdRef = useRef<string | null>(null)
  const prevRouletteActiveRef = useRef<{
    playerId: string
    cardCount: number
  } | null>(null)
  const phoneViewport = useMediaQuery("(max-width: 520px)")
  const narrowViewport = useMediaQuery("(max-width: 680px)")
  const shortViewport = useMediaQuery("(max-height: 760px)")
  const compactSurface = narrowViewport || shortViewport
  const haptic = useWebHaptics()
  const tableCardSize: ResponsiveCardSize = compactSurface ? "sm" : "md"
  const handCardSize: ResponsiveCardSize = compactSurface ? "sm" : "md"

  const selectedCards = useMemo(
    () => cardsInIdOrder(playerGame?.hand ?? [], selectedCardIds),
    [playerGame?.hand, selectedCardIds]
  )
  const pendingPlayedCards = useMemo(
    () => cardsInIdOrder(playerGame?.hand ?? [], pendingPlayedCardIds),
    [playerGame?.hand, pendingPlayedCardIds]
  )
  const playableCardIds = playerGame?.playableCardIds ?? []
  const activeOpponents =
    room.players.filter((candidate) => {
      const state = game?.players.find(
        (gamePlayer) => gamePlayer.playerId === candidate.id
      )
      return (
        candidate.id !== player.id &&
        !state?.eliminated &&
        !state?.winnerPlacement
      )
    }) ?? []
  const supportCandidates = availableSupportCandidates(
    game?.players ?? [],
    playerSocial?.blockedSupportedPlayerIds ?? [],
    player.id
  )
    .map((candidate) =>
      room.players.find((roomPlayer) => roomPlayer.id === candidate.playerId)
    )
    .filter((candidate): candidate is Player => Boolean(candidate))
  const pendingSupportPlayer = room.players.find(
    (candidate) => candidate.id === pendingSupportPlayerId
  )
  const selfSupporters =
    game?.supportLinks
      .filter((link) => link.supportedPlayerId === player.id)
      .map((link) =>
        room.players.find(
          (candidate) => candidate.id === link.supporterPlayerId
        )
      )
      .filter((candidate): candidate is Player => Boolean(candidate)) ?? []
  const isMyTurn = game?.turnPlayerId === player.id
  const firstWinnerPlacement =
    game?.winnerPlacements.find((placement) => placement.position === 1) ?? null
  const firstWinner = room.players.find(
    (candidate) => candidate.id === firstWinnerPlacement?.playerId
  )
  const celebratingWinner = room.players.find(
    (candidate) => candidate.id === celebratingWinnerId
  )
  const gameFinished = Boolean(game && game.turnPlayerId === null)
  const canRestartGame = gameFinished
  const gameStartEventId =
    game?.events.find((event) => event.type === "game-started")?.id ?? null
  const drawStack = game?.drawStack ?? null
  const rouletteChoice =
    game?.pendingChoice?.type === "roulette-draw" ? game.pendingChoice : null
  const rouletteTargetName = rouletteChoice
    ? playerName(room, rouletteChoice.playerId)
    : null
  const canDrawRoulette = Boolean(rouletteChoice?.playerId === player.id)
  const needsColor = selectedCards.some((card) => card.color === "wild")
  const remainingAfterSelectedCards =
    (playerGame?.hand.length ?? 0) - selectedCards.length
  const canChooseSwap =
    selectedCards.length > 0 &&
    selectedCards.length === 1 &&
    selectedCards[0]?.face.kind === "number" &&
    selectedCards[0].face.value === 7 &&
    remainingAfterSelectedCards > 0 &&
    activeOpponents.length > 0
  const canChooseRotate =
    selectedCards.length === 1 &&
    selectedCards[0]?.face.kind === "number" &&
    selectedCards[0].face.value === 0 &&
    remainingAfterSelectedCards > 0
  const discardActionCard =
    selectedCards[0]?.face.kind === "discard-color" ? selectedCards[0] : null
  const discardExtraCards = discardActionCard ? selectedCards.slice(1) : []
  const needsSwap = canChooseSwap && wantsSwap
  const selectedCardsCanPlay = canPlayStagedCards(
    selectedCards,
    playableCardIds,
    drawStack
  )
  const remainingAfterPlay =
    (playerGame?.hand.length ?? 0) - selectedCards.length
  const finishesWithForbiddenPower =
    remainingAfterPlay === 0 &&
    selectedCards.some((card) => isForbiddenFinalCard(card))
  const canDeclareUno =
    Boolean(isMyTurn) &&
    selectedCards.length > 0 &&
    selectedCardsCanPlay &&
    remainingAfterPlay === 1
  const canSubmitPlay =
    Boolean(isMyTurn) &&
    pendingPlayedCardIds.length === 0 &&
    selectedCardsCanPlay &&
    !finishesWithForbiddenPower &&
    (!needsColor || Boolean(chosenColor)) &&
    (!needsSwap || Boolean(swapWithPlayerId))
  const canPassTurn =
    Boolean(isMyTurn) &&
    pendingPlayedCardIds.length === 0 &&
    Boolean(playerGame?.canEndTurn) &&
    selectedCardIds.length === 0
  const canUseEndTurnButton =
    selectedCardIds.length > 0 ? canSubmitPlay : canPassTurn
  const localStagedCards =
    pendingPlayedCards.length > 0 ? pendingPlayedCards : selectedCards
  const localStagedPlayActive = Boolean(isMyTurn && localStagedCards.length > 0)
  const stagedPlayKey = game?.stagedPlay
    ? `${game.stagedPlay.playerId}:${game.stagedPlay.cards.map((card) => card.id).join("-")}`
    : null
  const stagedPlayConsumed = Boolean(
    stagedPlayKey && rouletteConsumedKey === stagedPlayKey
  )
  const tableStagedCards = localStagedPlayActive
    ? localStagedCards
    : stagedPlayConsumed
      ? []
      : (game?.stagedPlay?.cards ?? [])
  const tableStagedPlayerId = localStagedPlayActive
    ? player.id
    : stagedPlayConsumed
      ? null
      : (game?.stagedPlay?.playerId ?? null)
  const tableStagedPlayerName = tableStagedPlayerId
    ? playerName(room, tableStagedPlayerId)
    : null
  const tableStagedMode =
    !stagedPlayConsumed &&
    ((game?.stagedPlay?.kind === "roulette" && !localStagedPlayActive) ||
      (rouletteChoice && tableStagedPlayerId === rouletteChoice.playerId))
      ? "roulette"
      : "stage"
  const canEditTableStaged =
    tableStagedMode === "stage" &&
    tableStagedPlayerId === player.id &&
    Boolean(isMyTurn) &&
    pendingPlayedCardIds.length === 0
  const visibleError = error ?? voice.error
  const visibleSupportView =
    supportView?.playerId === spectatingPlayerId ? supportView : null

  useEffect(() => {
    const celebrationCount = game?.hypeMeter.celebrationCount ?? 0
    if (celebrationCount > lastHypeCelebrationRef.current) {
      playFx("successBlip", { volume: 0.34, playbackRate: 1.08 })
      void confetti({
        particleCount: 70,
        spread: 88,
        startVelocity: 34,
        origin: { y: 0.64 },
        colors: ["#f472b6", "#fbbf24", "#ffffff"],
      })
    }
    lastHypeCelebrationRef.current = celebrationCount
  }, [game?.hypeMeter.celebrationCount])

  useEffect(() => {
    const requestId = ++supportViewRequestRef.current
    if (!isSelfEliminated) {
      setSupportView(null)
      setPendingSupportPlayerId(null)
      return
    }

    if (!spectatingPlayerId || !socket) {
      setSupportView(null)
      return
    }

    const targetState = game?.players.find(
      (p) => p.playerId === spectatingPlayerId
    )
    if (!targetState || targetState.eliminated || targetState.winnerPlacement) {
      setSupportView(null)
      return
    }

    socket.emit("game:getSupportView", (result) => {
      if (
        supportViewRequestRef.current === requestId &&
        result.ok &&
        result.data?.playerId === spectatingPlayerId
      ) {
        setSupportView(result.data)
      } else if (supportViewRequestRef.current === requestId) {
        setSupportView(null)
      }
    })

    return () => {
      if (supportViewRequestRef.current === requestId) {
        supportViewRequestRef.current += 1
      }
    }
  }, [
    spectatingPlayerId,
    room.version,
    socket,
    isSelfEliminated,
    game?.players,
  ])

  useEffect(() => {
    const hand = playerGame?.hand ?? []
    setSelectedCardIds((current) =>
      current.filter((cardId) => hand.some((card) => card.id === cardId))
    )
    setPendingPlayedCardIds((current) =>
      current.filter((cardId) => hand.some((card) => card.id === cardId))
    )
  }, [playerGame?.hand])

  useEffect(() => {
    if (!isMyTurn) {
      setSelectedCardIds([])
      setPendingPlayedCardIds([])
    }
  }, [isMyTurn])

  useEffect(() => {
    if (error) setPendingPlayedCardIds([])
  }, [error])

  useEffect(() => {
    setChosenColor(null)
    setSwapWithPlayerId("")
    setWantsSwap(false)
    setWantsRotate(false)
    setDeclaredUno(false)
  }, [selectedCardIds.join(":")])

  useEffect(() => {
    if (!canDeclareUno && declaredUno) setDeclaredUno(false)
  }, [canDeclareUno, declaredUno])

  useEffect(() => {
    celebratedWinnerIdsRef.current.clear()
    acknowledgedWinnerIdsRef.current = null
    setCelebratingWinnerId(null)
  }, [gameStartEventId])

  useEffect(() => {
    if (!isMyTurn) return
    onStageCards({
      cardIds: selectedCardIds,
      chosenColor: chosenColor ?? undefined,
      declaredUno: declaredUno || undefined,
      rotateHands: wantsRotate || undefined,
      swapWithPlayerId: wantsSwap ? swapWithPlayerId || undefined : undefined,
    })
  }, [
    selectedCardIds.join(":"),
    chosenColor,
    declaredUno,
    wantsRotate,
    wantsSwap,
    swapWithPlayerId,
    isMyTurn,
  ])

  useEffect(() => {
    const stagedPlay = game?.stagedPlay
    const pendingChoice = game?.pendingChoice
    const previousActive = prevRouletteActiveRef.current

    if (pendingChoice?.type === "roulette-draw") {
      prevRouletteActiveRef.current = {
        playerId: pendingChoice.playerId,
        cardCount: pendingChoice.drawnCards.length,
      }
      return
    }

    prevRouletteActiveRef.current = null

    if (!previousActive) return
    if (!stagedPlay || stagedPlay.kind !== "roulette") return
    if (stagedPlay.playerId !== previousActive.playerId) return
    if (stagedPlay.cards.length === 0) return

    const acceptedKey = `${stagedPlay.playerId}:${stagedPlay.cards
      .map((card) => card.id)
      .join("-")}`
    if (rouletteAcceptedKeyRef.current === acceptedKey) return
    rouletteAcceptedKeyRef.current = acceptedKey
    setRouletteConsumedKey(null)

    setRouletteFly({
      sessionId: acceptedKey,
      cards: stagedPlay.cards,
      targetPlayerId: stagedPlay.playerId,
    })
  }, [
    game?.pendingChoice,
    game?.stagedPlay?.kind,
    game?.stagedPlay?.playerId,
    game?.stagedPlay?.cards,
  ])

  useEffect(() => {
    if (!game) return
    const events = game.events
    const lastEventId = events[events.length - 1]?.id ?? null

    if (!drawAnimationInitializedRef.current) {
      drawAnimationInitializedRef.current = true
      drawAnimationLastEventIdRef.current = lastEventId
      return
    }

    if (!lastEventId) return

    const lastSeenId = drawAnimationLastEventIdRef.current
    const startIndex = lastSeenId
      ? events.findIndex((event) => event.id === lastSeenId) + 1
      : 0

    if (startIndex <= 0) {
      drawAnimationLastEventIdRef.current = lastEventId
      return
    }

    const newFlights = events
      .slice(startIndex)
      .map(deckDrawFlightFromEvent)
      .filter((flight): flight is DeckDrawFlightState => Boolean(flight))

    drawAnimationLastEventIdRef.current = lastEventId
    if (newFlights.length === 0) return

    setDeckDrawFlights((current) => [...current, ...newFlights].slice(-6))
  }, [game?.events])

  useEffect(() => {
    if (!game) return
    if (acknowledgedWinnerIdsRef.current !== null) return
    const initial = new Set<string>()
    for (const placement of game.winnerPlacements) {
      initial.add(placement.playerId)
    }
    acknowledgedWinnerIdsRef.current = initial
  }, [game])

  useEffect(() => {
    if (!firstWinnerPlacement) return
    if (acknowledgedWinnerIdsRef.current?.has(firstWinnerPlacement.playerId))
      return
    if (celebratedWinnerIdsRef.current.has(firstWinnerPlacement.playerId))
      return

    celebratedWinnerIdsRef.current.add(firstWinnerPlacement.playerId)
    setCelebratingWinnerId(firstWinnerPlacement.playerId)

    const timeoutId = window.setTimeout(() => {
      setCelebratingWinnerId(null)
    }, 3600)

    return () => window.clearTimeout(timeoutId)
  }, [firstWinnerPlacement?.playerId])

  function canStageCard(card: Card) {
    return canStageCardWithSelection(
      card,
      selectedCards,
      playableCardIds,
      Boolean(isMyTurn),
      drawStack
    )
  }

  function toggleSelected(card: Card) {
    const current = selectedCardIds
    if (current.includes(card.id)) {
      haptic.trigger("selection")
      const currentCards = cardsInIdOrder(playerGame?.hand ?? [], current)
      const removingFirstDiscard =
        current[0] === card.id &&
        currentCards[0]?.face.kind === "discard-color" &&
        current.length > 1
      setSelectedCardIds(
        removingFirstDiscard
          ? []
          : current.filter((cardId) => cardId !== card.id)
      )
      return
    }

    if (canStageCard(card)) {
      haptic.trigger("selection")
      setSelectedCardIds([...current, card.id])
      return
    }
    haptic.trigger("error")
  }

  function stageCard(card: Card) {
    if (!canStageCard(card)) return
    setSelectedCardIds((current) =>
      current.includes(card.id) ? current : [...current, card.id]
    )
  }

  function updatePointerDragTarget(clientX: number, clientY: number) {
    const rect = tableDropRef.current?.getBoundingClientRect()
    if (!rect) return

    setTableDragActive(
      clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
    )
  }

  function finishPointerDrag(cardId: string, clientX: number, clientY: number) {
    const rect = tableDropRef.current?.getBoundingClientRect()
    const droppedOnTable = rect
      ? clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      : false

    if (droppedOnTable) {
      const card = playerGame?.hand.find((candidate) => candidate.id === cardId)
      if (card) stageCard(card)
    }

    setDraggingCardId(null)
    setTableDragActive(false)
  }

  function submitPlay() {
    if (!canSubmitPlay) return
    const playedCardIds = discardActionCard
      ? [discardActionCard.id]
      : selectedCardIds
    const discardExtraCardIds = discardExtraCards.map((card) => card.id)
    setPendingPlayedCardIds(selectedCardIds)
    onPlayCards({
      cardIds: playedCardIds,
      declaredUno: canDeclareUno && declaredUno,
      chosenColor: chosenColor ?? undefined,
      discardCardIds: discardExtraCardIds.length
        ? discardExtraCardIds
        : undefined,
      topCardId: discardActionCard
        ? (selectedCards[selectedCards.length - 1]?.id ?? discardActionCard.id)
        : undefined,
      swapWithPlayerId: needsSwap ? swapWithPlayerId : undefined,
      rotateHands: canChooseRotate && wantsRotate ? true : undefined,
    })
  }

  function handleEndTurnButton() {
    if (selectedCardIds.length > 0) {
      playFx("successBling", { volume: 0.55 })
      haptic.trigger("medium")
      submitPlay()
      return
    }
    if (canPassTurn) {
      playFx("successBling", { volume: 0.5 })
      haptic.trigger("light")
      onEndTurn()
    }
  }

  function handleDrawCard() {
    haptic.trigger("light")
    onDrawCard()
  }

  function handleTakePenalty() {
    haptic.trigger("medium")
    onTakePenalty()
  }

  function handleDrawRouletteCard() {
    haptic.trigger("light")
    onDrawRouletteCard()
  }

  function handleCatchUno(targetPlayerId: string) {
    haptic.trigger("warning")
    onCatchUno(targetPlayerId)
  }

  const tableStatusTitle =
    gameFinished && firstWinner
      ? `${firstWinner.name} won this match`
      : isMyTurn
        ? "Your turn"
        : `${playerName(room, game?.turnPlayerId)} is playing`
  const tableStatusDetail = gameFinished
    ? "Start a new match with the same room and players."
    : game?.drawStack
      ? `Draw stack is +${game.drawStack.amount}. Stack +${game.drawStack.minimum} or higher.`
      : `${game?.discardPileCount ?? 0} cards discarded`

  if (narrowViewport) {
    return (
      <>
        <main className="h-dvh overflow-hidden bg-[#070604] text-white antialiased">
          <VoiceAudioOutputs
            streamsByPlayerId={voice.remoteStreamsByPlayerId}
          />
          {celebratingWinner && (
            <FirstPlaceCelebration playerName={celebratingWinner.name} />
          )}
          {rouletteFly && (
            <RouletteFlyToHand
              key={rouletteFly.sessionId}
              cards={rouletteFly.cards}
              targetPlayerId={rouletteFly.targetPlayerId}
              isSelfTarget={rouletteFly.targetPlayerId === player.id}
              startDelayMs={520}
              onFlightStart={() =>
                setRouletteConsumedKey(rouletteFly.sessionId)
              }
              onDone={() => {
                setRouletteConsumedKey(rouletteFly.sessionId)
                setRouletteFly(null)
              }}
            />
          )}
          {deckDrawFlights.map((flight) => (
            <DeckDrawFlight
              key={flight.id}
              targetPlayerId={flight.targetPlayerId}
              cardCount={flight.cardCount}
              onDone={() =>
                setDeckDrawFlights((current) =>
                  current.filter((candidate) => candidate.id !== flight.id)
                )
              }
            />
          ))}

          <div
            className={
              "mx-auto flex h-full min-h-0 w-full max-w-[680px] flex-col px-2 " +
              (phoneViewport ? "gap-1.5 py-1.5" : "gap-2 py-2")
            }
          >
            <header
              className={
                "flex shrink-0 items-center justify-between gap-2 border border-white/10 bg-white/[0.035] px-3 shadow-[0_14px_42px_rgba(0,0,0,0.28)] " +
                (phoneViewport
                  ? "rounded-[1.15rem] py-1.5"
                  : "rounded-2xl py-2")
              }
            >
              <div className="min-w-0">
                <p className="text-[9px] font-medium tracking-[0.18em] text-white/42 uppercase">
                  UNO No Mercy
                </p>
                <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                  Room {room.code}
                </h1>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <VoiceToggleButton voice={voice} compact />
                <SoundToggle compact />
                <StatusDot connected={connected} compact />
                <CopyInviteButton iconOnly onCopy={onCopyInvite} />
                <MobileChatSheet
                  messages={room.chatMessages}
                  squadMessages={playerSocial?.squadChatMessages}
                  squadPlayerId={playerSocial?.squadPlayerId}
                  players={room.players}
                  squadMemberIds={squadMemberIdsFor(
                    room,
                    playerSocial?.squadPlayerId
                  )}
                  selfPlayerId={player.id}
                  error={error}
                  onSendMessage={onSendChatMessage}
                />
              </div>
            </header>

            <div
              ref={tableDropRef}
              className="flex min-h-0 flex-1 flex-col gap-1.5"
            >
              <section
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 18%, rgba(0,0,0,0.18) 62%), repeating-linear-gradient(92deg, rgba(255,255,255,0.035) 0 10px, rgba(0,0,0,0.05) 10px 22px), linear-gradient(90deg, #5a341d, #7a4829 38%, #4b2917)",
                }}
                className={
                  "relative isolate min-h-0 flex-1 overflow-hidden border shadow-[0_26px_70px_rgba(0,0,0,0.46)] transition-[border-color,box-shadow] " +
                  (phoneViewport
                    ? "rounded-[1.15rem] p-1.5"
                    : "rounded-[1.35rem] p-2") +
                  " " +
                  (tableDragActive
                    ? "border-white/35 shadow-[0_26px_70px_rgba(0,0,0,0.46),inset_0_0_0_2px_rgba(255,255,255,0.16)]"
                    : draggingCardId
                      ? "border-white/22"
                      : "border-white/12")
                }
              >
                <div className="pointer-events-none absolute inset-0 rounded-[1.35rem] bg-black/[0.08] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.32),inset_0_0_0_2px_rgba(255,255,255,0.045),inset_0_24px_80px_rgba(0,0,0,0.32)]" />

                <MobileSeatingRing
                  room={room}
                  game={game}
                  selfPlayerId={player.id}
                  voiceStates={voice.voiceStates}
                  canTakeDrawPenalty={Boolean(playerGame?.canTakeDrawPenalty)}
                  onTakeDrawPenalty={handleTakePenalty}
                  spectatingPlayerId={spectatingPlayerId}
                  supportCandidatePlayerIds={supportCandidates.map(
                    (candidate) => candidate.id
                  )}
                  onSpectatePlayer={setPendingSupportPlayerId}
                />

                <div className="relative z-10 flex h-full min-h-0 flex-col">
                  <div className="flex shrink-0 items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">
                      {tableStatusTitle}
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      <DirectionPill direction={game?.direction ?? 1} compact />
                      <ColorPill color={game?.currentColor ?? "red"} />
                      {canRestartGame && (
                        <Button
                          type="button"
                          size="xs"
                          onClick={onRestartGame}
                          className="h-7 rounded-full bg-white px-2 text-[11px] font-semibold text-neutral-950 hover:bg-white/85"
                        >
                          <Play className="mr-1 size-3" strokeWidth={2.2} />
                          New
                        </Button>
                      )}
                    </div>
                  </div>

                  {(drawStack || (rouletteChoice && !canDrawRoulette)) && (
                    <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1.5">
                      {drawStack && (
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/48 px-2.5 py-1 text-[11px] text-white/68 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-md">
                          <span className="font-semibold text-red-100">
                            Draw +{drawStack.amount}
                          </span>
                          <span className="text-white/42">
                            stack +{drawStack.minimum}+
                          </span>
                          {playerGame?.canTakeDrawPenalty && (
                            <Button
                              type="button"
                              size="xs"
                              onClick={handleTakePenalty}
                              className="h-6 rounded-full bg-white px-2 text-[11px] text-neutral-950 hover:bg-white/85"
                            >
                              Take
                            </Button>
                          )}
                        </div>
                      )}
                      {rouletteChoice && !canDrawRoulette && (
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-300/12 px-2.5 py-1 text-[11px] text-amber-50 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-md">
                          <span className="truncate">
                            {rouletteTargetName} draws until{" "}
                            {rouletteChoice.color}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex min-h-0 flex-1 items-center justify-center py-2">
                    <div className="flex w-full max-w-[336px] flex-col items-center justify-center">
                      <div
                        className={
                          "flex items-start justify-center " +
                          (phoneViewport ? "gap-3" : "gap-4")
                        }
                      >
                        <DeckStack
                          canDraw={Boolean(playerGame?.canDraw)}
                          alreadyDrawn={Boolean(playerGame?.canEndTurn)}
                          drawPileCount={game?.drawPileCount ?? 0}
                          size="sm"
                          dense={phoneViewport}
                          onDraw={handleDrawCard}
                          rouletteMode={canDrawRoulette}
                          rouletteColor={rouletteChoice?.color ?? null}
                          onDrawRoulette={handleDrawRouletteCard}
                        />
                        <DiscardStack
                          card={game?.topDiscard ?? null}
                          size="sm"
                          dense={phoneViewport}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <TableStagedPlay
                cards={tableStagedCards}
                playerName={tableStagedPlayerName}
                mode={tableStagedMode}
                dense
                surface="tray"
                targetColor={
                  rouletteChoice?.color ??
                  (game?.stagedPlay?.kind === "roulette"
                    ? game.currentColor
                    : null)
                }
                canEdit={canEditTableStaged}
                onCardClick={toggleSelected}
              />
            </div>

            {(visibleError ||
              Boolean(playerGame?.catchablePlayerIds.length)) && (
              <div className="shrink-0 space-y-1">
                {visibleError && (
                  <p className="rounded-xl border border-red-400/20 bg-red-500/12 px-3 py-2 text-xs text-red-100 shadow-[0_14px_34px_rgba(0,0,0,0.26)] backdrop-blur-md">
                    {visibleError}
                  </p>
                )}
                {playerGame?.catchablePlayerIds.length ? (
                  <div className="flex gap-2 overflow-x-auto rounded-xl border border-yellow-300/20 bg-yellow-300/10 p-2 backdrop-blur-md">
                    {playerGame.catchablePlayerIds.map((targetPlayerId) => (
                      <Button
                        key={targetPlayerId}
                        type="button"
                        size="xs"
                        onClick={() => handleCatchUno(targetPlayerId)}
                        className="shrink-0 bg-yellow-100 text-yellow-950 hover:bg-yellow-50"
                      >
                        Catch {playerName(room, targetPlayerId)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            <section
              data-self-hand="true"
              className="flex h-[clamp(174px,30dvh,230px)] shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-2 shadow-[0_18px_54px_rgba(0,0,0,0.28)]"
            >
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/84">
                    {isSelfEliminated
                      ? spectatingPlayerId
                        ? `${playerName(room, spectatingPlayerId)}'s hand`
                        : "Your hand"
                      : "Your hand"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-white/42">
                    {isSelfEliminated
                      ? spectatingPlayerId
                        ? "🙌 Supporting"
                        : "Choose an active player to support."
                      : "Tap a card to stage it."}
                  </p>
                </div>
                {!isSelfEliminated && (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {needsColor && (
                      <ColorPicker
                        value={chosenColor}
                        required={!chosenColor}
                        onChange={setChosenColor}
                      />
                    )}
                    {canChooseRotate && (
                      <GameOptionCheckbox
                        checked={wantsRotate}
                        onCheckedChange={setWantsRotate}
                      >
                        Cycle
                      </GameOptionCheckbox>
                    )}
                    {canChooseSwap && (
                      <GameOptionCheckbox
                        checked={wantsSwap}
                        onCheckedChange={(checked) => {
                          setWantsSwap(checked)
                          if (!checked) setSwapWithPlayerId("")
                        }}
                      >
                        Swap
                      </GameOptionCheckbox>
                    )}
                    <GameOptionCheckbox
                      checked={declaredUno && canDeclareUno}
                      disabled={!canDeclareUno}
                      onCheckedChange={setDeclaredUno}
                    >
                      UNO
                    </GameOptionCheckbox>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!canUseEndTurnButton}
                      onClick={handleEndTurnButton}
                      className="h-8 bg-white px-3 text-neutral-950 hover:bg-white/85"
                    >
                      {canPassTurn ? "Pass" : "End"}
                    </Button>
                  </div>
                )}
              </div>

              <SupportControls
                candidates={
                  isSelfEliminated && !spectatingPlayerId
                    ? supportCandidates
                    : []
                }
                supporters={selfSupporters}
                onChoose={setPendingSupportPlayerId}
                onKick={onKickSupporter}
                compact
              />

              {isSelfEliminated &&
                game?.stagedPlay?.playerId === spectatingPlayerId && (
                  <SupportDecisionPills
                    stagedPlay={game.stagedPlay}
                    room={room}
                  />
                )}

              <TableEnergyBar game={game} onReact={onSendReaction} compact />

              {gameFinished && game?.supportRecap && (
                <SupportRecapPanel
                  recap={game.supportRecap}
                  game={game}
                  players={room.players}
                  compact
                />
              )}

              {!isSelfEliminated && needsSwap && (
                <select
                  value={swapWithPlayerId}
                  onChange={(event) => setSwapWithPlayerId(event.target.value)}
                  className="mt-2 h-8 rounded-lg border border-white/10 bg-neutral-950 px-2 text-sm text-white outline-none"
                >
                  <option value="">Swap with...</option>
                  {activeOpponents.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              )}

              <FannedGameHand
                cards={
                  isSelfEliminated
                    ? (visibleSupportView?.hand ?? [])
                    : (playerGame?.hand ?? [])
                }
                playableCardIds={
                  isSelfEliminated
                    ? (visibleSupportView?.playableCardIds ?? [])
                    : (playerGame?.playableCardIds ?? [])
                }
                selectedCardIds={
                  isSelfEliminated
                    ? game?.stagedPlay?.playerId === spectatingPlayerId
                      ? game.stagedPlay.cards.map((card) => card.id)
                      : []
                    : selectedCardIds
                }
                hiddenCardIds={isSelfEliminated ? [] : pendingPlayedCardIds}
                isMyTurn={isSelfEliminated ? false : Boolean(isMyTurn)}
                drawStack={isSelfEliminated ? null : drawStack}
                onToggleCard={isSelfEliminated ? () => {} : toggleSelected}
                onDragStart={isSelfEliminated ? () => {} : setDraggingCardId}
                onDragMove={
                  isSelfEliminated ? () => {} : updatePointerDragTarget
                }
                onDragEnd={isSelfEliminated ? () => {} : finishPointerDrag}
                onCancelDrag={() => {
                  setDraggingCardId(null)
                  setTableDragActive(false)
                }}
                cardSize="sm"
              />
            </section>
          </div>
        </main>
        {pendingSupportPlayer && (
          <SupportConfirmDialog
            playerName={pendingSupportPlayer.name}
            onCancel={() => setPendingSupportPlayerId(null)}
            onConfirm={() => {
              onSupportPlayer(pendingSupportPlayer.id)
              setPendingSupportPlayerId(null)
            }}
          />
        )}
      </>
    )
  }

  return (
    <>
      <main className="h-dvh overflow-hidden bg-[#070604] text-white antialiased">
        <VoiceAudioOutputs streamsByPlayerId={voice.remoteStreamsByPlayerId} />
        {celebratingWinner && (
          <FirstPlaceCelebration playerName={celebratingWinner.name} />
        )}
        {rouletteFly && (
          <RouletteFlyToHand
            key={rouletteFly.sessionId}
            cards={rouletteFly.cards}
            targetPlayerId={rouletteFly.targetPlayerId}
            isSelfTarget={rouletteFly.targetPlayerId === player.id}
            startDelayMs={520}
            onFlightStart={() => setRouletteConsumedKey(rouletteFly.sessionId)}
            onDone={() => {
              setRouletteConsumedKey(rouletteFly.sessionId)
              setRouletteFly(null)
            }}
          />
        )}
        {deckDrawFlights.map((flight) => (
          <DeckDrawFlight
            key={flight.id}
            targetPlayerId={flight.targetPlayerId}
            cardCount={flight.cardCount}
            onDone={() =>
              setDeckDrawFlights((current) =>
                current.filter((candidate) => candidate.id !== flight.id)
              )
            }
          />
        ))}
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col gap-2 px-2 py-2 sm:gap-3 sm:px-4 sm:py-3 lg:px-8">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-2 sm:pb-3">
            <div>
              <p className="text-[10px] font-medium tracking-[0.18em] text-white/45 uppercase sm:text-xs">
                UNO No Mercy
              </p>
              <h1 className="mt-0.5 text-lg font-semibold tracking-tight sm:mt-1 sm:text-xl">
                Room {room.code}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <VoiceToggleButton voice={voice} />
              <SoundToggle />
              <StatusDot connected={connected} />
              <CopyInviteButton onCopy={onCopyInvite} />
            </div>
          </header>

          <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-2 overflow-hidden lg:grid-rows-[minmax(0,1fr)_220px] xl:grid-cols-[minmax(0,1fr)_310px] xl:grid-rows-none">
            <div className="relative grid min-h-0 grid-rows-[minmax(0,1fr)_clamp(188px,30dvh,300px)] gap-2 overflow-hidden sm:grid-rows-[minmax(0,1fr)_clamp(220px,30dvh,330px)] lg:gap-3">
              <div
                ref={tableDropRef}
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 18%, rgba(0,0,0,0.18) 62%), repeating-linear-gradient(92deg, rgba(255,255,255,0.035) 0 10px, rgba(0,0,0,0.05) 10px 22px), linear-gradient(90deg, #5a341d, #7a4829 38%, #4b2917)",
                }}
                className={
                  "relative isolate min-h-0 overflow-visible rounded-2xl border p-2 shadow-[0_30px_90px_rgba(0,0,0,0.5)] transition-[border-color,box-shadow] sm:rounded-[1.75rem] sm:p-4 " +
                  (tableDragActive
                    ? "border-white/35 shadow-[0_30px_90px_rgba(0,0,0,0.5),inset_0_0_0_2px_rgba(255,255,255,0.16)]"
                    : draggingCardId
                      ? "border-white/22"
                      : "border-white/12")
                }
              >
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-black/[0.08] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.32),inset_0_0_0_2px_rgba(255,255,255,0.045),inset_0_24px_80px_rgba(0,0,0,0.32)] sm:rounded-[1.75rem]" />
                <TableSeatRing
                  room={room}
                  game={game}
                  selfPlayerId={player.id}
                  canTakeDrawPenalty={Boolean(playerGame?.canTakeDrawPenalty)}
                  onTakeDrawPenalty={handleTakePenalty}
                  compact={compactSurface}
                  voiceStates={voice.voiceStates}
                  isSelfEliminated={isSelfEliminated}
                  spectatingPlayerId={spectatingPlayerId}
                  supportCandidatePlayerIds={supportCandidates.map(
                    (candidate) => candidate.id
                  )}
                  onSpectatePlayer={setPendingSupportPlayerId}
                />
                <div className="relative z-10 flex h-full min-h-0 flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {tableStatusTitle}
                      </p>
                      <p className="mt-1 text-xs text-white/65">
                        {tableStatusDetail}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                      <span className="rounded-full border border-white/10 bg-black/28 px-2.5 py-1.5 text-[11px] font-medium text-white/60 sm:px-3 sm:py-2 sm:text-xs">
                        {room.players.length}/{room.houseRules.maxPlayers}{" "}
                        seated
                      </span>
                      <DirectionPill direction={game?.direction ?? 1} compact />
                      <ColorPill color={game?.currentColor ?? "red"} />
                      {canRestartGame && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={onRestartGame}
                          className="rounded-full bg-white px-3 text-neutral-950 hover:bg-white/85"
                        >
                          <Play className="mr-1.5 size-3.5" strokeWidth={2.2} />
                          New match
                        </Button>
                      )}
                      {rouletteChoice && !canDrawRoulette && (
                        <div className="flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-300/12 px-3 py-1 text-xs text-amber-50 shadow-[0_10px_26px_rgba(0,0,0,0.22)] backdrop-blur-md">
                          <span className="flex items-center gap-1.5">
                            {rouletteTargetName} draws until
                            <span
                              className="size-2.5 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.22)]"
                              style={{
                                background: colorValue(rouletteChoice.color),
                              }}
                            />
                            {rouletteChoice.color}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 place-items-center px-1 py-2 sm:px-8 sm:py-5">
                    <div className="flex min-h-0 flex-col items-center justify-center gap-2 sm:gap-4">
                      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-8 lg:gap-12">
                        <DeckStack
                          canDraw={Boolean(playerGame?.canDraw)}
                          alreadyDrawn={Boolean(playerGame?.canEndTurn)}
                          drawPileCount={game?.drawPileCount ?? 0}
                          size={tableCardSize}
                          onDraw={handleDrawCard}
                          rouletteMode={canDrawRoulette}
                          rouletteColor={rouletteChoice?.color ?? null}
                          onDrawRoulette={handleDrawRouletteCard}
                        />
                        <DiscardStack
                          card={game?.topDiscard ?? null}
                          size={tableCardSize}
                        />
                      </div>
                      <TableStagedPlay
                        cards={tableStagedCards}
                        playerName={tableStagedPlayerName}
                        mode={tableStagedMode}
                        targetColor={
                          rouletteChoice?.color ??
                          (game?.stagedPlay?.kind === "roulette"
                            ? game.currentColor
                            : null)
                        }
                        canEdit={canEditTableStaged}
                        onCardClick={toggleSelected}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute inset-x-2 top-[3.4rem] z-30 flex max-h-[34%] flex-col gap-2 overflow-y-auto sm:inset-x-3 sm:top-[4.25rem]">
                {visibleError && (
                  <p className="pointer-events-auto rounded-md border border-red-400/20 bg-red-500/12 px-3 py-2 text-sm text-red-100 shadow-[0_18px_44px_rgba(0,0,0,0.26)] backdrop-blur-md xl:hidden">
                    {visibleError}
                  </p>
                )}

                {playerGame?.catchablePlayerIds.length ? (
                  <div className="pointer-events-auto flex flex-wrap gap-2 rounded-lg border border-yellow-300/20 bg-yellow-300/10 p-3 backdrop-blur-md">
                    {playerGame.catchablePlayerIds.map((targetPlayerId) => (
                      <Button
                        key={targetPlayerId}
                        type="button"
                        size="sm"
                        onClick={() => handleCatchUno(targetPlayerId)}
                        className="bg-yellow-100 text-yellow-950 hover:bg-yellow-50"
                      >
                        Catch {playerName(room, targetPlayerId)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div
                data-self-hand="true"
                className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/35 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.25)] sm:rounded-2xl sm:p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white/82">
                      {isSelfEliminated
                        ? spectatingPlayerId
                          ? `${playerName(room, spectatingPlayerId)}'s hand`
                          : "Your hand"
                        : "Your hand"}
                    </p>
                    <p className="mt-0.5 text-xs text-white/42 sm:mt-1">
                      {isSelfEliminated
                        ? spectatingPlayerId
                          ? "🙌 Supporting"
                          : "Choose an active player to support."
                        : "Drag cards to the table, then end your turn."}
                    </p>
                  </div>
                  {!isSelfEliminated && (
                    <div className="flex flex-wrap items-center gap-2">
                      {needsColor && (
                        <ColorPicker
                          value={chosenColor}
                          required={!chosenColor}
                          onChange={setChosenColor}
                        />
                      )}
                      {canChooseRotate && (
                        <GameOptionCheckbox
                          checked={wantsRotate}
                          onCheckedChange={setWantsRotate}
                        >
                          Cycle hands
                        </GameOptionCheckbox>
                      )}
                      {canChooseSwap && (
                        <GameOptionCheckbox
                          checked={wantsSwap}
                          onCheckedChange={(checked) => {
                            setWantsSwap(checked)
                            if (!checked) setSwapWithPlayerId("")
                          }}
                        >
                          Swap
                        </GameOptionCheckbox>
                      )}
                      {needsSwap && (
                        <select
                          value={swapWithPlayerId}
                          onChange={(event) =>
                            setSwapWithPlayerId(event.target.value)
                          }
                          className="h-9 rounded-lg border border-white/10 bg-neutral-950 px-2 text-sm text-white outline-none"
                        >
                          <option value="">Swap with...</option>
                          {activeOpponents.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <GameOptionCheckbox
                        checked={declaredUno && canDeclareUno}
                        disabled={!canDeclareUno}
                        onCheckedChange={setDeclaredUno}
                      >
                        UNO
                      </GameOptionCheckbox>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!canUseEndTurnButton}
                        onClick={handleEndTurnButton}
                        className="bg-white text-neutral-950 hover:bg-white/85"
                      >
                        {canPassTurn ? "Pass turn" : "End turn"}
                      </Button>
                    </div>
                  )}
                </div>

                <SupportControls
                  candidates={
                    isSelfEliminated && !spectatingPlayerId
                      ? supportCandidates
                      : []
                  }
                  supporters={selfSupporters}
                  onChoose={setPendingSupportPlayerId}
                  onKick={onKickSupporter}
                />

                {isSelfEliminated &&
                  game?.stagedPlay?.playerId === spectatingPlayerId && (
                    <SupportDecisionPills
                      stagedPlay={game.stagedPlay}
                      room={room}
                    />
                  )}

                <TableEnergyBar game={game} onReact={onSendReaction} />

                {gameFinished && game?.supportRecap && (
                  <SupportRecapPanel
                    recap={game.supportRecap}
                    game={game}
                    players={room.players}
                  />
                )}

                <FannedGameHand
                  cards={
                    isSelfEliminated
                      ? (visibleSupportView?.hand ?? [])
                      : (playerGame?.hand ?? [])
                  }
                  playableCardIds={
                    isSelfEliminated
                      ? (visibleSupportView?.playableCardIds ?? [])
                      : (playerGame?.playableCardIds ?? [])
                  }
                  selectedCardIds={
                    isSelfEliminated
                      ? game?.stagedPlay?.playerId === spectatingPlayerId
                        ? game.stagedPlay.cards.map((card) => card.id)
                        : []
                      : selectedCardIds
                  }
                  hiddenCardIds={isSelfEliminated ? [] : pendingPlayedCardIds}
                  isMyTurn={isSelfEliminated ? false : Boolean(isMyTurn)}
                  drawStack={isSelfEliminated ? null : drawStack}
                  onToggleCard={isSelfEliminated ? () => {} : toggleSelected}
                  onDragStart={isSelfEliminated ? () => {} : setDraggingCardId}
                  onDragMove={
                    isSelfEliminated ? () => {} : updatePointerDragTarget
                  }
                  onDragEnd={isSelfEliminated ? () => {} : finishPointerDrag}
                  onCancelDrag={() => {
                    setDraggingCardId(null)
                    setTableDragActive(false)
                  }}
                  cardSize={handCardSize}
                />
              </div>
            </div>

            <TableChatPanel
              messages={room.chatMessages}
              squadMessages={playerSocial?.squadChatMessages}
              squadPlayerId={playerSocial?.squadPlayerId}
              players={room.players}
              squadMemberIds={squadMemberIdsFor(
                room,
                playerSocial?.squadPlayerId
              )}
              selfPlayerId={player.id}
              error={error}
              onSendMessage={onSendChatMessage}
            />
          </section>
        </div>
      </main>
      {pendingSupportPlayer && (
        <SupportConfirmDialog
          playerName={pendingSupportPlayer.name}
          onCancel={() => setPendingSupportPlayerId(null)}
          onConfirm={() => {
            onSupportPlayer(pendingSupportPlayer.id)
            setPendingSupportPlayerId(null)
          }}
        />
      )}
    </>
  )
}

function SupportControls({
  candidates,
  supporters,
  onChoose,
  onKick,
  compact = false,
}: {
  candidates: Array<Player>
  supporters: Array<Player>
  onChoose: (playerId: string) => void
  onKick: (playerId: string) => void
  compact?: boolean
}) {
  if (candidates.length === 0 && supporters.length === 0) return null
  return (
    <div
      className={
        (compact ? "mt-1" : "mt-2") + " flex shrink-0 gap-2 overflow-x-auto"
      }
    >
      {candidates.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-pink-200/15 bg-pink-300/[0.08] p-1">
          <span className="px-1.5 text-[10px] font-semibold tracking-wide text-pink-50/70 uppercase">
            Choose your player
          </span>
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onChoose(candidate.id)}
              className="h-7 rounded-lg bg-white px-2 text-[11px] font-semibold text-neutral-950 hover:bg-white/86"
            >
              🙌 {candidate.name}
            </button>
          ))}
        </div>
      )}
      {supporters.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.045] p-1">
          <span className="px-1.5 text-[10px] font-semibold tracking-wide text-white/50 uppercase">
            Your squad
          </span>
          {supporters.map((supporter) => (
            <button
              key={supporter.id}
              type="button"
              onClick={() => onKick(supporter.id)}
              title={`Kick ${supporter.name}`}
              className="h-7 rounded-lg border border-white/10 bg-black/30 px-2 text-[11px] text-white/72 hover:border-red-300/30 hover:bg-red-400/10 hover:text-red-100"
            >
              {supporter.name} · kick
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TableEnergyBar({
  game,
  onReact,
  compact = false,
}: {
  game: RoomSnapshot["game"]
  onReact: (input: SendTableReactionInput) => void
  compact?: boolean
}) {
  if (!game || game.turnPlayerId === null) return null
  return (
    <div
      className={
        (compact ? "mt-1" : "mt-2") +
        " flex shrink-0 items-center gap-1 overflow-x-auto"
      }
    >
      <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/30 p-1">
        {TABLE_REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact({ kind: "emoji", body: emoji })}
            className="grid size-7 place-items-center rounded-full text-sm hover:bg-white/10 active:scale-90"
            aria-label={`React ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <select
        aria-label="Send preset reaction"
        defaultValue=""
        onChange={(event) => {
          if (!event.target.value) return
          onReact({ kind: "preset", body: event.target.value })
          event.target.value = ""
        }}
        className="h-8 shrink-0 rounded-full border border-white/10 bg-neutral-950 px-2 text-[10px] font-semibold text-white/68 outline-none"
      >
        <option value="">Quick taunt…</option>
        {TABLE_REACTION_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
      </select>
      <div className="flex min-w-24 shrink-0 items-center gap-1.5 rounded-full border border-amber-200/15 bg-amber-300/[0.08] px-2 py-1">
        <span className="text-[9px] font-semibold text-amber-50/68 uppercase">
          Hype
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-pink-400 to-amber-300 transition-[width] duration-300"
            style={{
              width: `${Math.min(100, (game.hypeMeter.value / game.hypeMeter.threshold) * 100)}%`,
            }}
          />
        </span>
      </div>
    </div>
  )
}

function SupportDecisionPills({
  stagedPlay,
  room,
}: {
  stagedPlay: NonNullable<NonNullable<RoomSnapshot["game"]>["stagedPlay"]>
  room: RoomSnapshot
}) {
  const choices = [
    stagedPlay.chosenColor ? `Color: ${stagedPlay.chosenColor}` : null,
    stagedPlay.swapWithPlayerId
      ? `Swap: ${playerName(room, stagedPlay.swapWithPlayerId)}`
      : null,
    stagedPlay.rotateHands ? "Cycle hands" : null,
    stagedPlay.declaredUno ? "Calling UNO" : null,
  ].filter((choice): choice is string => Boolean(choice))
  if (choices.length === 0) return null
  return (
    <div className="mt-1 flex shrink-0 gap-1 overflow-x-auto">
      {choices.map((choice) => (
        <span
          key={choice}
          className="shrink-0 rounded-full border border-cyan-200/15 bg-cyan-300/[0.08] px-2 py-1 text-[10px] font-medium text-cyan-50/76"
        >
          {choice}
        </span>
      ))}
    </div>
  )
}

function SupportRecapPanel({
  recap,
  game,
  players,
  compact = false,
}: {
  recap: NonNullable<NonNullable<RoomSnapshot["game"]>["supportRecap"]>
  game: NonNullable<RoomSnapshot["game"]>
  players: Array<Player>
  compact?: boolean
}) {
  if (recap.journey.length === 0 && recap.titles.length === 0) return null
  const name = (playerId: string) =>
    players.find((candidate) => candidate.id === playerId)?.name ?? "Player"
  const journeys = Array.from(
    recap.journey
      .reduce((groups, entry) => {
        const entries = groups.get(entry.supporterPlayerId) ?? []
        entries.push(entry)
        groups.set(entry.supporterPlayerId, entries)
        return groups
      }, new Map<string, typeof recap.journey>())
      .entries()
  )

  function outcome(entry: (typeof recap.journey)[number]): string | null {
    if (entry.endReason === "supporter-kicked") return "kicked from squad"
    const target = game.players.find(
      (candidate) => candidate.playerId === entry.supportedPlayerId
    )
    if (target?.winnerPlacement) {
      return `finished #${target.winnerPlacement.position}`
    }
    if (target?.eliminated) return "eliminated"
    if (entry.endReason === "match-finished") return "match ended"
    return null
  }

  return (
    <div
      className={
        (compact ? "mt-1 p-2" : "mt-2 p-3") +
        " shrink-0 rounded-xl border border-amber-200/15 bg-amber-300/[0.07]"
      }
    >
      <p className="text-[10px] font-semibold tracking-[0.14em] text-amber-50/64 uppercase">
        Support recap
      </p>
      <div className="mt-1 space-y-1 text-[11px] text-white/70">
        {journeys.map(([supporterPlayerId, entries]) => (
          <div
            key={supporterPlayerId}
            className="flex items-center gap-1 overflow-x-auto rounded-lg border border-white/8 bg-black/18 px-2 py-1.5"
          >
            <span className="shrink-0 font-semibold text-white/82">
              {name(supporterPlayerId)}
            </span>
            {entries.map((entry, index) => (
              <span
                key={`${entry.supportedPlayerId}:${entry.createdAt}`}
                className="flex shrink-0 items-center gap-1"
              >
                <span className="text-white/32">→</span>
                <span>{name(entry.supportedPlayerId)}</span>
                {outcome(entry) && (
                  <span className="text-white/42">({outcome(entry)})</span>
                )}
                {index < entries.length - 1 && (
                  <span className="text-amber-200/42">then</span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 overflow-x-auto text-[11px]">
        {recap.titles.map((title) => (
          <span
            key={`${title.label}:${title.playerId}`}
            className="shrink-0 rounded-full bg-white px-2 py-1 font-semibold text-neutral-950"
          >
            {title.label}: {name(title.playerId)}
          </span>
        ))}
      </div>
    </div>
  )
}

function deckDrawFlightFromEvent(event: GameEvent): DeckDrawFlightState | null {
  if (!event.playerId) return null
  if (event.type === "draw-penalty") {
    return {
      id: `${event.id}:draw-flight`,
      eventId: event.id,
      targetPlayerId: event.playerId,
      cardCount: Math.max(1, event.cardCount ?? event.cards?.length ?? 1),
    }
  }

  if (event.type === "card-drawn" && event.drawKind === "single") {
    return {
      id: `${event.id}:draw-flight`,
      eventId: event.id,
      targetPlayerId: event.playerId,
      cardCount: Math.max(1, event.cardCount ?? event.cards?.length ?? 1),
    }
  }

  return null
}

function TableChatPanel({
  messages,
  squadMessages = [],
  squadPlayerId = null,
  players = [],
  squadMemberIds = [],
  selfPlayerId,
  error,
  onSendMessage,
}: {
  messages: Array<ChatMessage>
  squadMessages?: Array<ChatMessage>
  squadPlayerId?: string | null
  players?: Array<Player>
  squadMemberIds?: Array<string>
  selfPlayerId: string
  error: string | null
  onSendMessage: (input: SendChatMessageInput) => void
}) {
  const {
    addMention,
    changeText,
    channel,
    channelMessages,
    mentionablePlayers,
    publicMention,
    send,
    sendText,
    setChannel,
    setTray,
    squadMention,
    text,
    tray,
  } = useChannelChat({
    messages,
    squadMessages,
    squadPlayerId,
    players,
    squadMemberIds,
    selfPlayerId,
    isReading: true,
    onSendMessage,
  })

  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-2 shadow-[0_18px_56px_rgba(0,0,0,0.28)] lg:flex xl:p-3">
      <div className="flex shrink-0 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/28 text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <MessageCircle className="size-4" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white/86">Match chat</h2>
            <p className="text-[11px] text-white/42">
              Emoji, GIFs, and quick roasts
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-black/26 px-2 py-1 text-[11px] text-white/52 tabular-nums">
          {channelMessages.length}
        </span>
      </div>

      <ChatChannelTabs
        channel={channel}
        squadAvailable={Boolean(squadPlayerId)}
        publicMention={publicMention}
        squadMention={squadMention}
        onChange={setChannel}
      />

      <ChatMessageList
        messages={channelMessages}
        selfPlayerId={selfPlayerId}
        className="mt-3 flex-1 pr-1"
      />

      {error && (
        <p className="mt-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100 shadow-[0_12px_26px_rgba(0,0,0,0.22)]">
          {error}
        </p>
      )}

      <ChatComposer
        text={text}
        tray={tray}
        mentionablePlayers={mentionablePlayers}
        onMention={addMention}
        onTextChange={changeText}
        onTrayChange={setTray}
        onSend={send}
        onSendText={sendText}
      />
    </aside>
  )
}

function MobileChatSheet({
  messages,
  squadMessages = [],
  squadPlayerId = null,
  players = [],
  squadMemberIds = [],
  selfPlayerId,
  error,
  onSendMessage,
}: {
  messages: Array<ChatMessage>
  squadMessages?: Array<ChatMessage>
  squadPlayerId?: string | null
  players?: Array<Player>
  squadMemberIds?: Array<string>
  selfPlayerId: string
  error: string | null
  onSendMessage: (input: SendChatMessageInput) => void
}) {
  const [open, setOpen] = useState(false)
  const haptic = useWebHaptics()
  const {
    addMention,
    changeText,
    channel,
    channelMessages,
    markChannelRead,
    mentionablePlayers,
    publicMention,
    send,
    sendText,
    setChannel,
    setTray,
    squadMention,
    text,
    tray,
    unreadMessageCount,
  } = useChannelChat({
    messages,
    squadMessages,
    squadPlayerId,
    players,
    squadMemberIds,
    selfPlayerId,
    isReading: open,
    onBeforeSend: () => haptic.trigger("light"),
    onSendMessage,
  })

  function openChat() {
    setOpen(true)
    markChannelRead()
  }

  useEffect(() => {
    if (!open) return
    if (typeof document === "undefined") return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={openChat}
        className="relative grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-white/74 transition-[background-color,border-color,color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:border-white/18 hover:bg-white/[0.075] hover:text-white active:scale-[0.96]"
        aria-label={
          unreadMessageCount > 0
            ? `Open table chat, ${unreadMessageCount} unread message${unreadMessageCount === 1 ? "" : "s"}`
            : "Open table chat"
        }
      >
        <MessageCircle className="size-4" strokeWidth={1.9} />
        {unreadMessageCount > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-white px-1 text-[9px] font-semibold text-neutral-950 tabular-nums shadow-[0_8px_20px_rgba(0,0,0,0.32)]">
            {Math.min(unreadMessageCount, 99)}
          </span>
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[80] lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/62 backdrop-blur-[2px]"
              aria-label="Close table chat"
              onClick={() => setOpen(false)}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-chat-title"
              className="absolute inset-x-0 bottom-0 flex h-[82dvh] max-h-[92dvh] min-h-[min(560px,88dvh)] flex-col rounded-t-[1.35rem] border border-white/10 bg-[#090806] text-white shadow-[0_-28px_80px_rgba(0,0,0,0.58)] sm:h-[76dvh]"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <h2
                    id="mobile-chat-title"
                    className="text-base font-semibold text-white"
                  >
                    Match chat
                  </h2>
                  <p className="mt-0.5 text-xs text-white/45">
                    Text, emoji, GIFs, and quick lines.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-white/66 transition-[background-color,border-color,color,scale] duration-200 active:scale-[0.96]"
                  aria-label="Close table chat"
                >
                  <X className="size-4" strokeWidth={1.9} />
                </button>
              </div>

              <div className="px-4 pt-2">
                <ChatChannelTabs
                  channel={channel}
                  squadAvailable={Boolean(squadPlayerId)}
                  publicMention={publicMention}
                  squadMention={squadMention}
                  onChange={(nextChannel) => {
                    setChannel(nextChannel)
                    markChannelRead(nextChannel)
                  }}
                />
              </div>

              <ChatMessageList
                messages={channelMessages}
                selfPlayerId={selfPlayerId}
                emptyVariant="sheet"
                className="flex-1 px-4 py-3"
              />

              {error && (
                <p className="mx-4 mb-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                  {error}
                </p>
              )}

              <div className="shrink-0 border-t border-white/10 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                <ChatComposer
                  text={text}
                  tray={tray}
                  comfortable
                  mentionablePlayers={mentionablePlayers}
                  onMention={addMention}
                  onTextChange={changeText}
                  onTrayChange={setTray}
                  onSend={send}
                  onSendText={sendText}
                />
              </div>
            </section>
          </div>,
          document.body
        )}
    </>
  )
}

function MobileSeatingRing({
  room,
  game,
  selfPlayerId,
  voiceStates,
  canTakeDrawPenalty,
  onTakeDrawPenalty,
  spectatingPlayerId,
  supportCandidatePlayerIds,
  onSpectatePlayer,
}: {
  room: RoomSnapshot
  game: RoomSnapshot["game"]
  selfPlayerId: string
  voiceStates: RoomVoiceController["voiceStates"]
  canTakeDrawPenalty: boolean
  onTakeDrawPenalty: () => void
  spectatingPlayerId: string | null
  supportCandidatePlayerIds: Array<string>
  onSpectatePlayer: (targetPlayerId: string) => void
}) {
  const ordered = orderPlayersAroundSelf(room.players, selfPlayerId)

  if (ordered.length === 0) return null

  const dense = ordered.length >= 7

  return (
    <div className="pointer-events-none absolute inset-x-0 top-10 bottom-2 z-20">
      {ordered.map((candidate, index) => {
        const seat = mobileSeatPosition(index, ordered.length)
        const state = game?.players.find(
          (gamePlayer) => gamePlayer.playerId === candidate.id
        )
        const active = game?.turnPlayerId === candidate.id
        const winnerPlacement = state?.winnerPlacement ?? null
        const eliminated = Boolean(state?.eliminated)
        const declaredUno = Boolean(state?.declaredUno)
        const isYou = candidate.id === selfPlayerId
        const voiceState = voiceStates[candidate.id]
        const hasVoiceOn = Boolean(voiceState?.enabled)
        const isMuted = !hasVoiceOn || Boolean(voiceState?.muted)
        const isSpeaking = Boolean(voiceState?.speaking && !isMuted)
        const drawStack =
          game?.drawStack?.targetPlayerId === candidate.id
            ? game.drawStack
            : null
        const handCount = state?.handCount ?? 0
        const isWinner = winnerPlacement?.position === 1
        const fadedOpacity = eliminated || !candidate.connected
        const showName = !dense || isYou
        const supporterCount =
          game?.supportLinks.filter(
            (link) => link.supportedPlayerId === candidate.id
          ).length ?? 0
        const supporterNames =
          game?.supportLinks
            .filter((link) => link.supportedPlayerId === candidate.id)
            .map(
              (link) =>
                room.players.find(
                  (supporter) => supporter.id === link.supporterPlayerId
                )?.name
            )
            .filter((name): name is string => Boolean(name)) ?? []
        const latestReaction = game?.tableReactions
          .slice()
          .reverse()
          .find(
            (reaction) =>
              (reaction.supportedPlayerId ?? reaction.playerId) === candidate.id
          )

        const isSpectated = spectatingPlayerId === candidate.id
        const canSpectate = supportCandidatePlayerIds.includes(candidate.id)

        const ringClass = isWinner
          ? "ring-2 ring-amber-200/85 shadow-[0_0_22px_rgba(252,211,77,0.46)]"
          : isSpectated
            ? "ring-2 ring-cyan-400/90 shadow-[0_0_22px_rgba(34,211,238,0.6)]"
            : active
              ? "ring-2 ring-amber-200/80 shadow-[0_0_22px_rgba(252,211,77,0.42)]"
              : declaredUno
                ? "ring-2 ring-yellow-200/65 shadow-[0_0_18px_rgba(250,204,21,0.32)]"
                : isYou
                  ? "ring-2 ring-sky-200/55 shadow-[0_0_18px_rgba(125,211,252,0.24)]"
                  : "ring-1 ring-white/14"

        return (
          <div
            key={candidate.id}
            data-seat-player-id={candidate.id}
            onClick={() => {
              if (canSpectate) {
                onSpectatePlayer(candidate.id)
              }
            }}
            className={
              "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-[opacity,transform] duration-300 " +
              (dense ? "w-[52px]" : "w-[60px]") +
              " " +
              (fadedOpacity ? "opacity-55" : "opacity-100") +
              " " +
              (canSpectate
                ? "pointer-events-auto cursor-pointer hover:scale-105"
                : "")
            }
            style={{
              left: `${seat.left}%`,
              top: `${seat.top}%`,
              zIndex: active || isWinner ? 3 : isYou ? 2 : 1,
            }}
          >
            <div
              className={
                "relative grid place-items-center rounded-lg border bg-white/[0.06] text-white/82 transition-transform duration-300 " +
                (dense ? "size-8" : "size-9") +
                " " +
                ringClass +
                " " +
                (active || isWinner
                  ? "scale-110 border-amber-200/65"
                  : "border-white/10")
              }
            >
              {winnerPlacement ? (
                <Trophy className="size-4" strokeWidth={2.1} />
              ) : (
                <UserRound
                  className={dense ? "size-3.5" : "size-4"}
                  strokeWidth={1.85}
                />
              )}
              <span
                className={
                  "absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full border px-1 text-[9px] font-semibold tabular-nums shadow-[0_4px_10px_rgba(0,0,0,0.32)] " +
                  (declaredUno && !winnerPlacement && !eliminated
                    ? "border-yellow-100/45 bg-yellow-300/20 text-yellow-50"
                    : "border-white/14 bg-neutral-950/95 text-white/80")
                }
              >
                {winnerPlacement
                  ? `#${winnerPlacement.position}`
                  : declaredUno
                    ? "UNO"
                    : handCount}
              </span>
              {supporterCount > 0 && (
                <span className="absolute -bottom-1.5 -left-1.5 rounded-full border border-pink-200/25 bg-pink-300/18 px-1 text-[8px] font-semibold text-pink-50 shadow-[0_4px_10px_rgba(0,0,0,0.32)]">
                  🙌 {supporterCount}
                </span>
              )}
              {latestReaction && (
                <span
                  key={latestReaction.id}
                  className="absolute -bottom-5 animate-bounce rounded-full border border-white/12 bg-black/80 px-1.5 py-0.5 text-[9px] text-white shadow-lg"
                >
                  {latestReaction.body}
                </span>
              )}
              <span
                className={
                  "absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border bg-neutral-950/95 transition-[border-color,color] " +
                  (isSpeaking
                    ? "border-emerald-300 text-white"
                    : hasVoiceOn && !isMuted
                      ? "border-white/20 text-white/72"
                      : "border-white/12 text-white/32")
                }
                aria-label={
                  isSpeaking
                    ? "Speaking"
                    : hasVoiceOn && !isMuted
                      ? "Voice on"
                      : "Mic off"
                }
              >
                {hasVoiceOn && !isMuted ? (
                  <Mic className="size-2.5" strokeWidth={2.4} />
                ) : (
                  <MicOff className="size-2.5" strokeWidth={2.4} />
                )}
              </span>
            </div>
            {showName && (
              <p
                className={
                  "mt-0.5 w-full truncate text-center font-medium " +
                  (dense ? "text-[9px]" : "text-[10px]") +
                  " " +
                  (active ? "text-amber-50" : "text-white/78")
                }
              >
                {isYou ? "You" : candidate.name}
              </p>
            )}
            {supporterNames.length > 0 && (
              <p
                className="mt-0.5 max-w-[72px] truncate text-center text-[8px] text-pink-100/72"
                title={supporterNames.join(", ")}
              >
                🙌 {supporterNames.join(", ")}
              </p>
            )}
            {drawStack && (
              <div className="pointer-events-auto absolute -bottom-1.5 flex items-center gap-1 rounded-full border border-white/14 bg-neutral-950 px-1.5 py-0.5 text-[9px] font-semibold text-red-100 shadow-[0_8px_18px_rgba(0,0,0,0.32)]">
                +{drawStack.amount}
                {canTakeDrawPenalty && (
                  <button
                    type="button"
                    onClick={onTakeDrawPenalty}
                    className="rounded-full bg-white px-1 py-px text-[8px] font-semibold text-neutral-950"
                  >
                    Take
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function mobileSeatPosition(index: number, total: number) {
  const count = Math.max(total, 1)
  const angle = Math.PI / 2 + (index * Math.PI * 2) / count
  const xRadius = count <= 2 ? 0 : count >= 7 ? 43 : 41
  const yRadius = count >= 7 ? 41 : 39

  return {
    left: 50 + Math.cos(angle) * xRadius,
    top: 50 + Math.sin(angle) * yRadius,
  }
}

function ChatChannelTabs({
  channel,
  squadAvailable,
  publicMention,
  squadMention,
  onChange,
}: {
  channel: ChatChannel
  squadAvailable: boolean
  publicMention: boolean
  squadMention: boolean
  onChange: (channel: ChatChannel) => void
}) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-white/8 bg-black/22 p-1">
      {(["public", "squad"] as const).map((nextChannel) => {
        const disabled = nextChannel === "squad" && !squadAvailable
        const mentioned =
          nextChannel === "public" ? publicMention : squadMention
        return (
          <button
            key={nextChannel}
            type="button"
            disabled={disabled}
            onClick={() => onChange(nextChannel)}
            className={
              "relative h-8 rounded-lg text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 " +
              (channel === nextChannel
                ? "bg-white text-neutral-950"
                : "text-white/52 hover:bg-white/[0.06] hover:text-white/78")
            }
          >
            {nextChannel === "public" ? "Public" : "Squad"}
            {mentioned && (
              <span className="absolute top-1 right-2 grid size-4 place-items-center rounded-full bg-pink-500 text-[9px] text-white">
                @
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function ChatMessageList({
  messages,
  selfPlayerId,
  emptyVariant = "panel",
  className,
}: {
  messages: Array<ChatMessage>
  selfPlayerId: string
  emptyVariant?: "panel" | "sheet"
  className?: string
}) {
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" })
  }, [messages.length])

  const emptyState =
    emptyVariant === "sheet" ? (
      <div className="relative isolate flex min-h-[280px] flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#0d0c0a] px-5 py-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.055),inset_0_0_0_1px_rgba(255,255,255,0.025)]">
        <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/14" />
        <div className="pointer-events-none absolute right-8 bottom-0 left-8 h-px bg-black/70" />
        <div className="relative grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.045] text-white/78 shadow-[0_16px_36px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <MessageCircle className="size-6" strokeWidth={1.8} />
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border border-yellow-200/25 bg-yellow-200/12 text-yellow-100 shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
            <Sparkles className="size-3" strokeWidth={2} />
          </span>
        </div>
        <p className="mt-4 text-base font-semibold tracking-[-0.01em] text-white/90">
          The table is quiet
        </p>
        <p className="mt-1 max-w-[15rem] text-sm leading-6 text-white/48">
          Send the first jab, emoji, or GIF before the next draw stack lands.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-1.5">
          {["Preset", "Emoji", "GIF"].map((label) => (
            <span
              key={label}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/48"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    ) : (
      <div className="grid min-h-[116px] place-items-center rounded-xl bg-black/18 px-4 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
        <div>
          <Sparkles
            className="mx-auto size-4 text-yellow-200/75"
            strokeWidth={1.9}
          />
          <p className="mt-2 text-sm font-medium text-white/76">
            No chatter yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/42">
            Type a message or open quick actions.
          </p>
        </div>
      </div>
    )

  return (
    <div
      ref={listRef}
      className={
        "uno-scrollbar flex min-h-0 flex-col gap-2 overflow-y-auto " +
        (className ?? "")
      }
    >
      {messages.length === 0
        ? emptyState
        : messages.map((message) => (
            <ChatMessageBubble
              key={message.id}
              message={message}
              isSelf={message.playerId === selfPlayerId}
              isMentioned={message.mentionPlayerIds.includes(selfPlayerId)}
            />
          ))}
    </div>
  )
}

function ChatComposer({
  text,
  tray,
  mentionablePlayers = [],
  comfortable = false,
  onMention,
  onTextChange,
  onTrayChange,
  onSend,
  onSendText,
}: {
  text: string
  tray: ChatTray | null
  mentionablePlayers?: Array<Player>
  comfortable?: boolean
  onMention?: (player: Player) => void
  onTextChange: (value: string) => void
  onTrayChange: (tray: ChatTray | null) => void
  onSend: (input: SendChatMessageInput) => void
  onSendText: () => void
}) {
  function toggleTray(nextTray: ChatTray) {
    onTrayChange(tray === nextTray ? null : nextTray)
  }

  function sendQuick(input: SendChatMessageInput) {
    onSend(input)
    onTrayChange(null)
  }

  return (
    <div
      className={
        "shrink-0 bg-black/24 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055)] " +
        (comfortable ? "rounded-2xl p-2" : "rounded-xl p-1.5")
      }
    >
      {tray === "mentions" ? (
        <div className="uno-scrollbar flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {mentionablePlayers.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => onMention?.(player)}
              className="rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1.5 text-xs text-white/72 hover:bg-white/[0.09] hover:text-white"
            >
              @{player.name} · seat {player.seat}
            </button>
          ))}
        </div>
      ) : tray ? (
        <ChatQuickTray
          tray={tray}
          comfortable={comfortable}
          onSend={sendQuick}
        />
      ) : null}

      <div className={tray ? "mt-2" : ""}>
        <div
          className={
            (comfortable ? "mb-2" : "mb-1.5") + " flex items-center gap-1"
          }
        >
          <ChatToolButton
            active={tray === "presets"}
            label="Presets"
            icon={<Sparkles className="size-3" strokeWidth={1.9} />}
            onClick={() => toggleTray("presets")}
          />
          <ChatToolButton
            active={tray === "mentions"}
            label="Mention player"
            icon={<span className="text-[11px] font-bold">@</span>}
            onClick={() => toggleTray("mentions")}
          />
          <ChatToolButton
            active={tray === "emoji"}
            label="Emoji"
            icon={<Smile className="size-3" strokeWidth={1.9} />}
            onClick={() => toggleTray("emoji")}
          />
          <ChatToolButton
            active={tray === "gifs"}
            label="GIFs"
            icon={<ImageIcon className="size-3" strokeWidth={1.9} />}
            onClick={() => toggleTray("gifs")}
          />
        </div>

        <div className="flex items-end gap-1.5">
          <textarea
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return
              event.preventDefault()
              onSendText()
            }}
            rows={comfortable ? 2 : 1}
            maxLength={250}
            placeholder={comfortable ? "Talk your trash..." : "Talk..."}
            enterKeyHint="send"
            className={
              "min-w-0 flex-1 resize-none rounded-lg border border-white/10 bg-neutral-950/74 text-white/84 transition-[border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0,0,1)] outline-none placeholder:text-white/32 focus:border-white/24 focus:bg-neutral-950 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.055)] " +
              (comfortable
                ? "min-h-12 px-3 py-2.5 text-base leading-6"
                : "min-h-9 px-2.5 py-2 text-sm leading-5")
            }
          />
          <button
            type="button"
            onClick={onSendText}
            disabled={!text.trim()}
            className={
              "grid shrink-0 place-items-center rounded-lg bg-white text-neutral-950 shadow-[0_10px_24px_rgba(0,0,0,0.24)] transition-[background-color,opacity,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-white/86 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 " +
              (comfortable ? "size-12" : "size-9")
            }
            aria-label="Send message"
          >
            <SendHorizontal
              className={comfortable ? "size-4" : "size-3.5"}
              strokeWidth={2.2}
            />
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatQuickTray({
  tray,
  comfortable = false,
  onSend,
}: {
  tray: Exclude<ChatTray, "mentions">
  comfortable?: boolean
  onSend: (input: SendChatMessageInput) => void
}) {
  if (tray === "presets") {
    return (
      <div
        className={
          "uno-scrollbar grid gap-1.5 overflow-y-auto pr-1 " +
          (comfortable
            ? "max-h-[28dvh] grid-cols-1"
            : "max-h-[118px] grid-cols-2")
        }
      >
        {CHAT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onSend({ kind: "preset", body: preset })}
            className="min-h-9 rounded-lg border border-white/10 bg-white/[0.055] px-2.5 py-1.5 text-left text-[11px] leading-snug text-white/72 shadow-[0_8px_18px_rgba(0,0,0,0.16)] transition-[background-color,border-color,color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:border-white/18 hover:bg-white/[0.085] hover:text-white active:scale-[0.96]"
          >
            {preset}
          </button>
        ))}
      </div>
    )
  }

  if (tray === "emoji") {
    return (
      <div
        className={
          "grid gap-1.5 " + (comfortable ? "grid-cols-7" : "grid-cols-6")
        }
      >
        {CHAT_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSend({ kind: "emoji", body: emoji })}
            className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.055] text-lg shadow-[0_8px_18px_rgba(0,0,0,0.16)] transition-[background-color,border-color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:border-white/18 hover:bg-white/[0.085] active:scale-[0.96]"
            aria-label={`Send ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      className={
        "uno-scrollbar grid grid-cols-2 gap-2 overflow-y-auto pr-1 " +
        (comfortable ? "max-h-[30dvh]" : "max-h-40")
      }
    >
      {CHAT_GIFS.map((gif) => (
        <button
          key={gif.url}
          type="button"
          onClick={() => onSend({ kind: "gif", body: gif.url })}
          className="group min-h-20 overflow-hidden rounded-xl bg-black/36 text-left shadow-[0_10px_24px_rgba(0,0,0,0.22),inset_0_0_0_1px_rgba(255,255,255,0.075)] transition-[scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:brightness-110 active:scale-[0.96]"
        >
          <img
            src={gif.url}
            alt=""
            className="h-16 w-full object-cover outline outline-1 outline-white/10"
            loading="lazy"
          />
          <span className="block truncate px-2 py-1.5 text-[11px] font-medium text-white/64 group-hover:text-white/84">
            {gif.label}
          </span>
        </button>
      ))}
    </div>
  )
}

function ChatToolButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={active ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={active}
      className={
        "grid size-7 shrink-0 place-items-center rounded-md border transition-[background-color,border-color,color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] " +
        (active
          ? "border-white/24 bg-white text-neutral-950 shadow-[0_10px_22px_rgba(0,0,0,0.22)]"
          : "border-white/8 bg-white/[0.045] text-white/54 hover:border-white/16 hover:bg-white/[0.075] hover:text-white/78")
      }
    >
      {icon}
    </button>
  )
}

function ChatMessageBubble({
  message,
  isSelf,
  isMentioned,
}: {
  message: ChatMessage
  isSelf: boolean
  isMentioned: boolean
}) {
  return (
    <div className={"flex " + (isSelf ? "justify-end" : "justify-start")}>
      <div className={"max-w-[88%] " + (isSelf ? "items-end" : "items-start")}>
        <div
          className={
            "mb-1 flex items-center gap-1.5 px-1 text-[10px] font-medium text-white/36 " +
            (isSelf ? "justify-end" : "justify-start")
          }
        >
          <span className="max-w-[9rem] truncate">
            {isSelf ? "You" : message.playerName}
          </span>
          <span className="tabular-nums">
            {formatChatTime(message.createdAt)}
          </span>
        </div>
        <div
          className={
            "overflow-hidden rounded-2xl px-3 py-2 shadow-[0_10px_24px_rgba(0,0,0,0.22)] " +
            (isSelf
              ? "rounded-br-md bg-white text-neutral-950"
              : "rounded-bl-md bg-white/[0.085] text-white/82 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),0_10px_24px_rgba(0,0,0,0.22)]") +
            (isMentioned ? " ring-1 ring-pink-300/55" : "")
          }
        >
          {message.kind === "gif" ? (
            <div className="-m-1 w-[min(180px,100%)]">
              <img
                src={message.body}
                alt={message.label ?? "GIF reaction"}
                className="h-28 w-full rounded-xl object-cover outline outline-1 outline-white/10"
                loading="lazy"
              />
              {message.label && (
                <p
                  className={
                    "px-1 pt-1 text-[11px] " +
                    (isSelf ? "text-neutral-600" : "text-white/52")
                  }
                >
                  {message.label}
                </p>
              )}
            </div>
          ) : message.kind === "emoji" ? (
            <p className="text-3xl leading-none">{message.body}</p>
          ) : (
            <p className="text-sm leading-relaxed text-pretty">
              {message.body}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function formatChatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--:--"
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`
}

function FirstPlaceCelebration({ playerName }: { playerName: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <SideCannonConfetti />
      <style>
        {`
          @keyframes uno-trophy-pop {
            0% { opacity: 0; transform: translateY(-8px) scale(0.78); }
            16% { opacity: 1; transform: translateY(0) scale(1.08); }
            28% { transform: translateY(0) scale(1); }
            82% { opacity: 1; transform: translateY(0) scale(1); }
            100% { opacity: 0; transform: translateY(-8px) scale(0.94); }
          }
        `}
      </style>

      <div className="absolute inset-0 flex items-center justify-center p-4 sm:items-start sm:pt-[18dvh]">
        <div
          className="flex max-w-[calc(100vw-2rem)] min-w-[280px] items-center gap-4 rounded-2xl border border-amber-100/38 bg-neutral-950/86 px-5 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.48),0_0_70px_rgba(251,191,36,0.22)] backdrop-blur-md"
          style={{
            animation:
              "uno-trophy-pop 3.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          }}
        >
          <div className="relative grid size-16 shrink-0 place-items-center rounded-full border border-amber-100/50 bg-amber-300 text-amber-950 shadow-[0_0_34px_rgba(251,191,36,0.36)]">
            <Trophy className="size-8" strokeWidth={2.2} />
            <span className="absolute -bottom-1 rounded-full border border-amber-100/50 bg-neutral-950 px-2 py-0.5 text-[11px] font-bold text-amber-100">
              #1
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-amber-100/70 uppercase">
              First place
            </p>
            <p className="mt-1 truncate text-xl font-semibold text-white">
              {playerName}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function SideCannonConfetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const instance = confetti.create(canvas, {
      resize: true,
      useWorker: true,
    })
    const timeouts: Array<number> = []

    const defaults: ConfettiOptions = {
      colors: [
        "#fbbf24",
        "#f97316",
        "#ef4444",
        "#22c55e",
        "#38bdf8",
        "#ffffff",
      ],
      disableForReducedMotion: true,
      gravity: 0.95,
      scalar: 1.05,
      ticks: 230,
    }

    const fire = (particleRatio: number, options: ConfettiOptions) => {
      const particleCount = Math.floor(190 * particleRatio)
      void instance({
        ...defaults,
        ...options,
        particleCount,
      })
    }

    const bursts: Array<{
      delay: number
      ratio: number
      options: ConfettiOptions
    }> = [
      {
        delay: 0,
        ratio: 0.28,
        options: { spread: 28, startVelocity: 56 },
      },
      {
        delay: 110,
        ratio: 0.22,
        options: { spread: 44, startVelocity: 42 },
      },
      {
        delay: 220,
        ratio: 0.18,
        options: { spread: 64, startVelocity: 34, decay: 0.92, scalar: 0.9 },
      },
    ]

    for (const burst of bursts) {
      timeouts.push(
        window.setTimeout(() => {
          fire(burst.ratio, {
            ...burst.options,
            angle: 58,
            origin: { x: 0, y: 0.72 },
          })
          fire(burst.ratio, {
            ...burst.options,
            angle: 122,
            origin: { x: 1, y: 0.72 },
          })
        }, burst.delay)
      )
    }

    return () => {
      for (const timeout of timeouts) window.clearTimeout(timeout)
      instance.reset()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full"
      aria-hidden="true"
    />
  )
}

function TableSeatRing({
  room,
  game,
  selfPlayerId,
  canTakeDrawPenalty,
  onTakeDrawPenalty,
  compact,
  voiceStates,
  isSelfEliminated,
  spectatingPlayerId,
  supportCandidatePlayerIds,
  onSpectatePlayer,
}: {
  room: RoomSnapshot
  game: RoomSnapshot["game"]
  selfPlayerId: string
  canTakeDrawPenalty: boolean
  onTakeDrawPenalty: () => void
  compact: boolean
  voiceStates: RoomVoiceController["voiceStates"]
  isSelfEliminated: boolean
  spectatingPlayerId: string | null
  supportCandidatePlayerIds: Array<string>
  onSpectatePlayer: (targetPlayerId: string) => void
}) {
  const players = orderPlayersAroundSelf(room.players, selfPlayerId)

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {players.map((candidate, index) => {
        const seat = tableSeatPosition(index, players.length, compact)
        const state = game?.players.find(
          (gamePlayer) => gamePlayer.playerId === candidate.id
        )

        return (
          <TableAvatarSeat
            key={candidate.id}
            player={candidate}
            handCount={state?.handCount ?? 0}
            supporterCount={
              game?.supportLinks.filter(
                (link) => link.supportedPlayerId === candidate.id
              ).length ?? 0
            }
            supporterNames={
              game?.supportLinks
                .filter((link) => link.supportedPlayerId === candidate.id)
                .map(
                  (link) =>
                    room.players.find(
                      (supporter) => supporter.id === link.supporterPlayerId
                    )?.name
                )
                .filter((name): name is string => Boolean(name)) ?? []
            }
            latestReaction={
              game?.tableReactions
                .slice()
                .reverse()
                .find(
                  (reaction) =>
                    (reaction.supportedPlayerId ?? reaction.playerId) ===
                    candidate.id
                ) ?? null
            }
            active={game?.turnPlayerId === candidate.id}
            declaredUno={Boolean(state?.declaredUno)}
            eliminated={Boolean(state?.eliminated)}
            winnerPlacement={state?.winnerPlacement ?? null}
            connected={candidate.connected}
            isYou={candidate.id === selfPlayerId}
            isStaging={game?.stagedPlay?.playerId === candidate.id}
            voiceState={voiceStates[candidate.id]}
            drawStack={
              game?.drawStack?.targetPlayerId === candidate.id
                ? game.drawStack
                : null
            }
            canTakeDrawPenalty={Boolean(
              canTakeDrawPenalty &&
              game?.drawStack?.targetPlayerId === candidate.id
            )}
            onTakeDrawPenalty={onTakeDrawPenalty}
            left={seat.left}
            top={seat.top}
            isSelfEliminated={isSelfEliminated}
            isSpectated={spectatingPlayerId === candidate.id}
            canChooseSupport={supportCandidatePlayerIds.includes(candidate.id)}
            onSpectatePlayer={onSpectatePlayer}
          />
        )
      })}
    </div>
  )
}

function TableAvatarSeat({
  player,
  handCount,
  supporterCount,
  supporterNames,
  latestReaction,
  active,
  declaredUno,
  eliminated,
  winnerPlacement,
  connected,
  isYou,
  isStaging,
  voiceState,
  drawStack,
  canTakeDrawPenalty,
  onTakeDrawPenalty,
  left,
  top,
  isSelfEliminated,
  isSpectated,
  canChooseSupport,
  onSpectatePlayer,
}: {
  player: Player
  handCount: number
  supporterCount: number
  supporterNames: Array<string>
  latestReaction:
    | NonNullable<RoomSnapshot["game"]>["tableReactions"][number]
    | null
  active: boolean
  declaredUno: boolean
  eliminated: boolean
  winnerPlacement: NonNullable<
    NonNullable<RoomSnapshot["game"]>["players"][number]["winnerPlacement"]
  > | null
  connected: boolean
  isYou: boolean
  isStaging: boolean
  voiceState?: RoomVoiceController["voiceStates"][string]
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"] | null
  canTakeDrawPenalty: boolean
  onTakeDrawPenalty: () => void
  left: number
  top: number
  isSelfEliminated?: boolean
  isSpectated?: boolean
  canChooseSupport?: boolean
  onSpectatePlayer?: (targetPlayerId: string) => void
}) {
  const placementText = winnerPlacement
    ? `${ordinalLabel(winnerPlacement.position)} place`
    : null
  const isFirstPlace = winnerPlacement?.position === 1
  const isUno = declaredUno && !winnerPlacement && !eliminated
  const hasVoiceOn = Boolean(voiceState?.enabled)
  const isMuted = !hasVoiceOn || Boolean(voiceState?.muted)
  const isSpeaking = Boolean(voiceState?.speaking && !isMuted)

  const canSpectate = Boolean(
    canChooseSupport &&
    isSelfEliminated &&
    !isYou &&
    !eliminated &&
    !winnerPlacement
  )

  return (
    <div
      data-seat-player-id={player.id}
      onClick={() => {
        if (canSpectate) {
          onSpectatePlayer?.(player.id)
        }
      }}
      className={
        "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-[opacity,transform,filter] duration-300 " +
        (winnerPlacement
          ? "opacity-100"
          : eliminated || !connected
            ? "opacity-45"
            : "opacity-100") +
        " " +
        (canSpectate
          ? "pointer-events-auto cursor-pointer hover:scale-[1.03]"
          : "")
      }
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <div
        className={
          "relative z-10 flex min-w-[72px] items-center gap-1.5 rounded-xl border px-1.5 py-1.5 shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur-md transition-[background-color,border-color,box-shadow,transform] duration-300 sm:min-w-[144px] sm:gap-2 sm:rounded-2xl sm:px-2.5 sm:py-2 " +
          (winnerPlacement
            ? isFirstPlace
              ? "border-amber-200/80 bg-amber-200/20 shadow-[0_0_0_1px_rgba(252,211,77,0.3),0_0_46px_rgba(252,211,77,0.34),0_18px_38px_rgba(0,0,0,0.34)]"
              : "border-white/18 bg-white/[0.075]"
            : isSpectated
              ? "scale-[1.03] border-cyan-400 bg-cyan-950/20 shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_0_42px_rgba(34,211,238,0.4),0_18px_38px_rgba(0,0,0,0.34)]"
              : isUno
                ? "scale-[1.03] border-yellow-200/75 bg-red-500/[0.14] shadow-[0_0_0_1px_rgba(250,204,21,0.26),0_0_44px_rgba(239,68,68,0.28),0_18px_38px_rgba(0,0,0,0.34)]"
                : active
                  ? "scale-[1.03] border-amber-200/70 bg-amber-200/16 shadow-[0_0_0_1px_rgba(252,211,77,0.25),0_0_42px_rgba(252,211,77,0.36),0_18px_38px_rgba(0,0,0,0.34)]"
                  : isStaging
                    ? "border-sky-200/45 bg-sky-300/12"
                    : "border-white/12 bg-black/38")
        }
      >
        {winnerPlacement && (
          <div
            className={
              "absolute -top-2 -right-2 grid size-8 place-items-center rounded-full border shadow-[0_8px_18px_rgba(0,0,0,0.28)] " +
              (isFirstPlace
                ? "border-amber-100/70 bg-amber-300 text-amber-950"
                : "border-white/16 bg-neutral-900 text-white/70")
            }
            aria-label={`${placementText} trophy`}
          >
            <Trophy className="size-4" strokeWidth={2.2} />
          </div>
        )}
        {supporterCount > 0 && (
          <div className="absolute -top-2 -left-2 rounded-full border border-pink-200/30 bg-pink-300/18 px-2 py-0.5 text-[10px] font-semibold text-pink-50 shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
            🙌 {supporterCount}
          </div>
        )}
        {latestReaction && (
          <div
            key={latestReaction.id}
            className="absolute -bottom-7 left-1/2 -translate-x-1/2 animate-bounce rounded-full border border-white/12 bg-neutral-950/95 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-white shadow-[0_10px_24px_rgba(0,0,0,0.42)]"
          >
            {latestReaction.body}
          </div>
        )}
        <div
          className={
            "grid size-9 shrink-0 place-items-center rounded-full border transition-[background-color,border-color,color,box-shadow] sm:size-12 " +
            (winnerPlacement
              ? isFirstPlace
                ? "border-amber-100/75 bg-amber-100/24 text-amber-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_0_28px_rgba(252,211,77,0.28)]"
                : "border-white/18 bg-white/[0.08] text-white/74"
              : active
                ? "border-amber-100/65 bg-amber-100/24 text-amber-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_24px_rgba(252,211,77,0.24)]"
                : isUno
                  ? "border-yellow-100/70 bg-red-400/[0.18] text-yellow-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_0_24px_rgba(250,204,21,0.22)]"
                  : "border-white/12 bg-white/[0.075] text-white/74")
          }
        >
          <UserRound className="size-5 sm:size-6" strokeWidth={1.8} />
        </div>
        <div className="hidden min-w-0 flex-1 sm:block">
          <p className="truncate text-xs font-semibold text-white/86">
            {player.name}
            {isYou ? " · You" : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-white/45">
            {winnerPlacement
              ? isFirstPlace
                ? "Winner"
                : placementText
              : eliminated
                ? "Eliminated"
                : isUno
                  ? "On UNO"
                  : active
                    ? "Taking turn"
                    : isStaging
                      ? "Staging"
                      : connected
                        ? "At table"
                        : "Away"}
          </p>
        </div>
        {winnerPlacement ? (
          <span
            className={
              "rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums " +
              (isFirstPlace
                ? "border-amber-100/40 bg-amber-200/22 text-amber-50"
                : "border-white/10 bg-black/30 text-white/64")
            }
          >
            #{winnerPlacement.position}
          </span>
        ) : (
          <span
            className={
              "rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums sm:px-2 sm:text-xs " +
              (isUno
                ? "border-yellow-100/45 bg-yellow-300/20 text-yellow-50"
                : "border-white/10 bg-black/30 text-white/64")
            }
          >
            {isUno ? "UNO" : handCount}
          </span>
        )}
        {drawStack && active && (
          <DrawStackSeatBadge
            amount={drawStack.amount}
            canTake={canTakeDrawPenalty}
            onTake={onTakeDrawPenalty}
          />
        )}
        <div
          className={
            "absolute -bottom-2 -left-2 grid size-6 place-items-center rounded-full border bg-neutral-950/95 text-white/72 shadow-[0_8px_18px_rgba(0,0,0,0.28)] transition-[border-color,color,box-shadow] " +
            (isSpeaking
              ? "border-emerald-300 text-white shadow-[0_0_0_1px_rgba(52,211,153,0.22),0_8px_18px_rgba(0,0,0,0.28)]"
              : hasVoiceOn && !isMuted
                ? "border-white/18"
                : "border-white/12 text-white/34")
          }
          aria-label={
            isSpeaking
              ? "Speaking"
              : hasVoiceOn && !isMuted
                ? "Voice on"
                : "Mic off"
          }
        >
          {hasVoiceOn && !isMuted ? (
            <Mic className="size-3.5" strokeWidth={2.1} />
          ) : (
            <MicOff className="size-3.5" strokeWidth={2.1} />
          )}
        </div>
      </div>
      {supporterNames.length > 0 && (
        <div
          className="pointer-events-auto flex max-w-40 flex-wrap justify-center gap-1"
          aria-label={`Supporters: ${supporterNames.join(", ")}`}
        >
          {supporterNames.map((name) => (
            <span
              key={name}
              className="max-w-24 truncate rounded-full border border-pink-200/20 bg-pink-300/12 px-1.5 py-0.5 text-[9px] font-medium text-pink-50/78"
            >
              🙌 {name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DrawStackSeatBadge({
  amount,
  canTake,
  onTake,
}: {
  amount: number
  canTake: boolean
  onTake: () => void
}) {
  return (
    <div className="pointer-events-auto absolute top-1/2 left-[calc(100%+0.4rem)] z-30 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-white/12 bg-black/58 px-2 py-1 text-xs text-white/72 shadow-[0_10px_24px_rgba(0,0,0,0.26)] backdrop-blur-md">
      <span className="font-semibold text-red-100 tabular-nums">+{amount}</span>
      {canTake && (
        <Button
          type="button"
          size="xs"
          onClick={onTake}
          className="h-6 rounded-full bg-white px-2 text-[11px] text-neutral-950 hover:bg-white/85 active:scale-[0.96]"
        >
          Take
        </Button>
      )}
    </div>
  )
}

function orderPlayersAroundSelf(players: Array<Player>, selfPlayerId: string) {
  const selfIndex = players.findIndex(
    (candidate) => candidate.id === selfPlayerId
  )
  if (selfIndex < 0) return players
  return [...players.slice(selfIndex), ...players.slice(0, selfIndex)]
}

function tableSeatPosition(index: number, total: number, compact: boolean) {
  const count = Math.max(total, 1)
  const angle = Math.PI / 2 + (index * Math.PI * 2) / count
  const xRadius = compact ? 28 : 34
  const yRadius = compact ? 38 : 42

  return {
    left: 50 + Math.cos(angle) * xRadius,
    top: 50 + Math.sin(angle) * yRadius,
    angle,
  }
}

function canStageCardWithSelection(
  card: Card,
  selectedCards: Array<Card>,
  playableCardIds: Array<string>,
  isMyTurn: boolean,
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"]
) {
  if (!isMyTurn) return false
  if (selectedCards.some((selected) => selected.id === card.id)) return true
  if (selectedCards.length === 0) return playableCardIds.includes(card.id)
  return canPlayStagedCards(
    [...selectedCards, card],
    playableCardIds,
    drawStack
  )
}

function cardsInIdOrder(cards: Array<Card>, cardIds: Array<string>) {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  return cardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is Card => Boolean(card))
}

function canPlayStagedCards(
  cards: Array<Card>,
  playableCardIds: Array<string>,
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"]
) {
  if (cards.length === 0) return false
  if (cards.length === 1) return playableCardIds.includes(cards[0]?.id ?? "")
  if (drawStack) {
    return (
      canStackDrawCards(drawStack, cards, playableCardIds) &&
      cards.some((card) => playableCardIds.includes(card.id))
    )
  }
  if (isDiscardFirstStage(cards, playableCardIds)) return true
  return (
    (sameNumberGroup(cards) ||
      sameDrawGroup(cards) ||
      sameActionGroup(cards)) &&
    cards.some((card) => playableCardIds.includes(card.id))
  )
}

function isDiscardFirstStage(
  cards: Array<Card>,
  playableCardIds: Array<string>
) {
  const discardCard = cards[0]
  if (!discardCard || discardCard.face.kind !== "discard-color") return false
  if (!playableCardIds.includes(discardCard.id)) return false

  return cards
    .slice(1)
    .every(
      (card) =>
        card.face.kind !== "discard-color" && card.color === discardCard.color
    )
}

function canStackDrawCards(
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"],
  cards: Array<Card>,
  playableCardIds: Array<string>
) {
  if (!drawStack || cards.length === 0) return false

  const minimum = drawStack.minimum
  const playableGroups = new Set(
    cards
      .filter((card) => playableCardIds.includes(card.id))
      .map((card) => drawGroupKey(card))
      .filter((key): key is string => Boolean(key))
  )

  return cards.every((card) => {
    const amount = drawAmount(card)
    const group = drawGroupKey(card)

    return Boolean(
      amount && amount >= minimum && group && playableGroups.has(group)
    )
  })
}

function drawAmount(card: Card) {
  switch (card.face.kind) {
    case "draw":
    case "wild-draw":
    case "wild-reverse-draw":
      return card.face.count
    default:
      return null
  }
}

function isForbiddenFinalCard(card: Card) {
  return card.face.kind !== "number" && card.face.kind !== "discard-color"
}

function sameNumberGroup(cards: Array<Card>) {
  const first = cards[0]
  if (!first || first.face.kind !== "number") return false
  const value = first.face.value
  return cards.every(
    (card) => card.face.kind === "number" && card.face.value === value
  )
}

function sameDrawGroup(cards: Array<Card>) {
  const first = cards[0]
  const key = first ? drawGroupKey(first) : null
  if (!key) return false
  return cards.every((card) => drawGroupKey(card) === key)
}

function sameActionGroup(cards: Array<Card>) {
  const firstKind = cards[0]?.face.kind
  if (
    firstKind !== "skip" &&
    firstKind !== "skip-everyone" &&
    firstKind !== "reverse"
  ) {
    return false
  }

  return cards.every((card) => card.face.kind === firstKind)
}

function drawGroupKey(card: Card) {
  switch (card.face.kind) {
    case "draw":
      return `draw:${card.face.count}`
    case "wild-draw":
      return `wild-draw:${card.face.count}`
    case "wild-reverse-draw":
      return `wild-reverse-draw:${card.face.count}`
    default:
      return null
  }
}

function DeckStack({
  canDraw,
  alreadyDrawn,
  drawPileCount,
  size,
  dense = false,
  onDraw,
  rouletteMode = false,
  rouletteColor = null,
  onDrawRoulette,
}: {
  canDraw: boolean
  alreadyDrawn: boolean
  drawPileCount: number
  size: ResponsiveCardSize
  dense?: boolean
  onDraw: () => void
  rouletteMode?: boolean
  rouletteColor?: PlayColor | null
  onDrawRoulette?: () => void
}) {
  const compact = size === "sm"
  const denseCompact = dense && compact
  const cardScale = denseCompact ? 0.88 : 1
  const showRoulette = rouletteMode && Boolean(onDrawRoulette)

  const buttonLabel = showRoulette
    ? "Draw card"
    : alreadyDrawn
      ? "Drawn"
      : "Draw one"
  const handleClick = showRoulette ? onDrawRoulette : onDraw
  const buttonDisabled = showRoulette ? false : !canDraw
  const buttonClass = showRoulette
    ? "rounded-lg border border-amber-200/55 bg-amber-300/22 font-semibold text-amber-50 shadow-[0_0_0_3px_rgba(252,211,77,0.18)] transition-[background-color,border-color,color,transform] hover:border-amber-200/75 hover:bg-amber-300/32 active:scale-[0.96]"
    : "rounded-lg border border-white/12 bg-black/35 font-medium text-white/84 transition-[background-color,border-color,color,transform] hover:border-white/22 hover:bg-white/10 hover:text-white active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45"
  const buttonSize = denseCompact
    ? "h-7 px-2 text-[11px]"
    : "h-8 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"

  return (
    <div
      data-draw-pile="true"
      className={
        "flex flex-col items-center " +
        (denseCompact ? "gap-1" : "gap-1.5 sm:gap-2")
      }
    >
      <div
        className={
          compact
            ? denseCompact
              ? "relative h-[94px] w-[72px]"
              : "relative h-[112px] w-[82px]"
            : "relative h-[178px] w-[128px]"
        }
      >
        {[0, 1, 2, 3].map((layer) => (
          <div
            key={layer}
            className="absolute rounded-xl border border-black/45 bg-neutral-950 shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
            style={{
              inset: `${12 - layer * 3}px ${layer * 3}px ${layer * 3}px ${12 - layer * 3}px`,
              transform: `translate(${layer * 3}px, ${layer * -3}px)`,
            }}
          />
        ))}
        <div
          className="absolute top-1/2 left-1/2 z-10"
          style={{
            transform: `translate(-50%, -50%) scale(${cardScale})`,
          }}
        >
          <UnoCard card={cardBackPlaceholder} faceDown size={size} static />
        </div>
      </div>
      <button
        type="button"
        disabled={buttonDisabled}
        onClick={handleClick}
        className={buttonClass + " " + buttonSize}
      >
        {buttonLabel}
      </button>
      {showRoulette && rouletteColor ? (
        <p
          className={
            (denseCompact ? "text-[10px]" : "text-[11px] sm:text-xs") +
            " inline-flex items-center gap-1 text-amber-50/80"
          }
        >
          until
          <span
            className="size-2 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.22)]"
            style={{ background: colorValue(rouletteColor) }}
          />
          {rouletteColor}
        </p>
      ) : (
        <p
          className={
            (denseCompact ? "text-[10px]" : "text-[11px] sm:text-xs") +
            " text-white/45"
          }
        >
          {drawPileCount} in deck
        </p>
      )}
    </div>
  )
}

function DiscardStack({
  card,
  size,
  dense = false,
}: {
  card: Card | null
  size: ResponsiveCardSize
  dense?: boolean
}) {
  const compact = size === "sm"
  const denseCompact = dense && compact
  const cardScale = denseCompact ? 0.88 : 1

  return (
    <div
      className={
        (denseCompact ? "gap-1" : "gap-1.5 sm:gap-2") +
        " flex flex-col items-center"
      }
    >
      <div
        className={
          compact
            ? denseCompact
              ? "relative h-[94px] w-[68px]"
              : "relative h-[102px] w-[72px]"
            : "relative h-[170px] w-[120px]"
        }
      >
        <div className="absolute inset-0 translate-x-2 translate-y-1.5 rounded-xl border border-black/40 bg-black/24 sm:translate-x-3 sm:translate-y-2 sm:rounded-2xl" />
        <div className="absolute inset-0 translate-x-1 translate-y-0.5 rounded-xl border border-black/30 bg-white/8 sm:translate-x-1.5 sm:translate-y-1 sm:rounded-2xl" />
        {card ? (
          <div
            className="absolute top-1/2 left-1/2 z-10"
            style={{
              transform: `translate(-50%, -50%) scale(${cardScale})`,
            }}
          >
            <UnoCard card={card} size={size} static />
          </div>
        ) : (
          <div
            className={
              compact
                ? denseCompact
                  ? "h-[94px] w-[68px] rounded-lg border border-white/10 bg-black/20"
                  : "h-[102px] w-[72px] rounded-lg border border-white/10 bg-black/20"
                : "h-[170px] w-[120px] rounded-xl border border-white/10 bg-black/20"
            }
          />
        )}
      </div>
      <p
        className={
          (denseCompact ? "text-[10px]" : "text-[11px] sm:text-xs") +
          " text-white/50"
        }
      >
        Discard pile
      </p>
    </div>
  )
}

function TableStagedPlay({
  cards,
  playerName,
  mode,
  targetColor,
  dense = false,
  surface = "table",
  canEdit,
  onCardClick,
}: {
  cards: Array<Card>
  playerName: string | null
  mode: "stage" | "roulette"
  targetColor: PlayColor | null
  dense?: boolean
  surface?: "table" | "tray"
  canEdit: boolean
  onCardClick: (card: Card) => void
}) {
  const half = (cards.length - 1) / 2
  const isTray = surface === "tray"
  const compact = cards.length > 5
  const trayCardScale =
    cards.length > 40
      ? 0.46
      : cards.length > 24
        ? 0.52
        : cards.length > 16
          ? 0.58
          : 0.66
  const cardScale = isTray && dense ? trayCardScale : dense ? 0.78 : 1
  const maxWidth = isTray && dense ? 300 : dense ? 320 : 370
  const cardVisualWidth = 72 * cardScale
  const baseGap =
    isTray && dense
      ? compact
        ? 15
        : 22
      : dense
        ? compact
          ? 18
          : 28
        : compact
          ? 26
          : 38
  const adaptiveGap =
    cards.length > 1
      ? Math.max(0, (maxWidth - cardVisualWidth) / (cards.length - 1))
      : baseGap
  const gap = Math.min(baseGap, adaptiveGap)
  const width = Math.min(
    maxWidth,
    Math.max(
      isTray && dense ? 104 : dense ? 118 : 154,
      cardVisualWidth + Math.max(cards.length - 1, 0) * gap
    )
  )
  const cardAnchor = 36 * cardScale
  const isRoulette = mode === "roulette"
  const sizeClass = isTray
    ? dense
      ? "rounded-[1rem] p-2"
      : "rounded-2xl p-3"
    : dense
      ? "max-w-[340px] rounded-xl p-2"
      : "max-w-[390px] rounded-2xl p-3"
  const shadowClass = isTray
    ? "shadow-[0_14px_36px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.08)]"
    : "shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"

  return (
    <div
      style={
        isTray
          ? {
              backgroundImage:
                "linear-gradient(135deg, rgba(255,255,255,0.055), rgba(255,255,255,0) 22%, rgba(0,0,0,0.2) 70%), repeating-linear-gradient(94deg, rgba(255,255,255,0.026) 0 9px, rgba(0,0,0,0.075) 9px 20px), linear-gradient(90deg, #2b160d, #3a2012 45%, #241209)",
            }
          : undefined
      }
      className={
        "mx-auto w-full shrink-0 border " +
        sizeClass +
        " " +
        shadowClass +
        " " +
        (isRoulette
          ? "border-amber-100/18 bg-amber-200/10"
          : isTray
            ? "border-black/45 bg-[#2b160d] backdrop-blur-md"
            : "border-black/25 bg-black/24")
      }
    >
      <div className="flex min-h-5 items-center justify-between gap-3 px-1">
        <p
          className={
            (dense ? "text-[11px]" : "text-xs") +
            " truncate font-medium text-white/72"
          }
        >
          {cards.length > 0
            ? isRoulette
              ? `${playerName ?? "Player"} picking up ${cards.length} card${cards.length === 1 ? "" : "s"}`
              : `${playerName ?? "Player"} staged ${cards.length} card${cards.length === 1 ? "" : "s"}`
            : "Drop cards here"}
        </p>
        {isRoulette && targetColor && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-50/72">
            until
            <span
              className="size-2 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.22)]"
              style={{ background: colorValue(targetColor) }}
            />
            {targetColor}
          </span>
        )}
        {canEdit && cards.length > 0 && (
          <span className="shrink-0 text-[11px] text-white/42">
            tap to remove
          </span>
        )}
      </div>
      <div
        data-roulette-source={isRoulette ? "true" : undefined}
        className={
          "relative grid place-items-center overflow-hidden rounded-xl border border-white/8 bg-black/24 shadow-[inset_0_12px_28px_rgba(0,0,0,0.22)] " +
          (isTray && dense
            ? "mt-1 h-[78px] p-1.5"
            : dense
              ? "mt-1.5 h-[88px] p-1.5"
              : "mt-2 h-[120px] p-2 sm:h-[132px] sm:p-3")
        }
      >
        {cards.length > 0 ? (
          <div
            className={
              isTray && dense
                ? "relative h-[72px]"
                : dense
                  ? "relative h-[78px]"
                  : "relative h-[106px] sm:h-[112px]"
            }
            style={{ width }}
          >
            {cards.map((card, index) => {
              const offset = index - half
              return (
                <div
                  key={card.id}
                  className="absolute bottom-0 left-1/2 sm:bottom-1.5"
                  style={{
                    transform: `translateX(${offset * gap - cardAnchor}px) rotate(${offset * 3.5}deg) scale(${cardScale})`,
                    transformOrigin: "bottom center",
                    zIndex: 10 + index,
                  }}
                >
                  <UnoCard
                    card={card}
                    size="sm"
                    static={!canEdit}
                    onClick={canEdit ? () => onCardClick(card) : undefined}
                    ariaLabel={
                      isRoulette ? "Revealed pickup card" : "Staged card"
                    }
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div
            className={
              isTray && dense
                ? "h-[46px] w-[104px] rounded-lg border border-dashed border-white/16 bg-white/[0.035]"
                : dense
                  ? "h-[52px] w-[112px] rounded-lg border border-dashed border-white/16 bg-white/[0.035]"
                  : "h-[78px] w-[132px] rounded-xl border border-dashed border-white/16 bg-white/[0.035]"
            }
          />
        )}
      </div>
    </div>
  )
}

function DirectionPill({
  direction,
  compact = false,
}: {
  direction: 1 | -1
  compact?: boolean
}) {
  const clockwise = direction === 1
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/28 px-2 py-1.5 text-[11px] font-medium text-white/70 sm:gap-2 sm:px-3 sm:py-2 sm:text-xs">
      <RotateCw
        className={"size-3.5 " + (clockwise ? "" : "-scale-x-100")}
        aria-hidden="true"
      />
      {compact
        ? clockwise
          ? "CW"
          : "CCW"
        : clockwise
          ? "Clockwise"
          : "Counter-clockwise"}
    </div>
  )
}

function FannedGameHand({
  cards,
  playableCardIds,
  selectedCardIds,
  hiddenCardIds,
  isMyTurn,
  drawStack,
  cardSize,
  onToggleCard,
  onDragStart,
  onDragMove,
  onDragEnd,
  onCancelDrag,
}: {
  cards: Array<Card>
  playableCardIds: Array<string>
  selectedCardIds: Array<string>
  hiddenCardIds?: Array<string>
  isMyTurn: boolean
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"]
  cardSize: ResponsiveCardSize
  onToggleCard: (card: Card) => void
  onDragStart: (cardId: string) => void
  onDragMove: (clientX: number, clientY: number) => void
  onDragEnd: (cardId: string, clientX: number, clientY: number) => void
  onCancelDrag: () => void
}) {
  type ActiveCardDrag = {
    cardId: string
    startX: number
    startY: number
    x: number
    y: number
    dx: number
    dy: number
    grabX: number
    grabY: number
    rotation: number
    dragging: boolean
  }

  const activeDragRef = useRef<ActiveCardDrag | null>(null)
  const ignoreNextClickRef = useRef(false)
  const [activeDrag, setActiveDragState] = useState<ActiveCardDrag | null>(null)
  const [magnifyId, setMagnifyId] = useState<string | null>(null)
  const haptic = useWebHaptics()

  function setActiveDrag(nextDrag: ActiveCardDrag | null) {
    activeDragRef.current = nextDrag
    setActiveDragState(nextDrag)
  }

  function swallowNextClick() {
    ignoreNextClickRef.current = true
    window.setTimeout(() => {
      ignoreNextClickRef.current = false
    }, 0)
  }

  const hiddenCardIdSet = new Set(hiddenCardIds ?? [])
  const selectedCards = cardsInIdOrder(cards, selectedCardIds)
  const discardSelectionActive = selectedCards[0]?.face.kind === "discard-color"
  const visibleCards = cards.filter(
    (card) =>
      !selectedCardIds.includes(card.id) && !hiddenCardIdSet.has(card.id)
  )
  const activeDragCard = activeDrag
    ? cards.find((card) => card.id === activeDrag.cardId)
    : null
  const compact = cardSize === "sm"

  if (!visibleCards.length) {
    return (
      <div className="mt-2 grid min-h-0 flex-1 place-items-center rounded-lg border border-dashed border-white/10 bg-black/10 text-sm text-white/38">
        {cards.length ? "Cards staged on the table" : "No cards in hand"}
      </div>
    )
  }

  const half = (visibleCards.length - 1) / 2
  const spread = compact
    ? visibleCards.length <= 8
      ? 34
      : visibleCards.length <= 14
        ? 26
        : visibleCards.length <= 20
          ? 20
          : 15
    : visibleCards.length <= 8
      ? 58
      : visibleCards.length <= 14
        ? 42
        : visibleCards.length <= 20
          ? 30
          : 22
  const rotation =
    visibleCards.length <= 8
      ? compact
        ? 5
        : 6
      : visibleCards.length <= 14
        ? 4
        : 2.35
  const cardScale =
    !compact && visibleCards.length > 22
      ? 0.9
      : !compact && visibleCards.length > 18
        ? 0.95
        : 1

  function canSelectCard(card: Card) {
    return canStageCardWithSelection(
      card,
      selectedCards,
      playableCardIds,
      isMyTurn,
      drawStack
    )
  }

  function canDragCard(card: Card) {
    return isMyTurn && canSelectCard(card)
  }

  function startPointerDrag(
    event: PointerEvent<HTMLElement>,
    card: Card,
    cardRotation: number
  ) {
    if (event.button !== 0) return
    if (!canDragCard(card)) return
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveDrag({
      cardId: card.id,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      rotation: cardRotation,
      dragging: false,
    })
  }

  function movePointerDrag(event: PointerEvent<HTMLElement>, card: Card) {
    const drag = activeDragRef.current
    if (drag?.cardId !== card.id) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const dragging = drag.dragging || Math.hypot(dx, dy) > 8

    if (dragging) event.preventDefault()
    if (dragging && !drag.dragging) onDragStart(card.id)
    if (dragging) onDragMove(event.clientX, event.clientY)

    setActiveDrag({
      ...drag,
      x: event.clientX,
      y: event.clientY,
      dx,
      dy,
      dragging,
    })
  }

  function endPointerDrag(event: PointerEvent<HTMLElement>, card: Card) {
    const drag = activeDragRef.current
    if (drag?.cardId !== card.id) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (drag.dragging) {
      swallowNextClick()
      onDragEnd(card.id, event.clientX, event.clientY)
    }

    setActiveDrag(null)
  }

  function handleCardClick(card: Card) {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false
      return
    }
    if (!canSelectCard(card)) {
      haptic.trigger("error")
      return
    }
    setMagnifyId(card.id)
    window.setTimeout(() => {
      onToggleCard(card)
      setMagnifyId((current) => (current === card.id ? null : current))
    }, 170)
  }

  function cancelPointerDrag(event: PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (activeDragRef.current?.dragging) onCancelDrag()
    setActiveDrag(null)
  }

  return (
    <div
      className={
        "mt-2 min-h-0 flex-1 overflow-visible pb-0 transition-opacity " +
        (isMyTurn ? "opacity-100" : "opacity-45")
      }
    >
      <div
        className={
          compact
            ? "relative mx-auto h-full min-h-[112px] max-w-full"
            : "relative mx-auto h-full min-h-[178px] max-w-full"
        }
      >
        <div className="absolute inset-x-0 bottom-1 flex justify-center">
          {visibleCards.map((card, index) => {
            const offset = index - half
            const playable = playableCardIds.includes(card.id)
            const stageable = canSelectCard(card)
            const draggable = canDragCard(card)
            const highlighted = Boolean(
              isMyTurn && stageable && (discardSelectionActive || playable)
            )
            const muted = Boolean(
              isMyTurn && discardSelectionActive && !stageable
            )
            const activeDragForCard =
              activeDrag?.cardId === card.id ? activeDrag : null
            const dragging = Boolean(activeDragForCard?.dragging)
            const magnifying = magnifyId === card.id
            const rotate = magnifying ? 0 : offset * rotation
            const translateX = offset * spread + (activeDragForCard?.dx ?? 0)
            const translateY =
              (dragging
                ? compact
                  ? -54
                  : -90
                : magnifying
                  ? compact
                    ? -52
                    : -76
                  : Math.min(
                      Math.abs(offset) * (compact ? 3 : 5),
                      compact ? 20 : 34
                    )) + (activeDragForCard?.dy ?? 0)
            const scale = (dragging ? 1.05 : magnifying ? 1.26 : 1) * cardScale

            return (
              <div
                key={card.id}
                className={
                  "absolute bottom-0 " +
                  (draggable
                    ? "cursor-grab touch-none active:cursor-grabbing"
                    : "")
                }
                style={{
                  transform: `translateX(${translateX}px) translateY(${translateY}px) rotate(${rotate}deg) scale(${scale})`,
                  transitionProperty: "transform",
                  transitionDuration: dragging
                    ? "0ms"
                    : magnifying
                      ? "150ms"
                      : "480ms",
                  transitionTimingFunction: magnifying
                    ? "cubic-bezier(0.22, 1.4, 0.36, 1)"
                    : "cubic-bezier(0.22, 0.9, 0.18, 1)",
                  zIndex: dragging || magnifying ? 90 : 10 + index,
                  willChange: "transform",
                  opacity: dragging ? 0 : muted ? 0.32 : 1,
                  filter: muted ? "saturate(0.55)" : undefined,
                }}
              >
                <UnoCard
                  card={card}
                  size={cardSize}
                  raised={dragging}
                  onPointerDown={(event) =>
                    startPointerDrag(event, card, rotate)
                  }
                  onPointerMove={(event) => movePointerDrag(event, card)}
                  onPointerUp={(event) => endPointerDrag(event, card)}
                  onPointerCancel={cancelPointerDrag}
                  onClick={draggable ? () => handleCardClick(card) : undefined}
                  ariaLabel={
                    playable
                      ? "Playable card in your hand"
                      : "Card in your hand"
                  }
                  className={
                    highlighted
                      ? "cursor-grab touch-none shadow-[0_0_0_2px_rgba(255,255,255,0.34),0_14px_30px_rgba(255,255,255,0.12)] active:cursor-grabbing"
                      : draggable
                        ? "cursor-grab touch-none active:cursor-grabbing"
                        : muted
                          ? "cursor-not-allowed touch-none"
                          : undefined
                  }
                />
              </div>
            )
          })}
        </div>
      </div>
      {activeDrag?.dragging &&
        activeDragCard &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed"
            style={{
              left: activeDrag.x - activeDrag.grabX,
              top: activeDrag.y - activeDrag.grabY,
              zIndex: 9999,
              transform: `rotate(${activeDrag.rotation}deg) scale(1.06)`,
            }}
          >
            <UnoCard
              card={activeDragCard}
              size={cardSize}
              static
              style={{ boxShadow: "none" }}
            />
          </div>,
          document.body
        )}
    </div>
  )
}

function InviteJoinScreen({
  roomCode,
  room,
  playerName,
  loadingPreview,
  joining,
  error,
  onPlayerName,
  onJoin,
  onCopyInvite,
}: {
  roomCode: string
  room: RoomSnapshot | null
  playerName: string
  loadingPreview: boolean
  joining: boolean
  error: string | null
  onPlayerName: (name: string) => void
  onJoin: () => void
  onCopyInvite: () => Promise<void>
}) {
  const waitingCount = room?.players.length ?? 0
  const waitingCopy = loadingPreview
    ? "Checking the room..."
    : waitingCount === 0
      ? "The room is open, but the seats are still loading."
      : waitingCount === 1
        ? `${room?.players[0]?.name ?? "Someone"} has a seat ready for you.`
        : `${waitingCount} players are already seated.`

  return (
    <main className="flex min-h-dvh bg-[#0A0A0A] px-4 py-5 text-white antialiased sm:p-6">
      <div className="mx-auto grid w-full max-w-5xl items-center gap-6 py-8 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.2em] text-white/45 uppercase sm:text-xs">
            UNO No Mercy invite
          </p>
          <h1 className="mt-3 max-w-xl text-4xl leading-[1.04] font-semibold tracking-tight text-balance sm:text-5xl">
            Join a private No Mercy table.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-pretty text-white/58">
            {waitingCopy} Drop your name, claim your seat, and jump into the
            same live room.
          </p>

          <form
            className="mt-8 w-full max-w-xl rounded-xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_16px_46px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-5"
            onSubmit={(event) => {
              event.preventDefault()
              onJoin()
            }}
          >
            <label
              className="text-sm font-medium text-white/82"
              htmlFor="invite-name"
            >
              Player name
            </label>
            <p className="mt-1 text-xs leading-5 text-white/42">
              This shows on your seat, in chat, and when you get caught.
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="invite-name"
                value={playerName}
                onChange={(event) => onPlayerName(event.target.value)}
                placeholder="Arc"
                className="min-h-11 w-full flex-none rounded-lg border border-white/10 bg-black/42 px-3.5 text-base text-white transition-[border-color,background-color,box-shadow] duration-200 outline-none placeholder:text-white/30 focus:border-white/28 focus:bg-black/58 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.055)] sm:h-10 sm:flex-1 sm:text-sm"
                maxLength={24}
                autoComplete="nickname"
                autoFocus
              />
              <Button
                type="submit"
                disabled={joining || !room}
                className="h-10 self-start rounded-lg bg-white px-4 text-sm text-neutral-950 shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-[background-color,opacity,scale] hover:bg-white/86 active:scale-[0.96] sm:self-auto"
              >
                {joining ? "Joining..." : "Join table"}
                <ArrowRight />
              </Button>
            </div>
            {error && (
              <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            )}
          </form>
        </section>

        <aside className="rounded-xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_16px_46px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-white/45">Invite code</p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-wider">
                {roomCode}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* <SoundToggle /> */}
              <CopyInviteButton iconOnly onCopy={onCopyInvite} />
            </div>
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UsersRound className="size-4 text-white/55" />
                <h2 className="text-sm font-medium text-white/86">
                  Seats at the table
                </h2>
              </div>
              <span className="text-xs text-white/42">
                {room
                  ? `${room.players.length}/${room.houseRules.maxPlayers}`
                  : "--"}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {loadingPreview && (
                <p className="rounded-md border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/45">
                  Checking the room...
                </p>
              )}
              {!loadingPreview &&
                room?.players.map((candidate) => (
                  <PlayerRow
                    key={candidate.id}
                    player={candidate}
                    isHost={candidate.id === room.hostPlayerId}
                    isYou={false}
                  />
                ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}

async function copyTextToClipboard(value: string) {
  try {
    if (window.isSecureContext && window.navigator.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // Fall back below for browsers that expose clipboard but reject the write.
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    const copied = document.execCommand("copy")
    if (!copied) throw new Error("Clipboard copy was rejected.")
  } finally {
    textarea.remove()
  }
}

function CopyInviteButton({
  iconOnly = false,
  onCopy,
}: {
  iconOnly?: boolean
  onCopy: () => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const haptic = useWebHaptics()

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (!copyFailed) return
    const t = window.setTimeout(() => setCopyFailed(false), 1800)
    return () => window.clearTimeout(t)
  }, [copyFailed])

  async function handleCopy() {
    setCopyFailed(false)
    try {
      await onCopy()
      setCopied(true)
      haptic.trigger("success")
    } catch (error) {
      setCopied(false)
      setCopyFailed(true)
      haptic.trigger("error")
      console.error("Failed to copy invite link", error)
    }
  }

  // Both icons sit absolutely on top of each other and cross-fade.
  const layer =
    "absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]"
  const shown = "scale-100 opacity-100 blur-0"
  const hidden = "scale-[0.4] opacity-0 blur-[3px]"

  return (
    <Button
      type="button"
      size={iconOnly ? "icon-lg" : "sm"}
      aria-label={
        iconOnly
          ? copied
            ? "Invite link copied"
            : copyFailed
              ? "Invite link copy failed"
              : "Copy invite link"
          : copyFailed
            ? "Invite link copy failed"
            : "Copy invite link"
      }
      aria-live="polite"
      onClick={handleCopy}
      className={
        "relative z-50 transition-[background-color,color,border-color,scale,transform] active:scale-[0.96] " +
        (iconOnly
          ? "rounded-full border border-white/10 bg-white/[0.045] text-white/74 hover:border-white/18 hover:bg-white/[0.075] hover:text-white/88 "
          : "bg-white text-neutral-950 hover:bg-white/85 ") +
        (copyFailed
          ? iconOnly
            ? "!border-red-300/40 !bg-red-500/12 !text-red-100"
            : "bg-red-100 text-red-950 hover:bg-red-100"
          : "")
      }
    >
      <span
        data-icon={iconOnly ? undefined : "inline-start"}
        className={
          "relative inline-block shrink-0 " + (iconOnly ? "size-4" : "size-3.5")
        }
        aria-hidden="true"
      >
        <Clipboard
          className={`${layer} ${iconOnly ? "size-4" : "size-3.5"} ${copied ? hidden : shown}`}
        />
        <Check
          strokeWidth={2.75}
          className={`${layer} ${iconOnly ? "size-4" : "size-3.5"} text-emerald-600 ${copied ? shown : hidden}`}
        />
      </span>
      {!iconOnly && <span>{copyFailed ? "Try again" : "Copy invite"}</span>}
    </Button>
  )
}

const playColors: Array<PlayColor> = ["red", "yellow", "green", "blue"]

const cardBackPlaceholder: Card = {
  id: "draw-pile",
  color: "wild",
  face: { kind: "wild" },
}

function ColorPill({ color }: { color: PlayColor }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] font-medium text-white/70 sm:gap-2 sm:px-3 sm:py-2 sm:text-xs">
      <span
        className="size-2.5 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.22)] sm:size-3"
        style={{ background: colorValue(color) }}
      />
      {color}
    </div>
  )
}

function ColorPicker({
  value,
  required = false,
  onChange,
}: {
  value: PlayColor | null
  required?: boolean
  onChange: (color: PlayColor) => void
}) {
  return (
    <div
      role="group"
      aria-label="Choose a color"
      className={
        "flex h-9 items-center gap-1 rounded-lg border px-1.5 transition-[background-color,border-color,box-shadow] " +
        (required
          ? "border-yellow-200/80 bg-yellow-300/12 shadow-[0_0_0_3px_rgba(250,204,21,0.14),0_0_26px_rgba(250,204,21,0.18)]"
          : "border-white/10 bg-white/[0.055]")
      }
    >
      {required && (
        <span className="hidden pr-1 pl-0.5 text-[11px] font-semibold tracking-[0.08em] text-yellow-100 uppercase sm:inline">
          Pick
        </span>
      )}
      {playColors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Choose ${color}`}
          onClick={() => onChange(color)}
          className={
            "size-6 rounded-full transition-[scale,box-shadow,filter] active:scale-[0.96] " +
            (value === color
              ? "shadow-[0_0_0_2px_white,0_0_0_4px_rgba(255,255,255,0.2)]"
              : required
                ? "shadow-[0_0_0_1px_rgba(255,255,255,0.34),0_0_12px_rgba(250,204,21,0.2)]"
                : "shadow-[0_0_0_1px_rgba(255,255,255,0.22)]")
          }
          style={{ background: colorValue(color) }}
        />
      ))}
    </div>
  )
}

function GameOptionCheckbox({
  checked,
  disabled = false,
  onCheckedChange,
  children,
}: {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <label
      className={
        "flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-white/10 bg-white/[0.055] px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-white/70 transition-[background-color,border-color,opacity] " +
        (disabled
          ? "cursor-not-allowed opacity-45"
          : "hover:border-white/18 hover:bg-white/[0.075]")
      }
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
      />
      <span>{children}</span>
    </label>
  )
}

function playerName(
  room: RoomSnapshot,
  playerId: string | null | undefined
): string {
  if (!playerId) return "Someone"
  return (
    room.players.find((player) => player.id === playerId)?.name ?? "Someone"
  )
}

function squadMemberIdsFor(
  room: RoomSnapshot,
  squadPlayerId: string | null | undefined
): Array<string> {
  if (!squadPlayerId) return []
  return [
    squadPlayerId,
    ...(room.game?.supportLinks
      .filter((link) => link.supportedPlayerId === squadPlayerId)
      .map((link) => link.supporterPlayerId) ?? []),
  ]
}

function ordinalLabel(value: number): string {
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th"

  return `${value}${suffix}`
}

function colorValue(color: PlayColor): string {
  switch (color) {
    case "red":
      return "oklch(0.58 0.22 29)"
    case "yellow":
      return "oklch(0.82 0.18 86)"
    case "green":
      return "oklch(0.62 0.18 145)"
    case "blue":
      return "oklch(0.58 0.17 252)"
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const media = window.matchMedia(query)
    setMatches(media.matches)

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches)
    }

    media.addEventListener("change", handleChange)
    return () => media.removeEventListener("change", handleChange)
  }, [query])

  return matches
}

function StatusDot({
  connected,
  compact = false,
}: {
  connected: boolean
  compact?: boolean
}) {
  if (compact) {
    return (
      <div
        className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.045]"
        title={connected ? "Connected" : "Offline"}
        aria-label={connected ? "Connected" : "Offline"}
      >
        <Circle
          className={
            "size-2.5 fill-current " +
            (connected ? "text-emerald-400" : "text-white/25")
          }
        />
      </div>
    )
  }
  return (
    <div className="flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-xs text-white/60 sm:px-3">
      <Circle
        className={
          "size-2 fill-current " +
          (connected ? "text-emerald-400" : "text-white/25")
        }
      />
      <span className="hidden sm:inline">
        {connected ? "Connected" : "Offline"}
      </span>
    </div>
  )
}

function VoiceToggleButton({
  voice,
}: {
  voice: RoomVoiceController
  compact?: boolean
}) {
  const micOn = Boolean(voice.enabled && !voice.muted)
  const title = voice.error
    ? voice.error
    : !voice.enabled
      ? "Join voice"
      : voice.muted
        ? "Unmute mic"
        : "Mute mic"

  return (
    <button
      type="button"
      onClick={voice.toggle}
      disabled={voice.connecting}
      title={title}
      aria-label={title}
      className={
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,opacity,scale] active:scale-[0.96] disabled:opacity-70 " +
        " " +
        (micOn
          ? "border-white/10 bg-white/[0.045] text-white/74 hover:border-white/18 hover:bg-white/[0.075] hover:text-white/88"
          : voice.error
            ? "border-red-300/35 bg-red-500/12 text-red-100"
            : "border-white/10 bg-white/[0.045] text-red-300 hover:border-white/18 hover:bg-white/[0.075] hover:text-red-200")
      }
    >
      {micOn ? (
        <Mic className="size-4" strokeWidth={2} />
      ) : (
        <MicOff className="size-4" strokeWidth={2} />
      )}
    </button>
  )
}

const remoteVoiceAudioElements = new Set<HTMLAudioElement>()

function describeVoiceStream(stream: MediaStream) {
  return {
    id: stream.id,
    active: stream.active,
    tracks: stream.getAudioTracks().map((track) => ({
      id: track.id,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
    })),
  }
}

function playRegisteredVoiceAudio(reason: string) {
  for (const audio of remoteVoiceAudioElements) {
    const playPromise = audio.play()
    if (playPromise) {
      playPromise
        .then(() => {
          logRoomVoiceDebug("remote audio play resolved", {
            reason,
            playerId: audio.dataset.playerId,
            readyState: audio.readyState,
            paused: audio.paused,
          })
        })
        .catch((cause: unknown) => {
          logRoomVoiceDebug("remote audio play blocked", {
            reason,
            playerId: audio.dataset.playerId,
            readyState: audio.readyState,
            paused: audio.paused,
            cause,
          })
        })
    }
  }
}

function VoiceAudioOutputs({
  streamsByPlayerId,
}: {
  streamsByPlayerId: Record<string, MediaStream>
}) {
  useEffect(() => {
    const unlockAudio = () => playRegisteredVoiceAudio("user-gesture")
    window.addEventListener("pointerdown", unlockAudio, { capture: true })
    window.addEventListener("touchend", unlockAudio, { capture: true })
    window.addEventListener("keydown", unlockAudio, { capture: true })

    return () => {
      window.removeEventListener("pointerdown", unlockAudio, { capture: true })
      window.removeEventListener("touchend", unlockAudio, { capture: true })
      window.removeEventListener("keydown", unlockAudio, { capture: true })
    }
  }, [])

  return (
    <>
      {Object.entries(streamsByPlayerId).map(([playerId, stream]) => (
        <RemoteVoiceAudio key={playerId} playerId={playerId} stream={stream} />
      ))}
    </>
  )
}

function RemoteVoiceAudio({
  playerId,
  stream,
}: {
  playerId: string
  stream: MediaStream
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.dataset.playerId = playerId
    audio.muted = false
    audio.volume = 1
    audio.srcObject = stream
    remoteVoiceAudioElements.add(audio)
    logRoomVoiceDebug("remote audio element attached", {
      playerId,
      stream: describeVoiceStream(stream),
    })
    let waitingForGesture = false
    const unlockEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "touchend",
      "keydown",
    ]

    const removeUnlockListeners = () => {
      if (!waitingForGesture) return
      waitingForGesture = false
      for (const eventName of unlockEvents) {
        window.removeEventListener(eventName, playAudio)
      }
    }

    const addUnlockListeners = () => {
      if (waitingForGesture) return
      waitingForGesture = true
      for (const eventName of unlockEvents) {
        window.addEventListener(eventName, playAudio, { once: true })
      }
    }

    const playAudio = () => {
      const playPromise = audio.play()
      if (playPromise) {
        playPromise
          .then(() => {
            removeUnlockListeners()
            logRoomVoiceDebug("remote audio play resolved", {
              playerId,
              readyState: audio.readyState,
              paused: audio.paused,
            })
          })
          .catch((cause: unknown) => {
            logRoomVoiceDebug("remote audio play blocked", {
              playerId,
              readyState: audio.readyState,
              paused: audio.paused,
              cause,
            })
            addUnlockListeners()
          })
      }
    }

    const handleTrackChanged = () => {
      logRoomVoiceDebug("remote audio track changed", {
        playerId,
        stream: describeVoiceStream(stream),
      })
      playAudio()
    }
    const handlePlaying = () => {
      logRoomVoiceDebug("remote audio playing", {
        playerId,
        readyState: audio.readyState,
        paused: audio.paused,
      })
    }

    const audioTracks = stream.getAudioTracks()
    playAudio()
    audio.addEventListener("loadedmetadata", playAudio)
    audio.addEventListener("canplay", playAudio)
    audio.addEventListener("playing", handlePlaying)
    for (const track of audioTracks) {
      track.addEventListener("mute", handleTrackChanged)
      track.addEventListener("unmute", handleTrackChanged)
      track.addEventListener("ended", handleTrackChanged)
    }

    return () => {
      removeUnlockListeners()
      remoteVoiceAudioElements.delete(audio)
      audio.removeEventListener("loadedmetadata", playAudio)
      audio.removeEventListener("canplay", playAudio)
      audio.removeEventListener("playing", handlePlaying)
      for (const track of audioTracks) {
        track.removeEventListener("mute", handleTrackChanged)
        track.removeEventListener("unmute", handleTrackChanged)
        track.removeEventListener("ended", handleTrackChanged)
      }
      audio.srcObject = null
    }
  }, [playerId, stream])

  return (
    <audio
      ref={audioRef}
      data-player-id={playerId}
      autoPlay
      playsInline
      className="pointer-events-none absolute size-px opacity-0"
    />
  )
}

function PlayerRow({
  player,
  isHost,
  isYou,
}: {
  player: Player
  isHost: boolean
  isYou: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/8 bg-black/20 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {player.name}
          {isYou ? " · You" : ""}
        </p>
        <p className="mt-0.5 text-xs text-white/40">
          Seat {player.seat}
          {isHost ? " · Host" : ""}
        </p>
      </div>
      <span
        className={
          "rounded-full px-2 py-1 text-xs " +
          (player.connected
            ? player.ready || isHost
              ? "bg-emerald-400/12 text-emerald-200"
              : "bg-white/8 text-white/55"
            : "bg-white/5 text-white/30")
        }
      >
        {player.connected
          ? player.ready || isHost
            ? "Ready"
            : "Waiting"
          : "Away"}
      </span>
    </div>
  )
}

function LobbyWaitingRoom({
  room,
  player,
  roomCode,
  connected,
  error,
  isHost,
  currentPlayerReady,
  onReady,
  onStart,
  onCopyInvite,
  onSendChatMessage,
  voice,
}: {
  room: RoomSnapshot | null
  player: Player
  roomCode: string
  connected: boolean
  error: string | null
  isHost: boolean
  currentPlayerReady: boolean
  onReady: (ready: boolean) => void
  onStart: () => void
  onCopyInvite: () => Promise<void>
  onSendChatMessage: (input: SendChatMessageInput) => void
  voice: RoomVoiceController
}) {
  const players = room?.players ?? []
  const seatCount = players.length
  const readyCount = players.filter(
    (candidate) => candidate.ready || candidate.id === room?.hostPlayerId
  ).length
  const everyoneReady = seatCount >= 2 && readyCount === seatCount
  const messages = room?.chatMessages ?? []
  const visibleError = error ?? voice.error

  return (
    <main className="relative h-dvh overflow-hidden bg-[#070604] text-white antialiased">
      <VoiceAudioOutputs streamsByPlayerId={voice.remoteStreamsByPlayerId} />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 38%, rgba(255,210,150,0.10) 0%, rgba(0,0,0,0) 48%), radial-gradient(circle at 50% 78%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 60%)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1500px] flex-col gap-3 px-3 py-3 sm:px-5 sm:py-4 lg:px-8">
        <header className="relative z-40 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-2 sm:pb-3">
          <div>
            <p className="text-[10px] font-medium tracking-[0.18em] text-white/45 uppercase sm:text-xs">
              UNO No Mercy
            </p>
            <h1 className="mt-0.5 text-lg font-semibold tracking-tight sm:mt-1 sm:text-xl">
              Room {roomCode}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <VoiceToggleButton voice={voice} />
            <SoundToggle />
            <StatusDot connected={connected} />
            <div className="lg:hidden">
              <MobileChatSheet
                messages={messages}
                players={players}
                selfPlayerId={player.id}
                error={visibleError}
                onSendMessage={onSendChatMessage}
              />
            </div>
            <CopyInviteButton iconOnly onCopy={onCopyInvite} />
          </div>
        </header>

        <section className="relative z-10 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-none">
          <DimmedTablePreview
            room={room}
            player={player}
            seatCount={seatCount}
            readyCount={readyCount}
            everyoneReady={everyoneReady}
            isHost={isHost}
            currentPlayerReady={currentPlayerReady}
            voiceStates={voice.voiceStates}
            onReady={onReady}
            onStart={onStart}
            onCopyInvite={onCopyInvite}
            error={visibleError}
          />

          <TableChatPanel
            messages={messages}
            players={players}
            selfPlayerId={player.id}
            error={visibleError}
            onSendMessage={onSendChatMessage}
          />
        </section>
      </div>
    </main>
  )
}

function DimmedTablePreview({
  room,
  player,
  seatCount,
  readyCount,
  everyoneReady,
  isHost,
  currentPlayerReady,
  voiceStates,
  onReady,
  onStart,
  onCopyInvite,
  error,
}: {
  room: RoomSnapshot | null
  player: Player
  seatCount: number
  readyCount: number
  everyoneReady: boolean
  isHost: boolean
  currentPlayerReady: boolean
  voiceStates: RoomVoiceController["voiceStates"]
  onReady: (ready: boolean) => void
  onStart: () => void
  onCopyInvite: () => Promise<void>
  error: string | null
}) {
  const players = room?.players ?? []
  const maxPlayers = room?.houseRules.maxPlayers ?? 8
  const narrowViewport = useMediaQuery("(max-width: 680px)")
  const shortViewport = useMediaQuery("(max-height: 760px)")
  const compactSurface = narrowViewport || shortViewport
  const cardSize: ResponsiveCardSize = compactSurface ? "sm" : "md"

  return (
    <div
      className="relative min-h-0 overflow-hidden rounded-2xl border border-white/10 p-2 shadow-[0_30px_90px_rgba(0,0,0,0.5)] sm:rounded-[1.75rem] sm:p-4"
      style={{
        backgroundImage:
          "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0) 18%, rgba(0,0,0,0.32) 62%), repeating-linear-gradient(92deg, rgba(255,255,255,0.018) 0 10px, rgba(0,0,0,0.05) 10px 22px), linear-gradient(90deg, #2d1a0e, #3d2317 38%, #261509)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-black/40 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.32),inset_0_0_0_2px_rgba(255,255,255,0.025),inset_0_24px_80px_rgba(0,0,0,0.6)] sm:rounded-[1.75rem]" />

      <DimmedSeatRing
        players={players}
        hostPlayerId={room?.hostPlayerId ?? null}
        selfPlayerId={player.id}
        voiceStates={voiceStates}
        compact={compactSurface}
      />

      <div className="relative z-10 flex h-full min-h-0 flex-col items-center justify-center gap-6 px-2 py-6 sm:px-6 sm:py-8">
        <div className="grid place-items-center opacity-35 brightness-90 saturate-50 transition-[opacity,filter] duration-500">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-8 lg:gap-12">
            <DimmedDeck size={cardSize} />
            <DimmedDiscardSlot size={cardSize} />
          </div>
        </div>

        <div className="pointer-events-auto relative z-10 flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-white/14 bg-neutral-950/72 px-6 py-5 text-center shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-md sm:px-8 sm:py-6">
          <span
            className={
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold tracking-[0.16em] uppercase " +
              (everyoneReady
                ? "border-amber-200/45 bg-amber-200/15 text-amber-100"
                : "border-white/12 bg-white/[0.06] text-white/60")
            }
          >
            <span
              className={
                "size-1.5 rounded-full " +
                (everyoneReady ? "bg-amber-200" : "bg-white/55")
              }
            />
            {everyoneReady
              ? "Lights are about to come on"
              : "Lights off · Waiting"}
          </span>
          <div>
            <p className="text-xl font-semibold text-white sm:text-2xl">
              {seatCount < 2
                ? "Need at least one more seat"
                : everyoneReady
                  ? "Table is ready"
                  : `${readyCount}/${seatCount} players ready`}
            </p>
            <p className="mt-1.5 text-sm text-white/55">
              {seatCount < 2
                ? "Share the room code so a friend can join."
                : everyoneReady
                  ? isHost
                    ? "Hit start to shuffle and deal."
                    : "Waiting for the host to start the game."
                  : isHost
                    ? "You can start anytime — the rest will catch up."
                    : "Ready up when you're set."}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {!isHost && (
              <Button
                type="button"
                size="sm"
                onClick={() => onReady(!currentPlayerReady)}
                className={
                  currentPlayerReady
                    ? "bg-white/10 text-white hover:bg-white/15"
                    : "bg-white text-neutral-950 hover:bg-white/85"
                }
              >
                <Check />
                {currentPlayerReady ? "Mark not ready" : "Ready up"}
              </Button>
            )}
            {isHost && seatCount < 2 && (
              <CopyInviteButton onCopy={onCopyInvite} />
            )}
            {isHost && seatCount >= 2 && (
              <Button
                type="button"
                size="sm"
                onClick={onStart}
                className="bg-white text-neutral-950 hover:bg-white/85"
              >
                <Play />
                Start game
              </Button>
            )}
            <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] text-white/55">
              {seatCount}/{maxPlayers} seated
            </span>
          </div>

          {error && (
            <p className="w-full rounded-md border border-red-400/25 bg-red-500/12 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function DimmedSeatRing({
  players,
  hostPlayerId,
  selfPlayerId,
  voiceStates,
  compact,
}: {
  players: Array<Player>
  hostPlayerId: string | null
  selfPlayerId: string
  voiceStates: RoomVoiceController["voiceStates"]
  compact: boolean
}) {
  const ordered = orderPlayersAroundSelf(players, selfPlayerId)

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {ordered.map((candidate, index) => {
        const seat = tableSeatPosition(index, ordered.length, compact)
        const isYou = candidate.id === selfPlayerId
        const isHost = candidate.id === hostPlayerId
        const readyOrHost = candidate.ready || isHost
        const voiceState = voiceStates[candidate.id]
        const hasVoiceOn = Boolean(voiceState?.enabled)
        const isMuted = !hasVoiceOn || Boolean(voiceState?.muted)
        const isSpeaking = Boolean(voiceState?.speaking && !isMuted)

        return (
          <div
            key={candidate.id}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            style={{
              left: `${seat.left}%`,
              top: `${seat.top}%`,
              opacity: candidate.connected ? 0.78 : 0.4,
            }}
          >
            <div
              className={
                "relative z-10 flex min-w-[72px] items-center gap-1.5 rounded-xl border px-1.5 py-1.5 backdrop-blur-md sm:min-w-[144px] sm:gap-2 sm:rounded-2xl sm:px-2.5 sm:py-2 " +
                (readyOrHost
                  ? "border-emerald-200/30 bg-emerald-400/10"
                  : "border-white/10 bg-black/45")
              }
              style={{
                boxShadow: readyOrHost
                  ? "0 0 0 1px rgba(110, 231, 183, 0.18), 0 12px 30px rgba(0, 0, 0, 0.35)"
                  : "0 12px 30px rgba(0, 0, 0, 0.32)",
              }}
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.06] text-white/72 sm:size-12">
                <UserRound className="size-5 sm:size-6" strokeWidth={1.8} />
              </div>
              <div className="hidden min-w-0 flex-1 sm:block">
                <p className="truncate text-xs font-semibold text-white/86">
                  {candidate.name}
                  {isYou ? " · You" : ""}
                </p>
                <p className="mt-0.5 text-[11px] text-white/45">
                  {!candidate.connected
                    ? "Away"
                    : readyOrHost
                      ? isHost
                        ? "Host · Ready"
                        : "Ready"
                      : "Waiting"}
                </p>
              </div>
              <span
                className={
                  "rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums sm:px-2 sm:text-[11px] " +
                  (readyOrHost
                    ? "border-emerald-200/35 bg-emerald-400/15 text-emerald-100"
                    : "border-white/12 bg-black/35 text-white/55")
                }
              >
                {readyOrHost ? "✓" : "..."}
              </span>
              <span
                className={
                  "absolute -bottom-2 -left-2 grid size-6 place-items-center rounded-full border bg-neutral-950/95 shadow-[0_8px_18px_rgba(0,0,0,0.28)] transition-[border-color,color] " +
                  (isSpeaking
                    ? "border-emerald-300 text-white"
                    : hasVoiceOn && !isMuted
                      ? "border-white/18 text-white/70"
                      : "border-white/12 text-white/34")
                }
                aria-label={
                  isSpeaking
                    ? "Speaking"
                    : hasVoiceOn && !isMuted
                      ? "Voice on"
                      : "Mic off"
                }
              >
                {hasVoiceOn && !isMuted ? (
                  <Mic className="size-3.5" strokeWidth={2.1} />
                ) : (
                  <MicOff className="size-3.5" strokeWidth={2.1} />
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DimmedDeck({ size }: { size: ResponsiveCardSize }) {
  const compact = size === "sm"
  return (
    <div className="flex flex-col items-center gap-1.5 sm:gap-2">
      <div
        className={
          compact
            ? "relative h-[112px] w-[82px]"
            : "relative h-[178px] w-[128px]"
        }
      >
        {[0, 1, 2, 3].map((layer) => (
          <div
            key={layer}
            className="absolute rounded-xl border border-black/45 bg-neutral-900 shadow-[0_10px_24px_rgba(0,0,0,0.4)]"
            style={{
              inset: `${12 - layer * 3}px ${layer * 3}px ${layer * 3}px ${12 - layer * 3}px`,
              transform: `translate(${layer * 3}px, ${layer * -3}px)`,
            }}
          />
        ))}
        <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <UnoCard card={cardBackPlaceholder} faceDown size={size} static />
        </div>
      </div>
      <p className="text-[11px] text-white/40 sm:text-xs">Deck · sleeping</p>
    </div>
  )
}

function DimmedDiscardSlot({ size }: { size: ResponsiveCardSize }) {
  const compact = size === "sm"
  return (
    <div className="flex flex-col items-center gap-1.5 sm:gap-2">
      <div
        className={
          compact
            ? "h-[112px] w-[82px] rounded-xl border border-dashed border-white/10 bg-black/25"
            : "h-[178px] w-[128px] rounded-xl border border-dashed border-white/10 bg-black/25"
        }
      />
      <p className="text-[11px] text-white/40 sm:text-xs">Discard · empty</p>
    </div>
  )
}

function SoundToggle({ compact = false }: { compact?: boolean }) {
  const { enabled, setEnabled } = useSoundSystem()
  const haptic = useWebHaptics()

  const handleClick = () => {
    const next = !enabled
    setEnabled(next)
    haptic.trigger("light")
    if (next) playFx("buttonSoft", { volume: 0.5 })
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={enabled ? "Mute sound effects" : "Unmute sound effects"}
        title={enabled ? "Mute sound effects" : "Unmute sound effects"}
        className={
          "inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,scale] active:scale-[0.96] " +
          (enabled
            ? "border-white/10 bg-white/[0.045] text-white/74 hover:border-white/18 hover:bg-white/[0.075] hover:text-white/88"
            : "border-white/10 bg-black/30 text-white/45 hover:text-white/65")
        }
      >
        {enabled ? (
          <Volume2 className="size-4" strokeWidth={1.9} />
        ) : (
          <VolumeX className="size-4" strokeWidth={1.9} />
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={enabled ? "Mute sound effects" : "Unmute sound effects"}
      title={enabled ? "Mute sound effects" : "Unmute sound effects"}
      className={
        "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-[background-color,border-color,color] sm:h-8 sm:px-3 sm:text-xs " +
        (enabled
          ? "border-white/15 bg-white/[0.06] text-white/72 hover:border-white/25 hover:bg-white/[0.1] hover:text-white"
          : "border-white/10 bg-black/30 text-white/45 hover:text-white/65")
      }
    >
      {enabled ? (
        <Volume2 className="size-3.5" strokeWidth={1.9} />
      ) : (
        <VolumeX className="size-3.5" strokeWidth={1.9} />
      )}
      <span className="hidden sm:inline">{enabled ? "Sound on" : "Muted"}</span>
    </button>
  )
}

function GameStartIntro({
  room,
  selfPlayerId,
  phase,
  onPhaseChange,
  onFinish,
}: {
  room: RoomSnapshot
  selfPlayerId: string
  phase: "idle" | "lights" | "shuffle" | "deal" | "done"
  onPhaseChange: (
    phase: "idle" | "lights" | "shuffle" | "deal" | "done"
  ) => void
  onFinish: () => void
}) {
  const compact = useMediaQuery("(max-width: 680px)")
  const [dealtTokens, setDealtTokens] = useState<
    Array<{ id: number; left: number; top: number; delay: number }>
  >([])
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1200 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  }))
  const playedShuffleRef = useRef(false)
  const playedDealRef = useRef(false)

  const orderedPlayers = useMemo(
    () => orderPlayersAroundSelf(room.players, selfPlayerId),
    [room.players, selfPlayerId]
  )
  const handSize = room.houseRules.startingHandSize ?? 7

  useEffect(() => {
    if (typeof window === "undefined") return
    function update() {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  useEffect(() => {
    if (phase !== "lights") return
    const timer = window.setTimeout(() => onPhaseChange("shuffle"), 520)
    return () => window.clearTimeout(timer)
  }, [phase, onPhaseChange])

  useEffect(() => {
    if (phase !== "shuffle") return
    if (!playedShuffleRef.current) {
      playedShuffleRef.current = true
      playShuffleSound()
    }
    const timer = window.setTimeout(() => onPhaseChange("deal"), 720)
    return () => window.clearTimeout(timer)
  }, [phase, onPhaseChange])

  useEffect(() => {
    if (phase !== "deal") return
    const tokens: Array<{
      id: number
      left: number
      top: number
      delay: number
    }> = []
    let nextId = 0
    for (let round = 0; round < handSize; round += 1) {
      orderedPlayers.forEach((_, seatIndex) => {
        const seat = tableSeatPosition(
          seatIndex,
          orderedPlayers.length,
          compact
        )
        tokens.push({
          id: nextId++,
          left: seat.left,
          top: seat.top,
          delay: round * 140 + seatIndex * 30,
        })
      })
    }
    setDealtTokens(tokens)

    if (!playedDealRef.current) {
      playedDealRef.current = true
      const dealSoundCount = Math.min(handSize * orderedPlayers.length, 7)
      for (let index = 0; index < dealSoundCount; index += 1) {
        window.setTimeout(
          () => playCardSound("draw", 1),
          index * Math.max(120, 180 - dealSoundCount * 8)
        )
      }
    }

    const total = tokens.length
    const longest = total > 0 ? tokens[total - 1].delay + 520 : 600
    const timer = window.setTimeout(() => {
      onPhaseChange("done")
      onFinish()
    }, longest)
    return () => window.clearTimeout(timer)
  }, [phase, handSize, orderedPlayers, compact, onPhaseChange, onFinish])

  if (phase === "idle" || phase === "done") return null

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
      aria-hidden="true"
    >
      <style>
        {`
          @keyframes uno-intro-lights {
            0% { opacity: 0.86; }
            100% { opacity: 0; }
          }
          @keyframes uno-intro-shuffle-a {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            25% { transform: translate(-46px, -10px) rotate(-12deg); }
            50% { transform: translate(38px, -8px) rotate(10deg); }
            75% { transform: translate(-22px, 6px) rotate(-6deg); }
          }
          @keyframes uno-intro-shuffle-b {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            25% { transform: translate(48px, -6px) rotate(14deg); }
            50% { transform: translate(-44px, 8px) rotate(-11deg); }
            75% { transform: translate(20px, -4px) rotate(7deg); }
          }
          @keyframes uno-intro-deal {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.65) rotate(-12deg); }
            12% { opacity: 1; }
            70% { opacity: 1; }
            100% { opacity: 0; transform: translate(calc(-50% + var(--uno-dx)), calc(-50% + var(--uno-dy))) scale(0.9) rotate(8deg); }
          }
        `}
      </style>

      {phase === "lights" && (
        <div
          className="absolute inset-0 bg-black"
          style={{ animation: "uno-intro-lights 520ms ease-out forwards" }}
        />
      )}

      {phase === "shuffle" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-[180px] w-[130px]">
            <div
              className="absolute inset-0 rounded-xl border border-black/45 bg-neutral-950 shadow-[0_18px_42px_rgba(0,0,0,0.55)]"
              style={{ animation: "uno-intro-shuffle-a 720ms ease-in-out" }}
            />
            <div
              className="absolute inset-0 rounded-xl border border-black/45 bg-neutral-900 shadow-[0_18px_42px_rgba(0,0,0,0.55)]"
              style={{
                animation: "uno-intro-shuffle-b 720ms ease-in-out",
                animationDelay: "80ms",
              }}
            />
            <div
              className="absolute inset-0 rounded-xl border border-black/45 bg-neutral-950 shadow-[0_18px_42px_rgba(0,0,0,0.55)]"
              style={{
                animation: "uno-intro-shuffle-a 720ms ease-in-out",
                animationDelay: "140ms",
              }}
            />
          </div>
        </div>
      )}

      {phase === "deal" && (
        <>
          {dealtTokens.map((token) => {
            const dx = ((token.left - 50) * viewport.width) / 100
            const dy = ((token.top - 50) * viewport.height) / 100
            return (
              <div
                key={token.id}
                className="absolute top-1/2 left-1/2"
                style={{
                  width: compact ? 56 : 76,
                  height: compact ? 80 : 108,
                  marginLeft: compact ? -28 : -38,
                  marginTop: compact ? -40 : -54,
                  borderRadius: 10,
                  background:
                    "linear-gradient(140deg, #1a1a1a, #2a2a2a 40%, #0a0a0a)",
                  boxShadow:
                    "0 14px 28px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.06)",
                  ["--uno-dx" as string]: `${dx}px`,
                  ["--uno-dy" as string]: `${dy}px`,
                  animation: `uno-intro-deal 520ms cubic-bezier(0.22, 0.9, 0.18, 1) ${token.delay}ms forwards`,
                  opacity: 0,
                  zIndex: 30 + token.id,
                }}
              />
            )
          })}
        </>
      )}
    </div>
  )
}

function RouletteFlyToHand({
  cards,
  targetPlayerId,
  isSelfTarget,
  startDelayMs = 0,
  onFlightStart,
  onDone,
}: {
  cards: Array<Card>
  targetPlayerId: string
  isSelfTarget: boolean
  startDelayMs?: number
  onFlightStart?: () => void
  onDone: () => void
}) {
  const [layout, setLayout] = useState<{
    source: { left: number; top: number; width: number; height: number }
    dest: { left: number; top: number }
  } | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (cards.length === 0) {
      onDone()
      return
    }

    const timer = window.setTimeout(() => {
      const sourceEl = document.querySelector<HTMLElement>(
        "[data-roulette-source='true']"
      )
      const handEl = isSelfTarget
        ? document.querySelector<HTMLElement>("[data-self-hand='true']")
        : null
      const destEl =
        handEl ??
        document.querySelector<HTMLElement>(
          `[data-seat-player-id="${CSS.escape(targetPlayerId)}"]`
        )

      const sourceRect = sourceEl?.getBoundingClientRect()
      const destRect = destEl?.getBoundingClientRect()

      const fallbackSource = {
        left: window.innerWidth / 2 - 160,
        top: window.innerHeight / 2 - 60,
        width: 320,
        height: 120,
      }
      const fallbackDest = isSelfTarget
        ? { left: window.innerWidth / 2, top: window.innerHeight - 120 }
        : { left: window.innerWidth / 2, top: window.innerHeight * 0.18 }

      setLayout({
        source: sourceRect
          ? {
              left: sourceRect.left,
              top: sourceRect.top,
              width: sourceRect.width,
              height: sourceRect.height,
            }
          : fallbackSource,
        dest: destRect
          ? {
              left: destRect.left + destRect.width / 2,
              top: isSelfTarget
                ? destRect.bottom - Math.min(destRect.height * 0.32, 72)
                : destRect.top + destRect.height / 2,
            }
          : fallbackDest,
      })
      onFlightStart?.()
    }, startDelayMs)

    return () => window.clearTimeout(timer)
  }, [cards, targetPlayerId, isSelfTarget, startDelayMs, onFlightStart, onDone])

  useEffect(() => {
    if (!layout) return
    if (cards.length === 0) return

    const stagger = 90
    const flightDuration = 620
    const totalMs = (cards.length - 1) * stagger + flightDuration + 60

    const timer = window.setTimeout(onDone, totalMs)
    return () => window.clearTimeout(timer)
  }, [layout, cards, onDone])

  if (!layout) return null

  const half = (cards.length - 1) / 2
  const cardWidth = 84
  const cardHeight = 118
  const gap = Math.min(
    38,
    Math.max(22, layout.source.width / Math.max(cards.length, 1))
  )
  const stagger = 90

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60]"
      aria-hidden="true"
    >
      <style>
        {`
          @keyframes uno-roulette-fly {
            0% {
              opacity: 1;
              transform: translate(-50%, -50%) translate(var(--uno-roulette-from-x), var(--uno-roulette-from-y)) rotate(var(--uno-roulette-from-rot)) scale(1);
            }
            18% {
              transform: translate(-50%, -50%) translate(var(--uno-roulette-from-x), calc(var(--uno-roulette-from-y) - 22px)) rotate(var(--uno-roulette-from-rot)) scale(1.04);
            }
            65% {
              opacity: 1;
            }
            100% {
              opacity: 0.05;
              transform: translate(-50%, -50%) translate(var(--uno-roulette-to-x), var(--uno-roulette-to-y)) rotate(var(--uno-roulette-to-rot)) scale(0.42);
            }
          }
        `}
      </style>

      {cards.map((card, index) => {
        const offset = index - half
        const fromX =
          layout.source.left + layout.source.width / 2 + offset * gap
        const fromY = layout.source.top + layout.source.height / 2
        const fromRot = offset * 4
        const toX = layout.dest.left
        const toY = layout.dest.top
        const toRot = (offset > 0 ? 12 : -12) + offset * 2
        const delay = index * stagger

        return (
          <div
            key={card.id}
            className="absolute top-0 left-0"
            style={{
              width: cardWidth,
              height: cardHeight,
              ["--uno-roulette-from-x" as string]: `${fromX}px`,
              ["--uno-roulette-from-y" as string]: `${fromY}px`,
              ["--uno-roulette-from-rot" as string]: `${fromRot}deg`,
              ["--uno-roulette-to-x" as string]: `${toX}px`,
              ["--uno-roulette-to-y" as string]: `${toY}px`,
              ["--uno-roulette-to-rot" as string]: `${toRot}deg`,
              animation: `uno-roulette-fly 620ms cubic-bezier(0.32, 0.72, 0.24, 1) ${delay}ms forwards`,
              opacity: 0,
              zIndex: 60 + index,
              willChange: "transform, opacity",
            }}
          >
            <UnoCard card={card} size="sm" static />
          </div>
        )
      })}
    </div>
  )
}

function DeckDrawFlight({
  targetPlayerId,
  cardCount,
  onDone,
}: {
  targetPlayerId: string
  cardCount: number
  onDone: () => void
}) {
  const [layout, setLayout] = useState<{
    source: { left: number; top: number }
    dest: { left: number; top: number }
  } | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(onDone, 180)
      return () => window.clearTimeout(timer)
    }

    const sourceEl = document.querySelector<HTMLElement>(
      "[data-draw-pile='true']"
    )
    const destEl = document.querySelector<HTMLElement>(
      `[data-seat-player-id="${CSS.escape(targetPlayerId)}"]`
    )
    const sourceRect = sourceEl?.getBoundingClientRect()
    const destRect = destEl?.getBoundingClientRect()

    setLayout({
      source: sourceRect
        ? {
            left: sourceRect.left + sourceRect.width / 2,
            top: sourceRect.top + Math.min(sourceRect.height * 0.34, 70),
          }
        : {
            left: window.innerWidth / 2 - 90,
            top: window.innerHeight / 2,
          },
      dest: destRect
        ? {
            left: destRect.left + destRect.width / 2,
            top: destRect.top + destRect.height / 2,
          }
        : {
            left: window.innerWidth / 2,
            top: window.innerHeight * 0.18,
          },
    })
  }, [targetPlayerId, onDone])

  useEffect(() => {
    if (!layout) return
    const visibleCount = Math.min(Math.max(cardCount, 1), 10)
    const stagger = visibleCount > 6 ? 52 : 68
    const timer = window.setTimeout(onDone, (visibleCount - 1) * stagger + 660)
    return () => window.clearTimeout(timer)
  }, [layout, cardCount, onDone])

  if (!layout) return null

  const visibleCount = Math.min(Math.max(cardCount, 1), 10)
  const stagger = visibleCount > 6 ? 52 : 68

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[58]"
      aria-hidden="true"
    >
      <style>
        {`
          @keyframes uno-deck-draw-flight {
            0% {
              opacity: 0;
              transform: translate(-50%, -50%) translate(var(--uno-draw-from-x), var(--uno-draw-from-y)) rotate(var(--uno-draw-rot-start)) scale(0.72);
            }
            12% {
              opacity: 1;
              transform: translate(-50%, -50%) translate(var(--uno-draw-from-x), calc(var(--uno-draw-from-y) - 18px)) rotate(var(--uno-draw-rot-start)) scale(0.9);
            }
            70% {
              opacity: 1;
            }
            100% {
              opacity: 0;
              transform: translate(-50%, -50%) translate(var(--uno-draw-to-x), var(--uno-draw-to-y)) rotate(var(--uno-draw-rot-end)) scale(0.28);
            }
          }
        `}
      </style>

      {Array.from({ length: visibleCount }, (_, index) => {
        const offset = index - (visibleCount - 1) / 2
        return (
          <div
            key={index}
            className="absolute top-0 left-0"
            style={{
              ["--uno-draw-from-x" as string]: `${layout.source.left + offset * 2}px`,
              ["--uno-draw-from-y" as string]: `${layout.source.top + offset * -1}px`,
              ["--uno-draw-to-x" as string]: `${layout.dest.left}px`,
              ["--uno-draw-to-y" as string]: `${layout.dest.top}px`,
              ["--uno-draw-rot-start" as string]: `${offset * 3}deg`,
              ["--uno-draw-rot-end" as string]: `${offset > 0 ? 14 : -14}deg`,
              animation: `uno-deck-draw-flight 580ms cubic-bezier(0.3, 0.72, 0.18, 1) ${
                index * stagger
              }ms forwards`,
              opacity: 0,
              zIndex: 58 + index,
              willChange: "transform, opacity",
            }}
          >
            <UnoCard card={cardBackPlaceholder} faceDown size="sm" static />
          </div>
        )
      })}
    </div>
  )
}
