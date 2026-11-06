/** Minimal typings for the YouTube IFrame Player API we use. */
export type YouTubePlayer = {
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getPlayerState: () => number
  setVolume: (volume: number) => void
  mute: () => void
  unMute: () => void
  destroy: () => void
}

type YouTubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width?: number
      height?: number
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: () => void
        onStateChange?: (event: { data: number }) => void
        onError?: (event: { data: number }) => void
        onAutoplayBlocked?: () => void
      }
    }
  ) => YouTubePlayer
}

export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

declare global {
  interface Window {
    YT?: YouTubeNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YouTubeNamespace> | null = null

/** Loads https://www.youtube.com/iframe_api once per page. */
export function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("No window"))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise<YouTubeNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    script.async = true
    script.onerror = () => {
      apiPromise = null
      reject(new Error("Couldn't load the YouTube player. Is it blocked?"))
    }
    document.head.appendChild(script)
  })
  return apiPromise
}
