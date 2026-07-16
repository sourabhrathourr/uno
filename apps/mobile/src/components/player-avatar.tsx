import type { Player } from '@workspace/game';
import { Image, type ImageSource } from 'expo-image';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const PLAYER_AVATARS: ImageSource[] = [
  require('../../assets/avatars/bear.png'),
  require('../../assets/avatars/deer.png'),
  require('../../assets/avatars/fox.png'),
  require('../../assets/avatars/kola.png'),
  require('../../assets/avatars/lizard.png'),
  require('../../assets/avatars/panda.png'),
  require('../../assets/avatars/rabbit.png'),
  require('../../assets/avatars/racoon.png'),
  require('../../assets/avatars/tiger.png'),
  require('../../assets/avatars/wolf-blue.png'),
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

export function avatarSourceForPlayer(
  roomCode: string,
  players: Player[],
  playerId: string,
): ImageSource {
  let seed = hashString(roomCode);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...PLAYER_AVATARS];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const playerIndex = Math.max(
    0,
    sorted.findIndex((player) => player.id === playerId),
  );
  return shuffled[playerIndex % shuffled.length]!;
}

export function PlayerAvatar({
  roomCode,
  players,
  playerId,
  size = 38,
  style,
}: {
  roomCode: string;
  players: Player[];
  playerId: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.shell,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <Image
        source={avatarSourceForPlayer(roomCode, players, playerId)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={120}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});
