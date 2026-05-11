import {
  isSoundEnabled,
  playSound as playLibrarySound,
  preloadSounds,
  setSoundEnabled,
  type SoundOptions,
} from "react-sounds"

const LOCAL_SOUNDS = {
  cardDrop: "/card-drop.mp3",
  cardTake: "/card-take.mp3",
} as const

export type LocalSoundName = keyof typeof LOCAL_SOUNDS

const localCache = new Map<LocalSoundName, HTMLAudioElement>()

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
  if (!isSoundEnabled()) return
  const base = getLocalAudio(name)
  if (!base) return
  const clone = base.cloneNode(true) as HTMLAudioElement
  clone.volume = Math.max(0, Math.min(1, volume))
  void clone.play().catch(() => {})
}

export function playLibrary(
  name: Parameters<typeof playLibrarySound>[0],
  options?: SoundOptions,
) {
  if (typeof window === "undefined") return
  void playLibrarySound(name, options).catch(() => {})
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

const PRELOAD_LIST: Parameters<typeof preloadSounds>[0] = Object.values(SOUNDS)

let preloadStarted = false
export function startSoundSystem() {
  if (typeof window === "undefined") return
  if (preloadStarted) return
  preloadStarted = true
  void preloadSounds(PRELOAD_LIST).catch(() => {})
  Object.keys(LOCAL_SOUNDS).forEach((name) => {
    getLocalAudio(name as LocalSoundName)
  })
}

export function isSfxEnabled() {
  if (typeof window === "undefined") return true
  return isSoundEnabled()
}

export function setSfxEnabled(enabled: boolean) {
  if (typeof window === "undefined") return
  setSoundEnabled(enabled)
}

export type CardSoundKind = "play" | "draw"

export function playCardSound(kind: CardSoundKind, count = 1) {
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
  for (let index = 0; index < 4; index += 1) {
    window.setTimeout(
      () => playLocalSound("cardTake", 0.32 + Math.random() * 0.18),
      index * 80,
    )
  }
}
