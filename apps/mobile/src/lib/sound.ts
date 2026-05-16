import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';
import { useEffect, useState } from 'react';

type SoundOptions = {
  volume?: number;
  playbackRate?: number;
};

const SOUND_ENABLED_KEY = 'uno:sfx-enabled';

const SOUNDS = {
  buttonSoft: require('@/assets/sounds/ui/button_soft.mp3'),
  buttonHard: require('@/assets/sounds/ui/button_hard.mp3'),
  toggleOn: require('@/assets/sounds/ui/toggle_on.mp3'),
  toggleOff: require('@/assets/sounds/ui/toggle_off.mp3'),
  popOpen: require('@/assets/sounds/ui/pop_open.mp3'),
  popupOpen: require('@/assets/sounds/ui/popup_open.mp3'),
  successChime: require('@/assets/sounds/ui/success_chime.mp3'),
  successBlip: require('@/assets/sounds/ui/success_blip.mp3'),
  successBling: require('@/assets/sounds/ui/success_bling.mp3'),
  itemSelect: require('@/assets/sounds/ui/item_select.mp3'),
  itemDeselect: require('@/assets/sounds/ui/item_deselect.mp3'),
  copy: require('@/assets/sounds/ui/copy.mp3'),
  blocked: require('@/assets/sounds/ui/blocked.mp3'),
  panelExpand: require('@/assets/sounds/ui/panel_expand.mp3'),
  bootUp: require('@/assets/sounds/system/boot_up.mp3'),
  coinBling: require('@/assets/sounds/arcade/coin_bling.mp3'),
  powerUp: require('@/assets/sounds/arcade/power_up.mp3'),
  levelUp: require('@/assets/sounds/arcade/level_up.mp3'),
  notify: require('@/assets/sounds/notification/info.mp3'),
  success: require('@/assets/sounds/notification/success.mp3'),
  cardDrop: require('@/assets/sounds/card-drop.mp3'),
  cardTake: require('@/assets/sounds/card-take.mp3'),
} as const;

export type LibrarySound = Exclude<keyof typeof SOUNDS, 'cardDrop' | 'cardTake'>;
export type CardSoundKind = 'play' | 'draw';

const players = new Map<keyof typeof SOUNDS, AudioPlayer>();
let soundEnabled = true;
let started = false;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getPlayer(name: keyof typeof SOUNDS): AudioPlayer {
  let player = players.get(name);
  if (!player) {
    player = createAudioPlayer(SOUNDS[name], {
      downloadFirst: true,
      keepAudioSessionActive: true,
      updateInterval: 1000,
    });
    players.set(name, player);
  }
  return player;
}

export async function startSoundSystem(): Promise<void> {
  if (started) return;
  started = true;

  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'mixWithOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => undefined);

  const stored = await AsyncStorage.getItem(SOUND_ENABLED_KEY).catch(() => null);
  soundEnabled = stored === null ? true : stored === 'true';

  Object.keys(SOUNDS).forEach((name) => {
    getPlayer(name as keyof typeof SOUNDS);
  });
}

export function isSfxEnabled(): boolean {
  return soundEnabled;
}

export function setSfxEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  void AsyncStorage.setItem(SOUND_ENABLED_KEY, String(enabled)).catch(() => undefined);
}

export function playFx(name: LibrarySound, options?: SoundOptions): void {
  playSound(name, options);
}

export function playCardSound(kind: CardSoundKind, count = 1): void {
  if (kind === 'play') {
    playSound('cardDrop', { volume: 0.75 });
    for (let index = 1; index < Math.min(count, 4); index += 1) {
      setTimeout(() => playSound('cardDrop', { volume: 0.55 }), index * 95);
    }
    return;
  }

  playSound('cardTake', { volume: 0.7 });
  for (let index = 1; index < Math.min(count, 6); index += 1) {
    setTimeout(() => playSound('cardTake', { volume: 0.55 }), index * 110);
  }
}

export function playShuffleSound(): void {
  for (let index = 0; index < 4; index += 1) {
    setTimeout(
      () => playSound('cardTake', { volume: 0.32 + Math.random() * 0.18 }),
      index * 80,
    );
  }
}

export function playWinnerSound(firstPlace = false): void {
  const sequence: {
    delay: number;
    sound: LibrarySound;
    volume: number;
    playbackRate?: number;
  }[] = firstPlace
    ? [
        { delay: 0, sound: 'powerUp', volume: 0.56, playbackRate: 0.92 },
        { delay: 130, sound: 'successChime', volume: 0.78 },
        { delay: 340, sound: 'levelUp', volume: 0.74, playbackRate: 1.04 },
        { delay: 610, sound: 'coinBling', volume: 0.62, playbackRate: 0.94 },
        { delay: 760, sound: 'coinBling', volume: 0.42, playbackRate: 1.18 },
      ]
    : [
        { delay: 0, sound: 'successChime', volume: 0.58 },
        { delay: 220, sound: 'coinBling', volume: 0.42, playbackRate: 1.08 },
      ];

  setTimeout(
    () => playSound('cardDrop', { volume: firstPlace ? 0.34 : 0.24 }),
    30,
  );
  sequence.forEach((item) => {
    setTimeout(
      () =>
        playFx(item.sound, {
          volume: item.volume,
          playbackRate: item.playbackRate,
        }),
      item.delay,
    );
  });
}

function playSound(name: keyof typeof SOUNDS, options?: SoundOptions): void {
  if (!soundEnabled) return;

  const player = getPlayer(name);
  player.volume = clamp01(options?.volume ?? 0.7);
  if (options?.playbackRate) player.setPlaybackRate(options.playbackRate);
  void player.seekTo(0).finally(() => {
    player.play();
  });
}

export function useSoundSystem() {
  const [enabled, setEnabledState] = useState(soundEnabled);

  useEffect(() => {
    let cancelled = false;
    void startSoundSystem().then(() => {
      if (!cancelled) setEnabledState(soundEnabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function setEnabled(nextEnabled: boolean) {
    setSfxEnabled(nextEnabled);
    setEnabledState(nextEnabled);
  }

  return { enabled, setEnabled };
}
