type SoundOptions = {
  volume?: number
  playbackRate?: number
  loop?: boolean
}

type ReactSoundsModule = {
  playSound: (name: string, options?: SoundOptions) => Promise<void>
  preloadSounds: (names: Array<string>) => Promise<void>
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

/**
 * Card sounds run through Web Audio rather than `<audio>` elements.
 *
 * The old path cloned an `<audio>` node per hit and called play(). Each clone
 * carries its own decode and start-up latency, so firing several in quick
 * succession — drawing fast, or a big penalty — started the same clip at
 * slightly different offsets and comb-filtered into that warbling, glitchy
 * noise. One decoded buffer replayed through gain nodes starts sample-accurate
 * every time, and overlapping copies simply sum cleanly.
 */
let sharedAudioContext: AudioContext | null = null
const decodedBuffers = new Map<LocalSoundName, AudioBuffer>()
const decodeInFlight = new Set<LocalSoundName>()
/** Beyond this many overlapping copies the mix just turns to mud. */
const MAX_CONCURRENT_VOICES = 3
const activeVoices = new Map<LocalSoundName, number>()

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AudioContextClass) return null

  sharedAudioContext ??= new AudioContextClass()
  // Browsers suspend the context until a gesture; nudge it on every play.
  if (sharedAudioContext.state === "suspended") {
    void sharedAudioContext.resume().catch(() => {})
  }
  return sharedAudioContext
}

function decodeLocalSound(name: LocalSoundName) {
  const context = getAudioContext()
  if (!context || decodedBuffers.has(name) || decodeInFlight.has(name)) return
  decodeInFlight.add(name)

  void fetch(LOCAL_SOUNDS[name])
    .then((response) => response.arrayBuffer())
    .then((data) => context.decodeAudioData(data))
    .then((buffer) => {
      decodedBuffers.set(name, buffer)
    })
    .catch(() => {
      // Falls back to the <audio> path below.
    })
    .finally(() => {
      decodeInFlight.delete(name)
    })
}

export function playLocalSound(name: LocalSoundName, volume = 0.7) {
  if (typeof window === "undefined") return
  if (!isSfxEnabled()) return

  const safeVolume = Math.max(0, Math.min(1, volume))
  const context = getAudioContext()
  const buffer = decodedBuffers.get(name)

  // A context still waiting on a user gesture would start silently, so the
  // element path covers that case.
  if (context && buffer && context.state === "running") {
    if ((activeVoices.get(name) ?? 0) >= MAX_CONCURRENT_VOICES) return

    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    gain.gain.value = safeVolume
    source.connect(gain).connect(context.destination)

    activeVoices.set(name, (activeVoices.get(name) ?? 0) + 1)
    source.onended = () => {
      activeVoices.set(name, Math.max(0, (activeVoices.get(name) ?? 1) - 1))
      source.disconnect()
      gain.disconnect()
    }
    source.start()
    return
  }

  // Not decoded yet (or no Web Audio at all): start decoding for next time and
  // fall back to a cloned element so this hit is not silent.
  decodeLocalSound(name)
  const base = getLocalAudio(name)
  if (!base) return
  const clone = base.cloneNode(true) as HTMLAudioElement
  clone.volume = safeVolume
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
  successBling: "ui/success_bling",
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

  window.setTimeout(
    () => playLocalSound("cardDrop", firstPlace ? 0.34 : 0.24),
    30
  )
  for (const item of sequence) {
    window.setTimeout(
      () =>
        playFx(item.sound, {
          volume: item.volume,
          playbackRate: item.playbackRate,
        }),
      item.delay
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
    // Decode up front so the very first card sound is already sample-accurate.
    decodeLocalSound(name as LocalSoundName)
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

/**
 * Drawing used to fire one clip per card, staggered. Two draws in quick
 * succession then overlapped half a dozen voices and phased into a mess. A
 * draw is one action, so it gets one sound — a little louder when it is a big
 * penalty — and back-to-back draws collapse into a single hit.
 */
const MIN_DRAW_SOUND_GAP_MS = 90
let lastDrawSoundAt = 0

export function playCardSound(kind: CardSoundKind, count = 1) {
  if (typeof window === "undefined") return
  if (kind === "play") {
    playLocalSound("cardDrop", 0.75)
    if (count > 1) {
      for (let index = 1; index < Math.min(count, 3); index += 1) {
        window.setTimeout(() => playLocalSound("cardDrop", 0.5), index * 95)
      }
    }
    return
  }

  const now = Date.now()
  if (now - lastDrawSoundAt < MIN_DRAW_SOUND_GAP_MS) return
  lastDrawSoundAt = now
  // Weight rather than repeat: a +10 lands heavier than a single draw.
  playLocalSound("cardTake", count > 1 ? 0.85 : 0.7)
}

export function playShuffleSound() {
  if (typeof window === "undefined") return
  for (let index = 0; index < 4; index += 1) {
    window.setTimeout(
      () => playLocalSound("cardTake", 0.32 + Math.random() * 0.18),
      index * 80
    )
  }
}
