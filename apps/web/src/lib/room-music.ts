import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { getRealtimeUrl } from "./realtime"
import { getActiveRoomCode, getPlayerSessionId } from "./session"
import type { GameSocket } from "./realtime"
import type {
  CommandResult,
  MusicControlAction,
  MusicLiker,
  MusicSearchResponse,
  MusicTrack,
  RoomMusicSnapshot,
} from "@workspace/game"

export async function searchMusic(
  query: string,
  signal?: AbortSignal
): Promise<Array<MusicTrack>> {
  const url = new URL(`${getRealtimeUrl()}/music/search`)
  url.searchParams.set("q", query.trim())
  const response = await fetch(url, {
    signal,
    headers: {
      "X-Room-Code": getActiveRoomCode(),
      "X-Player-Session-Id": getPlayerSessionId(),
    },
  })
  const payload = (await response.json().catch(() => null)) as
    | (MusicSearchResponse & { error?: { message?: string } })
    | null
  if (!response.ok || !payload) {
    throw new Error(
      payload?.error?.message ?? "Music search is temporarily unavailable."
    )
  }
  return payload.results
}

export type RoomMusicController = {
  selfPlayerId: string | null
  snapshot: RoomMusicSnapshot | null
  /** Local clock (ms) when `snapshot` arrived, for position estimates. */
  receivedAt: number
  error: string | null
  clearError: () => void
  enqueue: (videoId: string, playNext?: boolean) => Promise<boolean>
  /** Replaces the current song for everyone and starts this one. */
  playNow: (videoId: string) => Promise<boolean>
  like: (videoId: string, liked: boolean) => Promise<boolean>
  control: (action: MusicControlAction) => Promise<boolean>
  remove: (queueId: string) => Promise<boolean>
  seek: (positionSec: number) => Promise<boolean>
  reportEnded: (queueId: string) => void
  reportUnplayable: (queueId: string) => void
}

/** Live position of the room's song, extrapolated from the last snapshot. */
export function estimatePositionSec(
  snapshot: RoomMusicSnapshot,
  receivedAt: number,
  now = Date.now()
): number {
  if (snapshot.status !== "playing") return snapshot.positionSec
  const position = snapshot.positionSec + Math.max(0, now - receivedAt) / 1_000
  const duration = snapshot.nowPlaying?.durationSec
  return duration ? Math.min(position, duration) : position
}

export function useRoomMusic(
  socket: GameSocket | null,
  joinedSocketId: string | null,
  selfPlayerId: string | null
): RoomMusicController {
  const [state, setState] = useState<{
    snapshot: RoomMusicSnapshot | null
    receivedAt: number
  }>({ snapshot: null, receivedAt: 0 })
  const [error, setError] = useState<string | null>(null)
  const versionRef = useRef(-1)

  const apply = useCallback((snapshot: RoomMusicSnapshot) => {
    // Snapshots can cross on the wire; never step back to an older one,
    // except when the room restarted its counter (new room, server restart).
    if (snapshot.version < versionRef.current && snapshot.version !== 0) return
    versionRef.current = snapshot.version
    setState({ snapshot, receivedAt: Date.now() })
  }, [])

  useEffect(() => {
    if (!socket) return
    socket.on("music:state", apply)
    return () => {
      socket.off("music:state", apply)
    }
  }, [socket, apply])

  useEffect(() => {
    if (!socket || !joinedSocketId) {
      versionRef.current = -1
      setState({ snapshot: null, receivedAt: 0 })
      return
    }
    versionRef.current = -1
    socket.emit("music:get", (result) => {
      if (result.ok) apply(result.data)
    })
  }, [socket, joinedSocketId, apply])

  const run = useCallback(
    (send: (ack: (result: CommandResult<RoomMusicSnapshot>) => void) => void) =>
      new Promise<boolean>((resolve) => {
        if (!socket) return resolve(false)
        send((result) => {
          if (result.ok) {
            apply(result.data)
            setError(null)
            resolve(true)
          } else {
            setError(result.error.message)
            resolve(false)
          }
        })
      }),
    [socket, apply]
  )

  return {
    selfPlayerId,
    snapshot: state.snapshot,
    receivedAt: state.receivedAt,
    error,
    clearError: () => setError(null),
    enqueue: (videoId, playNext = false) =>
      run((ack) => socket?.emit("music:enqueue", { videoId, playNext }, ack)),
    playNow: (videoId) =>
      run((ack) =>
        socket?.emit("music:enqueue", { videoId, playNow: true }, ack)
      ),
    control: (action) =>
      run((ack) => socket?.emit("music:control", { action }, ack)),
    remove: (queueId) =>
      run((ack) => socket?.emit("music:remove", { queueId }, ack)),
    seek: (positionSec) =>
      run((ack) => socket?.emit("music:seek", { positionSec }, ack)),
    like: (videoId, liked) =>
      run((ack) => socket?.emit("music:like", { videoId, liked }, ack)),
    reportEnded: (queueId) => socket?.emit("music:ended", { queueId }),
    reportUnplayable: (queueId) =>
      socket?.emit("music:unplayable", { queueId }),
  }
}

/* ------------------------------------------------------------------ */
/* Small browser-local stores                                          */
/* ------------------------------------------------------------------ */

function createStore<T>(initial: () => T) {
  let value: T | undefined
  const listeners = new Set<() => void>()
  const get = () => (value ??= initial())
  return {
    get,
    set(next: T) {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private windows and full storage: liking still works for this tab.
  }
}

const LIKED_KEY = "uno-no-mercy:liked-songs"
const VOLUME_KEY = "uno-no-mercy:music-volume"
const LIKED_LIMIT = 500

const likedStore = createStore<Array<MusicTrack>>(() =>
  typeof window === "undefined"
    ? []
    : // Stored data is untrusted: an older build or a hand edit may differ.
      readJson<Array<Partial<MusicTrack> | null>>(LIKED_KEY, []).filter(
        (track): track is MusicTrack =>
          track !== null && typeof track.id === "string"
      )
)

/** Songs this browser has hearted. They follow the player across rooms. */
export function useLikedSongs() {
  const liked = useSyncExternalStore(
    likedStore.subscribe,
    likedStore.get,
    () => EMPTY_TRACKS
  )
  const setLiked = useCallback((track: MusicTrack, value: boolean) => {
    const current = likedStore.get()
    const without = current.filter((item) => item.id !== track.id)
    const next = value
      ? [plainTrack(track), ...without].slice(0, LIKED_LIMIT)
      : without
    likedStore.set(next)
    writeJson(LIKED_KEY, next)
  }, [])
  const isLiked = useCallback(
    (id: string) => liked.some((track) => track.id === id),
    [liked]
  )
  return { liked, setLiked, isLiked }
}

const EMPTY_LIKERS: Array<MusicLiker> = []

/**
 * One song's heart: your own like (kept in this browser across rooms and
 * shared with the room) plus everyone in the room who liked it.
 */
export function useSongLike(track: MusicTrack) {
  const controller = useMusicController()
  const { isLiked, setLiked } = useLikedSongs()
  const selfId = controller?.selfPlayerId ?? null
  const likers = controller?.snapshot?.likes[track.id] ?? EMPTY_LIKERS
  const selfInRoom = likers.some((liker) => liker.playerId === selfId)
  const liked = isLiked(track.id) || selfInRoom
  // A song liked in another room is in your list before this room knows it;
  // still name you in the label.
  const named =
    liked && !selfInRoom
      ? [{ playerId: selfId ?? "", name: "you" }, ...likers]
      : likers
  return {
    liked,
    likers,
    label: likedByLabel(named, selfId),
    toggle: () => {
      const next = !liked
      setLiked(track, next)
      void controller?.like(track.id, next)
    },
  }
}

/** "Liked by you and Aman", "Liked by Aman, Riya and 3 others". */
export function likedByLabel(
  likers: Array<MusicLiker>,
  selfId: string | null
): string | null {
  if (likers.length === 0) return null
  const names = [
    ...likers.filter((liker) => liker.playerId === selfId).map(() => "you"),
    ...likers
      .filter((liker) => liker.playerId !== selfId)
      .map((liker) => liker.name),
  ]
  if (names.length === 1) return `Liked by ${names[0]}`
  if (names.length === 2) return `Liked by ${names[0]} and ${names[1]}`
  if (names.length === 3)
    return `Liked by ${names[0]}, ${names[1]} and ${names[2]}`
  return `Liked by ${names[0]}, ${names[1]} and ${names.length - 2} others`
}

const EMPTY_TRACKS: Array<MusicTrack> = []

/**
 * Music starts quiet so it sits under voice chat. iPhones ignore this (iOS
 * won't let pages set media volume), so there it plays at the phone's level.
 */
export const MUSIC_DEFAULT_VOLUME = 20

type VolumeState = { volume: number; muted: boolean }
const volumeStore = createStore<VolumeState>(() => {
  const stored =
    typeof window === "undefined"
      ? null
      : readJson<Partial<VolumeState> | null>(VOLUME_KEY, null)
  const volume = Number(stored?.volume)
  return {
    volume: Number.isFinite(volume)
      ? Math.min(100, Math.max(0, volume))
      : MUSIC_DEFAULT_VOLUME,
    muted: Boolean(stored?.muted),
  }
})
const DEFAULT_VOLUME: VolumeState = {
  volume: MUSIC_DEFAULT_VOLUME,
  muted: false,
}

/** Each listener's own volume; music never changes anyone else's level. */
export function useMusicVolume() {
  const state = useSyncExternalStore(
    volumeStore.subscribe,
    volumeStore.get,
    () => DEFAULT_VOLUME
  )
  const update = useCallback((patch: Partial<VolumeState>) => {
    const next = { ...volumeStore.get(), ...patch }
    volumeStore.set(next)
    writeJson(VOLUME_KEY, next)
  }, [])
  return { ...state, update }
}

const panelStore = createStore<boolean>(() => false)
const controllerStore = createStore<RoomMusicController | null>(() => null)

export function useMusicPanel() {
  const open = useSyncExternalStore(
    panelStore.subscribe,
    panelStore.get,
    () => false
  )
  return {
    open,
    setOpen: (next: boolean) => panelStore.set(next),
    toggle: () => panelStore.set(!panelStore.get()),
  }
}

/** Lets header buttons deep in the room tree read the room's music state. */
export function publishMusicController(controller: RoomMusicController | null) {
  if (controllerStore.get() !== controller) controllerStore.set(controller)
}

export function useMusicController() {
  return useSyncExternalStore(
    controllerStore.subscribe,
    controllerStore.get,
    () => null
  )
}

export function plainTrack(track: MusicTrack): MusicTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationSec: track.durationSec,
    thumbnailUrl: track.thumbnailUrl,
  }
}
