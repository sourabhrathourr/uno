import { useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { PerformanceMonitor } from "@react-three/drei"
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing"

import { BeatState, useBeatGrid } from "./beat-engine"
import { controls } from "./controls"
import { useLounge } from "./lounge-store"
import { CardSnapshotter, prefetchCards } from "./real-cards"
import { SeatedHud } from "./seated-hud"
import { useSpectate } from "./spectate"
import { useSeatedPlay } from "./seated-play"
import { HeldHand, seatedFov } from "./scene/held-hand"
import { LoungeHud } from "./lounge-hud"
import { useWorldPresence } from "./presence"
import { BeatProvider } from "./scene/beat-context"
import { Lights } from "./scene/lights"
import { LocalPlayer, OtherPlayers, useChatBubbles } from "./scene/players"
import { Room } from "./scene/room"
import { Stage } from "./scene/stage"
import { GameTable3D } from "./scene/table"
import type { RoomActions } from "./seated-hud"
import type { HandView } from "./scene/held-hand"
import type { SupportActions } from "./spectate"
import type { GameActions } from "./seated-play"
import type { BeatGrid } from "./beat"
import type { PerspectiveCamera } from "three"
import type {
  PlayerGameSnapshot,
  PlayerSocialSnapshot,
  RoomSnapshot,
  SendChatMessageInput,
} from "@workspace/game"
import type { GameSocket } from "@/lib/realtime"
import type { RoomMusicController } from "@/lib/room-music"
import { useMusicController } from "@/lib/room-music"

export type LoungeWorldProps = {
  room: RoomSnapshot
  selfId: string
  socket: GameSocket | null
  playerGame: PlayerGameSnapshot | null
  speaking: Record<string, boolean>
  onSendChatMessage: (input: SendChatMessageInput) => void | Promise<boolean>
  actions: GameActions
  actionPending: boolean
  playerSocial: PlayerSocialSnapshot | null
  supportActions: SupportActions
  roomActions: RoomActions
}

/** A wider lens when seated on a tall phone screen, so the table fits. */
// One object for the life of the page: the canvas re-applies camera options
// whenever it sees a new object, which would undo the seated lens below.
const CAMERA = {
  fov: 55,
  near: 0.1,
  far: 80,
  position: [0, 2.6, 15] as [number, number, number],
}

function SeatedLens({ firstPerson }: { firstPerson: boolean }) {
  const { camera, size } = useThree()
  // Checked every frame, so nothing else can leave the lens wrong for long.
  useFrame(() => {
    const lens = camera as PerspectiveCamera
    const fov = firstPerson ? seatedFov(size.width, size.height) : CAMERA.fov
    if (lens.fov !== fov) {
      lens.fov = fov
      lens.updateProjectionMatrix()
    }
  })
  return null
}

/** Feeds the room clock and tempo into the shared beat state each frame. */
function BeatDriver({
  beat,
  grid,
  music,
}: {
  beat: BeatState
  grid: BeatGrid
  music: RoomMusicController | null
}) {
  useFrame((_, dt) => {
    beat.update(
      Date.now(),
      Math.min(dt, 0.1),
      music?.snapshot ?? null,
      music?.receivedAt ?? 0,
      grid
    )
  }, -1)
  return null
}

export default function LoungeWorld({
  room,
  selfId,
  socket,
  playerGame,
  speaking,
  onSendChatMessage,
  actions,
  actionPending,
  playerSocial,
  supportActions,
  roomActions,
}: LoungeWorldProps) {
  const music = useMusicController()
  const { grid, tap, tapCount } = useBeatGrid(socket, music)
  const beat = useMemo(() => new BeatState(), [])
  const presence = useWorldPresence(socket, selfId)
  const { seated, classic } = useLounge()
  const hasGame = Boolean(room.game) && room.status !== "lobby"
  // Sitting is always first person, lobby included; the classic view only
  // shows when asked for.
  const firstPerson = seated && !classic
  const seatedPlay = useSeatedPlay({
    room,
    selfId,
    playerGame,
    actions,
    actionPending,
  })
  const spectate = useSpectate({
    socket,
    room,
    selfId,
    playerSocial,
    actions: supportActions,
  })
  // Out of the match and backing someone: sit in on their hand instead.
  const watchedId = spectate.inactive ? spectate.watchingId : null
  const viewSeatId = watchedId ?? selfId
  const stagedIds = new Set(room.game?.stagedPlay?.cards.map((c) => c.id))
  const handView: HandView = spectate.inactive
    ? {
        cards: spectate.view?.hand ?? [],
        isSelected: (id) =>
          room.game?.stagedPlay?.playerId === watchedId && stagedIds.has(id),
        isPlayable: (card) =>
          spectate.view?.playableCardIds.includes(card.id) ?? false,
        turn: Boolean(watchedId) && room.game?.turnPlayerId === watchedId,
        onToggle: null,
        onThrow: null,
      }
    : {
        // Picked cards wait in the tray on the table, not in your hand.
        cards: seatedPlay.hand.filter(
          (card) => !seatedPlay.selectedIds.includes(card.id)
        ),
        isSelected: (id) => seatedPlay.selectedIds.includes(id),
        isPlayable: (card) => seatedPlay.canSelect(card),
        turn: seatedPlay.isMyTurn,
        onToggle: seatedPlay.toggle,
        onThrow: seatedPlay.throwCard,
      }

  const status = useRef({ nearSeat: false, dancing: false })
  // Capture the cards you're about to see first, so they show up sharp.
  const handKey = (playerGame?.hand ?? []).map((card) => card.id).join(":")
  useEffect(() => {
    prefetchCards([
      null,
      ...(playerGame?.hand ?? []),
      ...(room.game?.topDiscard ? [room.game.topDiscard] : []),
    ])
  }, [handKey, room.game?.topDiscard?.id])
  const bubbles = useChatBubbles(room)
  const [ready, setReady] = useState(false)
  const [quality, setQuality] = useState<"high" | "low">("high")
  const [dpr, setDpr] = useState(1.5)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    beat.reducedMotion = query.matches
    const onChange = () => (beat.reducedMotion = query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [beat])

  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const extras = { bubbles, speaking }
  const track = music?.snapshot?.nowPlaying ?? null

  return (
    <div className="fixed inset-0 z-[5] touch-none bg-[#050407] select-none">
      <div
        className="absolute inset-0"
        onPointerDown={(event) => {
          // Seated, the pointer belongs to your cards, not the camera.
          if (drag.current || seated) return
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          controls.pointer.x =
            ((event.clientX - rect.left) / rect.width) * 2 - 1
          controls.pointer.y = -(
            ((event.clientY - rect.top) / rect.height) * 2 -
            1
          )
          const current = drag.current
          if (!current || current.id !== event.pointerId) return
          controls.look.x += event.clientX - current.x
          controls.look.y += event.clientY - current.y
          current.x = event.clientX
          current.y = event.clientY
        }}
        onPointerUp={(event) => {
          if (drag.current?.id === event.pointerId) drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onWheel={(event) => {
          controls.zoom += event.deltaY
        }}
      >
        <Canvas
          dpr={[1, dpr]}
          camera={CAMERA}
          gl={{
            antialias: quality === "high",
            powerPreference: "high-performance",
          }}
          onCreated={() => setReady(true)}
        >
          <PerformanceMonitor
            onDecline={() => {
              setDpr(1)
              setQuality("low")
            }}
          />
          <color attach="background" args={["#050407"]} />
          <fog attach="fog" args={["#07050b", 16, 38]} />
          <BeatProvider value={beat}>
            <BeatDriver beat={beat} grid={grid} music={music} />
            <Lights />
            <Room />
            <Stage track={track} />
            <SeatedLens firstPerson={firstPerson} />
            <GameTable3D
              room={room}
              selfId={selfId}
              hand={playerGame?.hand ?? null}
              heldBy={firstPerson ? viewSeatId : null}
              showSign={!firstPerson}
              localStage={
                firstPerson && hasGame && !spectate.inactive
                  ? {
                      cards: seatedPlay.selectedCards,
                      choices: {
                        chosenColor: seatedPlay.choices.chosenColor,
                        declaredUno:
                          seatedPlay.play.canDeclareUno &&
                          seatedPlay.choices.declaredUno,
                        swapWithPlayerId: seatedPlay.play.canChooseSwap
                          ? seatedPlay.choices.swapWithPlayerId || null
                          : null,
                        rotateHands:
                          seatedPlay.play.canChooseRotate &&
                          seatedPlay.choices.wantsRotate,
                      },
                      canEdit: seatedPlay.canEditStage,
                      onCardClick: (card) => void seatedPlay.toggle(card),
                    }
                  : null
              }
              controls={
                firstPerson && hasGame && !spectate.inactive
                  ? {
                      canDraw: seatedPlay.canDraw,
                      canPlay: seatedPlay.play.canSubmitPlay,
                      onDraw: () => seatedPlay.actions.drawCard(),
                      onPlay: () => seatedPlay.submit(),
                    }
                  : null
              }
            />
            {firstPerson && <HeldHand hand={handView} />}
            <LocalPlayer
              room={room}
              selfId={selfId}
              seated={seated}
              firstPerson={firstPerson}
              viewSeatId={viewSeatId}
              extras={extras}
              publish={presence.publish}
              status={status}
            />
            <OtherPlayers
              room={room}
              selfId={selfId}
              ids={presence.ids}
              remotes={presence.remotes}
              extras={extras}
            />
          </BeatProvider>
          {quality === "high" ? (
            <EffectComposer multisampling={0}>
              <Bloom
                mipmapBlur
                intensity={1.05}
                luminanceThreshold={0.9}
                luminanceSmoothing={0.25}
              />
              <Vignette offset={0.25} darkness={0.75} />
            </EffectComposer>
          ) : (
            <EffectComposer multisampling={0}>
              <Bloom
                intensity={0.8}
                luminanceThreshold={0.7}
                resolutionScale={0.5}
              />
            </EffectComposer>
          )}
        </Canvas>
      </div>
      <CardSnapshotter />
      {firstPerson && (
        <SeatedHud
          room={room}
          selfId={selfId}
          seated={seatedPlay}
          spectate={spectate}
          roomActions={roomActions}
        />
      )}
      <LoungeHud
        room={room}
        selfId={selfId}
        grid={grid}
        beat={beat}
        tap={tap}
        tapCount={tapCount}
        status={status}
        seated={seated}
        ready={ready}
        onSendChatMessage={onSendChatMessage}
      />
    </div>
  )
}
