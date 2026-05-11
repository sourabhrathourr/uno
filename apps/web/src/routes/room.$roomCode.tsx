import { createFileRoute } from "@tanstack/react-router"
import confetti from "canvas-confetti"
import type {
  CreateTypes as ConfettiInstance,
  Options as ConfettiOptions,
} from "canvas-confetti"
import {
  ArrowRight,
  Check,
  Clipboard,
  Circle,
  Play,
  RotateCw,
  Trophy,
  UserRound,
  UsersRound,
} from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

import type {
  Card,
  GameError,
  Player,
  PlayerGameSnapshot,
  PlayCardsInput,
  PlayColor,
  RoomSnapshot,
} from "@workspace/game"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { UnoCard } from "@workspace/ui/components/uno-card"

import { getGameSocket, getRoomPreview, type GameSocket } from "@/lib/realtime"
import {
  getActiveRoomCode,
  getPlayerSessionId,
  getSavedPlayerName,
  saveActiveRoomCode,
  savePlayerName,
} from "@/lib/session"

type ResponsiveCardSize = "sm" | "md"

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
  const roomRef = useRef<RoomSnapshot | null>(null)
  const playerRef = useRef<Player | null>(null)

  const normalizedRoomCode = roomCode.toUpperCase()
  const isHost = room?.hostPlayerId === player?.id
  const currentPlayer = room?.players.find((candidate) => candidate.id === player?.id)

  function applyRoomSnapshot(nextRoom: RoomSnapshot | null) {
    roomRef.current = nextRoom
    setRoom(nextRoom)
  }

  function applyPlayer(nextPlayer: Player | null) {
    playerRef.current = nextPlayer
    setPlayer(nextPlayer)
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
  }

  function isActiveTurnPlayer() {
    return Boolean(roomRef.current?.game?.turnPlayerId === playerRef.current?.id)
  }

  useEffect(() => {
    const activeSocket = getGameSocket()
    setSocket(activeSocket)

    function handleSnapshot(snapshot: RoomSnapshot) {
      if (snapshot.code !== normalizedRoomCode) return
      applyRoomSnapshot(snapshot)
    }

    function handlePlayerState(snapshot: PlayerGameSnapshot) {
      if (snapshot.playerId !== playerRef.current?.id) return
      setPlayerGame(snapshot)
    }

    function handleError(nextError: GameError) {
      applyCommandError(nextError)
    }

    function handleConnect() {
      setConnected(true)
    }

    function handleDisconnect() {
      setConnected(false)
    }

    activeSocket.on("room:snapshot", handleSnapshot)
    activeSocket.on("game:playerState", handlePlayerState)
    activeSocket.on("room:error", handleError)
    activeSocket.on("connect", handleConnect)
    activeSocket.on("disconnect", handleDisconnect)

    setConnected(activeSocket.connected)

    return () => {
      activeSocket.off("room:snapshot", handleSnapshot)
      activeSocket.off("game:playerState", handlePlayerState)
      activeSocket.off("room:error", handleError)
      activeSocket.off("connect", handleConnect)
      activeSocket.off("disconnect", handleDisconnect)
    }
  }, [normalizedRoomCode])

  useEffect(() => {
    let cancelled = false
    applyRoomSnapshot(null)
    applyPlayer(null)
    setPlayerGame(null)
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
      } catch {
        if (cancelled) return
        setLoadingPreview(false)
        setError("Could not reach the game server on localhost:4001.")
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
    const cleanName = nextName.trim()
    if (!cleanName) {
      setError("Enter a name to join this room.")
      return
    }

    setJoining(true)
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
        setJoining(false)
        if (!result.ok) {
          setError(result.error.message)
          return
        }

        saveActiveRoomCode(result.data.room.code)
        applyRoomSnapshot(result.data.room)
        applyPlayer(result.data.player)
      },
    )
  }

  function setReady(ready: boolean) {
    if (!socket) return
    setError(null)
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
    socket.emit("room:start", (result) => {
      if (!result.ok) {
        applyCommandError(result.error)
        return
      }

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

  function stageCards(cardIds: string[]) {
    if (!socket || !isActiveTurnPlayer()) return
    socket.emit("game:stageCards", { cardIds }, (result) => {
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
    await window.navigator.clipboard.writeText(window.location.href)
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

  if ((room?.status === "playing" || room?.status === "finished") && !room.game) {
    return (
      <main className="grid min-h-svh place-items-center bg-neutral-950 px-6 text-white antialiased">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5 text-sm text-white/62">
          Loading game state...
        </div>
      </main>
    )
  }

  if ((room?.status === "playing" || room?.status === "finished") && room.game) {
    return (
      <GameTable
        room={room}
        player={player}
        playerGame={playerGame?.playerId === player.id ? playerGame : null}
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
      />
    )
  }

  return (
    <main className="min-h-svh bg-neutral-950 text-white antialiased">
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-white/45 uppercase">
              UNO No Mercy
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Room {roomCode.toUpperCase()}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <StatusDot connected={connected} />
            <CopyInviteButton onCopy={copyInvite} />
          </div>
        </header>

        <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-medium">Lobby</h2>
                <p className="mt-1 text-sm text-white/50">
                  Share the code or invite link while everyone gets ready.
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm">
                {normalizedRoomCode}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {!isHost && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setReady(!currentPlayer?.ready)}
                  className="bg-white text-neutral-950 hover:bg-white/85"
                >
                  <Check />
                  {currentPlayer?.ready ? "Mark not ready" : "Ready up"}
                </Button>
              )}
              {isHost && (
                <Button
                  type="button"
                  size="sm"
                  onClick={startGame}
                  className="bg-white text-neutral-950 hover:bg-white/85"
                >
                  <Play />
                  Start game
                </Button>
              )}
            </div>

            {error && (
              <p className="mt-4 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            )}
          </div>

          <aside className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center gap-2">
              <UsersRound className="size-4 text-white/60" />
              <h2 className="text-base font-medium">
                Players {room ? `${room.players.length}/${room.houseRules.maxPlayers}` : ""}
              </h2>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {room?.players.map((candidate) => (
                <PlayerRow
                  key={candidate.id}
                  player={candidate}
                  isHost={candidate.id === room.hostPlayerId}
                  isYou={candidate.id === player?.id}
                />
              )) ?? <p className="text-sm text-white/45">Join to load this room.</p>}
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}

function GameTable({
  room,
  player,
  playerGame,
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
}: {
  room: RoomSnapshot
  player: Player
  playerGame: PlayerGameSnapshot | null
  connected: boolean
  error: string | null
  onCopyInvite: () => Promise<void>
  onPlayCards: (input: PlayCardsInput) => void
  onStageCards: (cardIds: string[]) => void
  onDrawCard: () => void
  onEndTurn: () => void
  onTakePenalty: () => void
  onDrawRouletteCard: () => void
  onCatchUno: (targetPlayerId: string) => void
}) {
  const game = room.game
  const tableDropRef = useRef<HTMLDivElement | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [declaredUno, setDeclaredUno] = useState(false)
  const [chosenColor, setChosenColor] = useState<PlayColor | null>(null)
  const [wantsSwap, setWantsSwap] = useState(false)
  const [wantsRotate, setWantsRotate] = useState(false)
  const [swapWithPlayerId, setSwapWithPlayerId] = useState<string>("")
  const [discardCardIds, setDiscardCardIds] = useState<string[]>([])
  const [discardTopCardId, setDiscardTopCardId] = useState<string>("")
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [tableDragActive, setTableDragActive] = useState(false)
  const [celebratingWinnerId, setCelebratingWinnerId] = useState<string | null>(null)
  const celebratedWinnerIdsRef = useRef(new Set<string>())
  const narrowViewport = useMediaQuery("(max-width: 680px)")
  const shortViewport = useMediaQuery("(max-height: 760px)")
  const compactSurface = narrowViewport || shortViewport
  const tableCardSize: ResponsiveCardSize = compactSurface ? "sm" : "md"
  const handCardSize: ResponsiveCardSize = compactSurface ? "sm" : "md"

  const selectedCards = useMemo(
    () => cardsInIdOrder(playerGame?.hand ?? [], selectedCardIds),
    [playerGame?.hand, selectedCardIds],
  )
  const playableCardIds = playerGame?.playableCardIds ?? []
  const activeOpponents =
    room.players.filter((candidate) => {
      const state = game?.players.find(
        (gamePlayer) => gamePlayer.playerId === candidate.id,
      )
      return candidate.id !== player.id && !state?.eliminated && !state?.winnerPlacement
    }) ?? []
  const isMyTurn = game?.turnPlayerId === player.id
  const firstWinnerPlacement =
    game?.winnerPlacements.find((placement) => placement.position === 1) ?? null
  const firstWinner = room.players.find(
    (candidate) => candidate.id === firstWinnerPlacement?.playerId,
  )
  const celebratingWinner = room.players.find(
    (candidate) => candidate.id === celebratingWinnerId,
  )
  const gameFinished = Boolean(game && game.turnPlayerId === null)
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
    selectedCards.length === 1 && selectedCards[0]?.face.kind === "discard-color"
      ? selectedCards[0]
      : null
  const discardCandidates = useMemo(
    () =>
      discardActionCard
        ? (playerGame?.hand ?? []).filter(
            (card) =>
              card.id !== discardActionCard.id &&
              card.color === discardActionCard.color,
          )
        : [],
    [discardActionCard?.id, discardActionCard?.color, playerGame?.hand],
  )
  const discardTopChoices = useMemo(
    () =>
      discardActionCard
        ? cardsInIdOrder([discardActionCard, ...discardCandidates], [
            discardActionCard.id,
            ...discardCardIds,
          ])
        : [],
    [discardActionCard, discardCandidates, discardCardIds],
  )
  const needsSwap = canChooseSwap && wantsSwap
  const selectedCardsCanPlay = canPlayStagedCards(
    selectedCards,
    playableCardIds,
    drawStack,
  )
  const remainingAfterPlay =
    (playerGame?.hand.length ?? 0) -
    selectedCards.length -
    (discardActionCard ? discardCardIds.length : 0)
  const canDeclareUno =
    Boolean(isMyTurn) &&
    selectedCards.length > 0 &&
    selectedCardsCanPlay &&
    remainingAfterPlay === 1
  const canSubmitPlay =
    Boolean(isMyTurn) &&
    selectedCardsCanPlay &&
    (!needsColor || Boolean(chosenColor)) &&
    (!needsSwap || Boolean(swapWithPlayerId))
  const canPassTurn =
    Boolean(isMyTurn) && Boolean(playerGame?.canEndTurn) && selectedCardIds.length === 0
  const canUseEndTurnButton = selectedCardIds.length > 0 ? canSubmitPlay : canPassTurn
  const localStagedPlayActive = Boolean(isMyTurn && selectedCards.length > 0)
  const tableStagedCards = localStagedPlayActive
    ? selectedCards
    : game?.stagedPlay?.cards ?? []
  const tableStagedPlayerId = localStagedPlayActive
    ? player.id
    : game?.stagedPlay?.playerId ?? null
  const tableStagedPlayerName = tableStagedPlayerId
    ? playerName(room, tableStagedPlayerId)
    : null
  const tableStagedMode =
    (game?.stagedPlay?.kind === "roulette" && !localStagedPlayActive) ||
    (rouletteChoice && tableStagedPlayerId === rouletteChoice.playerId)
      ? "roulette"
      : "stage"
  const canEditTableStaged =
    tableStagedMode === "stage" && tableStagedPlayerId === player.id && Boolean(isMyTurn)

  useEffect(() => {
    setSelectedCardIds((current) =>
      current.filter((cardId) => playerGame?.hand.some((card) => card.id === cardId)),
    )
  }, [playerGame?.hand])

  useEffect(() => {
    if (!isMyTurn) setSelectedCardIds([])
  }, [isMyTurn])

  useEffect(() => {
    setChosenColor(null)
    setSwapWithPlayerId("")
    setWantsSwap(false)
    setWantsRotate(false)
    setDeclaredUno(false)
    setDiscardCardIds([])
    setDiscardTopCardId("")
  }, [selectedCardIds.join(":")])

  useEffect(() => {
    if (!canDeclareUno && declaredUno) setDeclaredUno(false)
  }, [canDeclareUno, declaredUno])

  useEffect(() => {
    if (!discardActionCard) return
    setDiscardCardIds((current) =>
      keepSameStringArrayReference(
        current,
        current.filter((cardId) =>
          discardCandidates.some((card) => card.id === cardId),
        ),
      ),
    )
  }, [discardActionCard?.id, discardCandidates])

  useEffect(() => {
    if (!discardActionCard) return
    if (
      discardTopCardId &&
      !discardTopChoices.some((card) => card.id === discardTopCardId)
    ) {
      setDiscardTopCardId("")
    }
  }, [discardActionCard?.id, discardTopCardId, discardTopChoices])

  useEffect(() => {
    if (!isMyTurn) return
    onStageCards(selectedCardIds)
  }, [selectedCardIds.join(":"), isMyTurn])

  useEffect(() => {
    if (!firstWinnerPlacement) return
    if (celebratedWinnerIdsRef.current.has(firstWinnerPlacement.playerId)) return

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
      drawStack,
    )
  }

  function toggleSelected(card: Card) {
    setSelectedCardIds((current) =>
      current.includes(card.id)
        ? current.filter((cardId) => cardId !== card.id)
        : canStageCard(card)
          ? [...current, card.id]
          : current,
    )
  }

  function stageCard(card: Card) {
    if (!canStageCard(card)) return
    setSelectedCardIds((current) =>
      current.includes(card.id) ? current : [...current, card.id],
    )
  }

  function toggleDiscardCard(card: Card) {
    setDiscardCardIds((current) =>
      current.includes(card.id)
        ? current.filter((cardId) => cardId !== card.id)
        : [...current, card.id],
    )
  }

  function updatePointerDragTarget(clientX: number, clientY: number) {
    const rect = tableDropRef.current?.getBoundingClientRect()
    if (!rect) return

    setTableDragActive(
      clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom,
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
    onPlayCards({
      cardIds: selectedCardIds,
      declaredUno: canDeclareUno && declaredUno,
      chosenColor: chosenColor ?? undefined,
      discardCardIds: discardActionCard ? discardCardIds : undefined,
      topCardId: discardActionCard
        ? discardTopCardId || discardActionCard.id
        : undefined,
      swapWithPlayerId: needsSwap ? swapWithPlayerId : undefined,
      rotateHands: canChooseRotate && wantsRotate ? true : undefined,
    })
    setSelectedCardIds([])
  }

  function handleEndTurnButton() {
    if (selectedCardIds.length > 0) {
      submitPlay()
      return
    }
    if (canPassTurn) onEndTurn()
  }

  return (
    <main className="h-dvh overflow-hidden bg-[#070604] text-white antialiased">
      {celebratingWinner && (
        <FirstPlaceCelebration playerName={celebratingWinner.name} />
      )}
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
            <StatusDot connected={connected} />
            <CopyInviteButton onCopy={onCopyInvite} />
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-2 overflow-hidden lg:grid-rows-[minmax(0,1fr)_132px] xl:grid-cols-[minmax(0,1fr)_310px] xl:grid-rows-none">
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
                onTakeDrawPenalty={onTakePenalty}
                compact={compactSurface}
              />
              <div className="relative z-10 flex h-full min-h-0 flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {gameFinished && firstWinner
                        ? `${firstWinner.name} won this hand`
                        : isMyTurn
                          ? "Your turn"
                          : `${playerName(room, game?.turnPlayerId)} is playing`}
                    </p>
                    <p className="mt-1 text-xs text-white/65">
                      {game?.drawStack
                        ? `Draw stack is +${game.drawStack.amount}. Stack +${game.drawStack.minimum} or higher.`
                        : `${game?.discardPileCount ?? 0} cards discarded`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                    <span className="rounded-full border border-white/10 bg-black/28 px-2.5 py-1.5 text-[11px] font-medium text-white/60 sm:px-3 sm:py-2 sm:text-xs">
                      {room.players.length}/{room.houseRules.maxPlayers} seated
                    </span>
                    <DirectionPill direction={game?.direction ?? 1} compact />
                    <ColorPill color={game?.currentColor ?? "red"} />
                    {rouletteChoice && (
                      <div className="flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-300/12 py-1 pr-1 pl-3 text-xs text-amber-50 shadow-[0_10px_26px_rgba(0,0,0,0.22)] backdrop-blur-md">
                        <span className="flex items-center gap-1.5">
                          {rouletteTargetName} draws until
                          <span
                            className="size-2.5 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.22)]"
                            style={{ background: colorValue(rouletteChoice.color) }}
                          />
                          {rouletteChoice.color}
                        </span>
                        {canDrawRoulette && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={onDrawRouletteCard}
                            className="h-7 rounded-full bg-amber-100 px-3 text-xs text-amber-950 hover:bg-amber-50"
                          >
                            Draw card
                          </Button>
                        )}
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
                        onDraw={onDrawCard}
                      />
                      <DiscardStack card={game?.topDiscard ?? null} size={tableCardSize} />
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
              {error && (
                <p className="pointer-events-auto rounded-md border border-red-400/20 bg-red-500/12 px-3 py-2 text-sm text-red-100 shadow-[0_18px_44px_rgba(0,0,0,0.26)] backdrop-blur-md xl:hidden">
                  {error}
                </p>
              )}

              {playerGame?.catchablePlayerIds.length ? (
                <div className="pointer-events-auto flex flex-wrap gap-2 rounded-lg border border-yellow-300/20 bg-yellow-300/10 p-3 backdrop-blur-md">
                  {playerGame.catchablePlayerIds.map((targetPlayerId) => (
                    <Button
                      key={targetPlayerId}
                      type="button"
                      size="sm"
                      onClick={() => onCatchUno(targetPlayerId)}
                      className="bg-yellow-100 text-yellow-950 hover:bg-yellow-50"
                    >
                      Catch {playerName(room, targetPlayerId)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/35 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.25)] sm:rounded-2xl sm:p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white/82">Your hand</p>
                  <p className="mt-0.5 text-xs text-white/42 sm:mt-1">
                    Drag cards to the table, then end your turn.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {needsColor && (
                    <ColorPicker value={chosenColor} onChange={setChosenColor} />
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
                      onChange={(event) => setSwapWithPlayerId(event.target.value)}
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
              </div>

              {discardActionCard && (
                <DiscardOptionsPanel
                  candidates={discardCandidates}
                  selectedCardIds={discardCardIds}
                  topChoices={discardTopChoices}
                  topCardId={discardTopCardId || discardActionCard.id}
                  onToggleCard={toggleDiscardCard}
                  onTopCard={setDiscardTopCardId}
                />
              )}

              <FannedGameHand
                cards={playerGame?.hand ?? []}
                playableCardIds={playerGame?.playableCardIds ?? []}
                selectedCardIds={selectedCardIds}
                isMyTurn={Boolean(isMyTurn)}
                drawStack={drawStack}
                onToggleCard={toggleSelected}
                onDragStart={setDraggingCardId}
                onDragMove={updatePointerDragTarget}
                onDragEnd={finishPointerDrag}
                onCancelDrag={() => {
                  setDraggingCardId(null)
                  setTableDragActive(false)
                }}
                cardSize={handCardSize}
              />
            </div>
          </div>

          <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-3 lg:flex xl:p-4">
            <h2 className="text-sm font-medium text-white/82">Trace</h2>
            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {game?.events
                .slice()
                .reverse()
                .map((event) => (
                  <div
                    key={event.id}
                    className="rounded-md border border-white/8 bg-black/20 px-3 py-2"
                  >
                    <p className="text-sm text-white/72">{event.message}</p>
                  </div>
                ))}
            </div>
            {error && (
              <p className="mt-3 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            )}
          </aside>
        </section>
      </div>
    </main>
  )
}

function FirstPlaceCelebration({ playerName }: { playerName: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <SideCannonConfetti />
      <style>
        {`
          @keyframes uno-trophy-pop {
            0% { opacity: 0; transform: translate(-50%, -8px) scale(0.78); }
            16% { opacity: 1; transform: translate(-50%, 0) scale(1.08); }
            28% { transform: translate(-50%, 0) scale(1); }
            82% { opacity: 1; transform: translate(-50%, 0) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -8px) scale(0.94); }
          }
        `}
      </style>

      <div
        className="absolute left-1/2 top-[18%] flex min-w-[280px] -translate-x-1/2 items-center gap-4 rounded-2xl border border-amber-100/38 bg-neutral-950/86 px-5 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.48),0_0_70px_rgba(251,191,36,0.22)] backdrop-blur-md"
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
    }) as ConfettiInstance
    const timeouts: number[] = []

    const defaults: ConfettiOptions = {
      colors: ["#fbbf24", "#f97316", "#ef4444", "#22c55e", "#38bdf8", "#ffffff"],
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

    const bursts: Array<{ delay: number; ratio: number; options: ConfettiOptions }> = [
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
        }, burst.delay),
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
}: {
  room: RoomSnapshot
  game: RoomSnapshot["game"]
  selfPlayerId: string
  canTakeDrawPenalty: boolean
  onTakeDrawPenalty: () => void
  compact: boolean
}) {
  const players = orderPlayersAroundSelf(room.players, selfPlayerId)

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {players.map((candidate, index) => {
        const seat = tableSeatPosition(index, players.length, compact)
        const state = game?.players.find(
          (gamePlayer) => gamePlayer.playerId === candidate.id,
        )

        return (
          <TableAvatarSeat
            key={candidate.id}
            player={candidate}
            handCount={state?.handCount ?? 0}
            active={game?.turnPlayerId === candidate.id}
            eliminated={Boolean(state?.eliminated)}
            winnerPlacement={state?.winnerPlacement ?? null}
            connected={candidate.connected}
            isYou={candidate.id === selfPlayerId}
            isStaging={game?.stagedPlay?.playerId === candidate.id}
            drawStack={
              game?.drawStack?.targetPlayerId === candidate.id ? game.drawStack : null
            }
            canTakeDrawPenalty={
              Boolean(canTakeDrawPenalty && game?.drawStack?.targetPlayerId === candidate.id)
            }
            onTakeDrawPenalty={onTakeDrawPenalty}
            left={seat.left}
            top={seat.top}
          />
        )
      })}
    </div>
  )
}

function TableAvatarSeat({
  player,
  handCount,
  active,
  eliminated,
  winnerPlacement,
  connected,
  isYou,
  isStaging,
  drawStack,
  canTakeDrawPenalty,
  onTakeDrawPenalty,
  left,
  top,
}: {
  player: Player
  handCount: number
  active: boolean
  eliminated: boolean
  winnerPlacement: NonNullable<
    NonNullable<RoomSnapshot["game"]>["players"][number]["winnerPlacement"]
  > | null
  connected: boolean
  isYou: boolean
  isStaging: boolean
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"] | null
  canTakeDrawPenalty: boolean
  onTakeDrawPenalty: () => void
  left: number
  top: number
}) {
  const placementText = winnerPlacement
    ? `${ordinalLabel(winnerPlacement.position)} place`
    : null
  const isFirstPlace = winnerPlacement?.position === 1

  return (
    <div
      className={
        "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-[opacity,transform,filter] duration-300 " +
        (winnerPlacement
          ? "opacity-100"
          : eliminated || !connected
            ? "opacity-45"
            : "opacity-100")
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
              "absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border shadow-[0_8px_18px_rgba(0,0,0,0.28)] " +
              (isFirstPlace
                ? "border-amber-100/70 bg-amber-300 text-amber-950"
                : "border-white/16 bg-neutral-900 text-white/70")
            }
            aria-label={`${placementText} trophy`}
          >
            <Trophy className="size-4" strokeWidth={2.2} />
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
          <span className="rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] tabular-nums text-white/64 sm:px-2 sm:text-xs">
            {handCount}
          </span>
        )}
        {drawStack && active && (
          <DrawStackSeatBadge
            amount={drawStack.amount}
            canTake={canTakeDrawPenalty}
            onTake={onTakeDrawPenalty}
          />
        )}
      </div>
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
      <span className="font-semibold tabular-nums text-red-100">
        +{amount}
      </span>
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

function orderPlayersAroundSelf(players: Player[], selfPlayerId: string) {
  const selfIndex = players.findIndex((candidate) => candidate.id === selfPlayerId)
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
  selectedCards: Card[],
  playableCardIds: string[],
  isMyTurn: boolean,
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"],
) {
  if (!isMyTurn) return false
  if (selectedCards.some((selected) => selected.id === card.id)) return true
  if (selectedCards.length === 0) return playableCardIds.includes(card.id)
  return canPlayStagedCards(
    [...selectedCards, card],
    playableCardIds,
    drawStack,
  )
}

function cardsInIdOrder(cards: Card[], cardIds: string[]) {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  return cardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is Card => Boolean(card))
}

function canPlayStagedCards(
  cards: Card[],
  playableCardIds: string[],
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"],
) {
  if (cards.length === 0) return false
  if (cards.length === 1) return playableCardIds.includes(cards[0]?.id ?? "")
  if (drawStack) {
    return (
      canStackDrawCards(drawStack, cards, playableCardIds) &&
      cards.some((card) => playableCardIds.includes(card.id))
    )
  }
  return (
    (sameNumberGroup(cards) || sameDrawGroup(cards) || sameActionGroup(cards)) &&
    cards.some((card) => playableCardIds.includes(card.id))
  )
}

function canStackDrawCards(
  drawStack: NonNullable<RoomSnapshot["game"]>["drawStack"],
  cards: Card[],
  playableCardIds: string[],
) {
  if (!drawStack || cards.length === 0) return false

  const minimum = drawStack.minimum
  const playableGroups = new Set(
    cards
      .filter((card) => playableCardIds.includes(card.id))
      .map((card) => drawGroupKey(card))
      .filter((key): key is string => Boolean(key)),
  )

  return cards.every((card) => {
    const amount = drawAmount(card)
    const group = drawGroupKey(card)

    return Boolean(amount && amount >= minimum && group && playableGroups.has(group))
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

function sameNumberGroup(cards: Card[]) {
  const first = cards[0]
  if (!first || first.face.kind !== "number") return false
  const value = first.face.value
  return cards.every(
    (card) => card.face.kind === "number" && card.face.value === value,
  )
}

function sameDrawGroup(cards: Card[]) {
  const first = cards[0]
  const key = first ? drawGroupKey(first) : null
  if (!key) return false
  return cards.every((card) => drawGroupKey(card) === key)
}

function sameActionGroup(cards: Card[]) {
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
  onDraw,
}: {
  canDraw: boolean
  alreadyDrawn: boolean
  drawPileCount: number
  size: ResponsiveCardSize
  onDraw: () => void
}) {
  const compact = size === "sm"

  return (
    <div className="flex flex-col items-center gap-1.5 sm:gap-2">
      <div className={compact ? "relative h-[112px] w-[82px]" : "relative h-[178px] w-[128px]"}>
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
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <UnoCard card={cardBackPlaceholder} faceDown size={size} static />
        </div>
      </div>
      <button
        type="button"
        disabled={!canDraw}
        onClick={onDraw}
        className="h-8 rounded-lg border border-white/12 bg-black/35 px-2.5 text-xs font-medium text-white/84 transition-[background-color,border-color,color,transform] hover:border-white/22 hover:bg-white/10 hover:text-white active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 sm:h-9 sm:px-3 sm:text-sm"
      >
        {alreadyDrawn ? "Drawn" : "Draw one"}
      </button>
      <p className="text-[11px] text-white/45 sm:text-xs">{drawPileCount} in deck</p>
    </div>
  )
}

function DiscardStack({
  card,
  size,
}: {
  card: Card | null
  size: ResponsiveCardSize
}) {
  const compact = size === "sm"

  return (
    <div className="flex flex-col items-center gap-1.5 sm:gap-2">
      <div className="relative">
        <div className="absolute inset-0 translate-x-2 translate-y-1.5 rounded-xl border border-black/40 bg-black/24 sm:translate-x-3 sm:translate-y-2 sm:rounded-2xl" />
        <div className="absolute inset-0 translate-x-1 translate-y-0.5 rounded-xl border border-black/30 bg-white/8 sm:translate-x-1.5 sm:translate-y-1 sm:rounded-2xl" />
        {card ? (
          <UnoCard card={card} size={size} static />
        ) : (
          <div
            className={
              compact
                ? "h-[102px] w-[72px] rounded-lg border border-white/10 bg-black/20"
                : "h-[170px] w-[120px] rounded-xl border border-white/10 bg-black/20"
            }
          />
        )}
      </div>
      <p className="text-[11px] text-white/50 sm:text-xs">Discard pile</p>
    </div>
  )
}

function TableStagedPlay({
  cards,
  playerName,
  mode,
  targetColor,
  canEdit,
  onCardClick,
}: {
  cards: Card[]
  playerName: string | null
  mode: "stage" | "roulette"
  targetColor: PlayColor | null
  canEdit: boolean
  onCardClick: (card: Card) => void
}) {
  const half = (cards.length - 1) / 2
  const compact = cards.length > 5
  const gap = compact ? 26 : 38
  const width = Math.min(370, Math.max(154, 92 + cards.length * gap))
  const isRoulette = mode === "roulette"

  return (
    <div
      className={
        "mx-auto w-full max-w-[390px] rounded-2xl border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] " +
        (isRoulette
          ? "border-amber-100/18 bg-amber-200/10"
          : "border-black/25 bg-black/24")
      }
    >
      <div className="flex min-h-5 items-center justify-between gap-3 px-1">
        <p className="truncate text-xs font-medium text-white/72">
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
          <span className="shrink-0 text-[11px] text-white/42">tap to remove</span>
        )}
      </div>
      <div className="relative mt-2 grid h-[120px] place-items-center overflow-visible rounded-xl border border-white/8 bg-black/18 p-2 shadow-[inset_0_12px_28px_rgba(0,0,0,0.18)] sm:h-[132px] sm:p-3">
        {cards.length > 0 ? (
          <div className="relative h-[106px] sm:h-[112px]" style={{ width }}>
            {cards.map((card, index) => {
              const offset = index - half
              return (
                <div
                  key={card.id}
                  className="absolute bottom-1 left-1/2 sm:bottom-1.5"
                  style={{
                    transform: `translateX(${offset * gap - 36}px) rotate(${offset * 3.5}deg)`,
                    zIndex: 10 + index,
                  }}
                >
                  <UnoCard
                    card={card}
                    size="sm"
                    static={!canEdit}
                    onClick={canEdit ? () => onCardClick(card) : undefined}
                    ariaLabel={isRoulette ? "Revealed pickup card" : "Staged card"}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="h-[78px] w-[132px] rounded-xl border border-dashed border-white/16 bg-white/[0.035]" />
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
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/28 px-3 py-2 text-xs font-medium text-white/70">
      <RotateCw
        className={"size-3.5 " + (clockwise ? "" : "-scale-x-100")}
        aria-hidden="true"
      />
      {compact ? (clockwise ? "CW" : "CCW") : clockwise ? "Clockwise" : "Counter-clockwise"}
    </div>
  )
}

function DiscardOptionsPanel({
  candidates,
  selectedCardIds,
  topChoices,
  topCardId,
  onToggleCard,
  onTopCard,
}: {
  candidates: Card[]
  selectedCardIds: string[]
  topChoices: Card[]
  topCardId: string
  onToggleCard: (card: Card) => void
  onTopCard: (cardId: string) => void
}) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.045] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white/78">Discard options</p>
          <p className="mt-1 text-xs text-white/42">
            Choose which matching-color cards to throw, and which card stays on top.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/50">
          Top card
          <select
            value={topCardId}
            onChange={(event) => onTopCard(event.target.value)}
            className="h-8 rounded-lg border border-white/10 bg-neutral-950 px-2 text-xs text-white outline-none"
          >
            {topChoices.map((card) => (
              <option key={card.id} value={card.id}>
                {shortCardLabel(card)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {candidates.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidates.map((card) => {
            const selected = selectedCardIds.includes(card.id)
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onToggleCard(card)}
                className={
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-[background-color,border-color,color,transform] active:scale-[0.97] " +
                  (selected
                    ? "border-white/35 bg-white/18 text-white"
                    : "border-white/10 bg-black/22 text-white/55 hover:border-white/22 hover:bg-white/8 hover:text-white/78")
                }
              >
                {shortCardLabel(card)}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/38">
          No other cards of this color are in your hand.
        </p>
      )}
    </div>
  )
}

function FannedGameHand({
  cards,
  playableCardIds,
  selectedCardIds,
  isMyTurn,
  drawStack,
  cardSize,
  onToggleCard,
  onDragStart,
  onDragMove,
  onDragEnd,
  onCancelDrag,
}: {
  cards: Card[]
  playableCardIds: string[]
  selectedCardIds: string[]
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

  const selectedCards = cardsInIdOrder(cards, selectedCardIds)
  const visibleCards = cards.filter((card) => !selectedCardIds.includes(card.id))
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
    visibleCards.length <= 8 ? (compact ? 5 : 6) : visibleCards.length <= 14 ? 4 : 2.35
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
      drawStack,
    )
  }

  function canDragCard() {
    return isMyTurn
  }

  function startPointerDrag(
    event: PointerEvent<HTMLElement>,
    card: Card,
    cardRotation: number,
  ) {
    if (event.button !== 0) return
    if (!canDragCard()) return
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
    if (canSelectCard(card)) onToggleCard(card)
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
            const draggable = canDragCard()
            const activeDragForCard =
              activeDrag?.cardId === card.id ? activeDrag : null
            const dragging = Boolean(activeDragForCard?.dragging)
            const rotate = offset * rotation
            const translateX = offset * spread + (activeDragForCard?.dx ?? 0)
            const translateY =
              (dragging
                ? compact
                  ? -54
                  : -90
                : Math.min(Math.abs(offset) * (compact ? 3 : 5), compact ? 20 : 34)) +
              (activeDragForCard?.dy ?? 0)
            const scale = (dragging ? 1.05 : 1) * cardScale

            return (
              <div
                key={card.id}
                className={
                  "absolute bottom-0 " +
                  (draggable ? "cursor-grab touch-none active:cursor-grabbing" : "")
                }
                style={{
                  transform: `translateX(${translateX}px) translateY(${translateY}px) rotate(${rotate}deg) scale(${scale})`,
                  transitionProperty: "transform",
                  transitionDuration: dragging ? "0ms" : "480ms",
                  transitionTimingFunction: "cubic-bezier(0.22, 0.9, 0.18, 1)",
                  zIndex: dragging ? 90 : 10 + index,
                  willChange: "transform",
                  opacity: dragging ? 0 : 1,
                }}
              >
                <UnoCard
                  card={card}
                  size={cardSize}
                  raised={dragging}
                  onPointerDown={(event) => startPointerDrag(event, card, rotate)}
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
                    playable && isMyTurn
                      ? "cursor-grab touch-none shadow-[0_0_0_1px_rgba(255,255,255,0.28)] active:cursor-grabbing"
                      : draggable
                        ? "cursor-grab touch-none active:cursor-grabbing"
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
          document.body,
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
    ? "Opening the invite..."
    : waitingCount === 0
      ? "The table is being set up."
      : waitingCount === 1
        ? `${room?.players[0]?.name ?? "Someone"} is waiting for you.`
        : `${waitingCount} players are waiting for you.`

  return (
    <main className="min-h-svh bg-neutral-950 text-white antialiased">
      <div className="mx-auto grid min-h-svh w-full max-w-6xl items-center gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-10">
        <section className="min-w-0">
          <p className="text-xs font-medium tracking-[0.18em] text-white/45 uppercase">
            UNO No Mercy invite
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            You have a seat at the table.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-white/58">
            {waitingCopy} Enter your name and you will land straight in the game
            room.
          </p>

          <form
            className="mt-8 max-w-xl rounded-lg border border-white/10 bg-white/[0.035] p-4"
            onSubmit={(event) => {
              event.preventDefault()
              onJoin()
            }}
          >
            <label className="text-sm font-medium text-white/78" htmlFor="invite-name">
              Display name
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="invite-name"
                value={playerName}
                onChange={(event) => onPlayerName(event.target.value)}
                placeholder="Your name"
                className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/30"
                maxLength={24}
                autoFocus
              />
              <Button
                type="submit"
                disabled={joining || !room}
                className="h-10 bg-white text-neutral-950 hover:bg-white/85"
              >
                {joining ? "Joining..." : "Enter room"}
                <ArrowRight />
              </Button>
            </div>
            {error && (
              <p className="mt-3 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            )}
          </form>
        </section>

        <aside className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-white/45">Room code</p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-wider">
                {roomCode}
              </p>
            </div>
            <CopyInviteButton iconOnly onCopy={onCopyInvite} />
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <UsersRound className="size-4 text-white/55" />
                <h2 className="text-sm font-medium">At the table</h2>
              </div>
              <span className="text-xs text-white/42">
                {room ? `${room.players.length}/${room.houseRules.maxPlayers}` : "--"}
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

function CopyInviteButton({
  iconOnly = false,
  onCopy,
}: {
  iconOnly?: boolean
  onCopy: () => Promise<void>
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(t)
  }, [copied])

  async function handleCopy() {
    await onCopy()
    setCopied(true)
  }

  // Both icons sit absolutely on top of each other and cross-fade.
  const layer =
    "absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]"
  const shown = "scale-100 opacity-100 blur-0"
  const hidden = "scale-[0.4] opacity-0 blur-[3px]"

  return (
    <Button
      type="button"
      size={iconOnly ? "icon-sm" : "sm"}
      aria-label={iconOnly ? (copied ? "Invite link copied" : "Copy invite link") : "Copy invite link"}
      aria-live="polite"
      onClick={handleCopy}
      className="bg-white text-neutral-950 hover:bg-white/85"
    >
      <span
        data-icon={iconOnly ? undefined : "inline-start"}
        className="relative inline-block size-3.5 shrink-0"
        aria-hidden="true"
      >
        <Clipboard
          className={`${layer} size-3.5 ${copied ? hidden : shown}`}
        />
        <Check
          strokeWidth={2.75}
          className={`${layer} size-3.5 text-emerald-600 ${copied ? shown : hidden}`}
        />
      </span>
      {!iconOnly && <span>Copy invite</span>}
    </Button>
  )
}

const playColors: PlayColor[] = ["red", "yellow", "green", "blue"]

const cardBackPlaceholder: Card = {
  id: "draw-pile",
  color: "wild",
  face: { kind: "wild" },
}

function ColorPill({ color }: { color: PlayColor }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs font-medium text-white/70">
      <span
        className="size-3 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.22)]"
        style={{ background: colorValue(color) }}
      />
      {color}
    </div>
  )
}

function ColorPicker({
  value,
  onChange,
}: {
  value: PlayColor | null
  onChange: (color: PlayColor) => void
}) {
  return (
    <div className="flex h-9 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.055] px-1.5">
      {playColors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Choose ${color}`}
          onClick={() => onChange(color)}
          className={
            "size-6 rounded-full transition-[scale,box-shadow] active:scale-[0.96] " +
            (value === color
              ? "shadow-[0_0_0_2px_white,0_0_0_4px_rgba(255,255,255,0.2)]"
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
        "flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.055] px-3 text-sm text-white/70 transition-[background-color,border-color,opacity] " +
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

function playerName(room: RoomSnapshot, playerId: string | null | undefined): string {
  if (!playerId) return "Someone"
  return room.players.find((player) => player.id === playerId)?.name ?? "Someone"
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

function keepSameStringArrayReference(current: string[], next: string[]) {
  if (
    current.length === next.length &&
    current.every((value, index) => value === next[index])
  ) {
    return current
  }

  return next
}

function shortCardLabel(card: Card): string {
  const color = card.color === "wild" ? "Wild" : capitalize(card.color)
  switch (card.face.kind) {
    case "number":
      return `${color} ${card.face.value}`
    case "skip":
      return `${color} Skip`
    case "skip-everyone":
      return `${color} Skip all`
    case "reverse":
      return `${color} Reverse`
    case "draw":
      return `${color} +${card.face.count}`
    case "discard-color":
      return `${color} Discard`
    case "wild":
      return "Wild"
    case "wild-draw":
      return `Wild +${card.face.count}`
    case "wild-reverse-draw":
      return "Wild Reverse +4"
    case "wild-color-roulette":
      return "Wild Roulette"
  }
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
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

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60">
      <Circle
        className={
          "size-2 fill-current " + (connected ? "text-emerald-400" : "text-white/25")
        }
      />
      {connected ? "Connected" : "Offline"}
    </div>
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
        {player.connected ? (player.ready || isHost ? "Ready" : "Waiting") : "Away"}
      </span>
    </div>
  )
}
