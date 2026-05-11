type SoundOptions = {
  volume?: number
  playbackRate?: number
  loop?: boolean
}

type ReactSoundsModule = {
  playSound: (name: string, options?: SoundOptions) => Promise<void>
  preloadSounds: (names: string[]) => Promise<void>
  setSoundEnabled: (enabled: boolean) => void
}

const LOCAL_SOUNDS = {
  cardDrop: "/card-drop.mp3",
  cardTake: "/card-take.mp3",
} as const

const SOUND_ENABLED_KEY = "uno:sfx-enabled"

export type LocalSoundName = keyof typeof LOCAL_SOUNDS

const localCache = new Map<LocalSoundName, HTMLAudioElement>()
let soundModulePromise: Promise<ReactSoundsModule | null> | null = null
let soundEnabled = true

function loadSoundModule() {
  if (typeof window === "undefined") return Promise.resolve(null)
  soundModulePromise ??= import("react-sounds")
    .then((module) => module as unknown as ReactSoundsModule)
    .catch(() => null)
  return soundModulePromise
}

function readStoredSoundEnabled() {
  if (typeof window === "undefined") return true
  try {
    const stored = window.localStorage.getItem(SOUND_ENABLED_KEY)
    return stored === null ? true : stored === "true"
  } catch {
    return true
  }
}

function writeStoredSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SOUND_ENABLED_KEY, String(enabled))
  } catch {
    // Storage can fail in private or constrained contexts; sound still works in memory.
  }
}

function getLocalAudio(name: LocalSoundName): HTMLAudioElement | null {
  if (typeof window === "undefined") return null
  let audio = localCache.get(name)
  if (!audio) {
    audio = new Audio(LOCAL_SOUNDS[name])
    audio.preload = "auto"
    localCache.set(name, audio)
  }
  return audio
}

export function playLocalSound(name: LocalSoundName, volume = 0.7) {
  if (typeof window === "undefined") return
  if (!isSfxEnabled()) return
  const base = getLocalAudio(name)
  if (!base) return
  const clone = base.cloneNode(true) as HTMLAudioElement
  clone.volume = Math.max(0, Math.min(1, volume))
  void clone.play().catch(() => {})
}

export function playLibrary(name: string, options?: SoundOptions) {
  if (typeof window === "undefined") return
  if (!isSfxEnabled()) return
  void loadSoundModule().then((module) => module?.playSound(name, options))
}

const SOUNDS = {
  buttonSoft: "ui/button_soft",
  buttonHard: "ui/button_hard",
  toggleOn: "ui/toggle_on",
  toggleOff: "ui/toggle_off",
  popOpen: "ui/pop_open",
  popupOpen: "ui/popup_open",
  successChime: "ui/success_chime",
  successBlip: "ui/success_blip",
  itemSelect: "ui/item_select",
  itemDeselect: "ui/item_deselect",
  copy: "ui/copy",
  blocked: "ui/blocked",
  panelExpand: "ui/panel_expand",
  bootUp: "system/boot_up",
  coinBling: "arcade/coin_bling",
  powerUp: "arcade/power_up",
  levelUp: "arcade/level_up",
  notify: "notification/info",
  success: "notification/success",
} as const

export type LibrarySound = keyof typeof SOUNDS

export function playFx(name: LibrarySound, options?: SoundOptions) {
  playLibrary(SOUNDS[name], options)
}

export function playWinnerSound(firstPlace = false) {
  if (typeof window === "undefined") return
  if (!isSfxEnabled()) return

  const sequence: Array<{
    delay: number
    sound: LibrarySound
    volume: number
    playbackRate?: number
  }> = firstPlace
    ? [
        { delay: 0, sound: "powerUp", volume: 0.56, playbackRate: 0.92 },
        { delay: 130, sound: "successChime", volume: 0.78, playbackRate: 1 },
        { delay: 340, sound: "levelUp", volume: 0.74, playbackRate: 1.04 },
        { delay: 610, sound: "coinBling", volume: 0.62, playbackRate: 0.94 },
        { delay: 760, sound: "coinBling", volume: 0.42, playbackRate: 1.18 },
      ]
    : [
        { delay: 0, sound: "successChime", volume: 0.58, playbackRate: 1 },
        { delay: 220, sound: "coinBling", volume: 0.42, playbackRate: 1.08 },
      ]

  window.setTimeout(() => playLocalSound("cardDrop", firstPlace ? 0.34 : 0.24), 30)
  for (const item of sequence) {
    window.setTimeout(
      () =>
        playFx(item.sound, {
          volume: item.volume,
          playbackRate: item.playbackRate,
        }),
      item.delay,
    )
  }
}

const PRELOAD_LIST = Object.values(SOUNDS)

let preloadStarted = false
export function startSoundSystem() {
  if (typeof window === "undefined") return
  soundEnabled = readStoredSoundEnabled()
  if (preloadStarted) return
  preloadStarted = true

  void loadSoundModule().then((module) => {
    module?.setSoundEnabled(soundEnabled)
    return module?.preloadSounds(PRELOAD_LIST)
  })

  Object.keys(LOCAL_SOUNDS).forEach((name) => {
    getLocalAudio(name as LocalSoundName)
  })
}

export function isSfxEnabled() {
  if (typeof window === "undefined") return true
  soundEnabled = readStoredSoundEnabled()
  return soundEnabled
}

export function setSfxEnabled(enabled: boolean) {
  soundEnabled = enabled
  writeStoredSoundEnabled(enabled)
  void loadSoundModule().then((module) => module?.setSoundEnabled(enabled))
}

export type CardSoundKind = "play" | "draw"

export function playCardSound(kind: CardSoundKind, count = 1) {
  if (typeof window === "undefined") return
  if (kind === "play") {
    playLocalSound("cardDrop", 0.75)
    if (count > 1) {
      for (let index = 1; index < Math.min(count, 4); index += 1) {
        window.setTimeout(() => playLocalSound("cardDrop", 0.55), index * 95)
      }
    }
    return
  }
  playLocalSound("cardTake", 0.7)
  if (count > 1) {
    for (let index = 1; index < Math.min(count, 6); index += 1) {
      window.setTimeout(() => playLocalSound("cardTake", 0.55), index * 110)
    }
  }
}

export function playShuffleSound() {
  if (typeof window === "undefined") return
  for (let index = 0; index < 4; index += 1) {
    window.setTimeout(
      () => playLocalSound("cardTake", 0.32 + Math.random() * 0.18),
      index * 80,
    )
  }
}
