import type { Card, CardColor, CardFace } from '@workspace/game';
import type { CardSize } from '@workspace/uno-card-tokens';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UnoCardMobile } from '@/components/uno-card-mobile';
import { Spacing } from '@/constants/theme';

const colors: Exclude<CardColor, 'wild'>[] = [
  'red',
  'yellow',
  'green',
  'blue',
];

function id(parts: string[]) {
  return parts.join(':');
}

function makeNumberRow(): Card[] {
  const out: Card[] = [];
  for (const c of colors) {
    for (let v = 0; v <= 9; v++) {
      out.push({
        id: id([c, 'n', String(v)]),
        color: c,
        face: { kind: 'number', value: v as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 },
      });
    }
  }
  return out;
}

function makeActionRow(): Card[] {
  const out: Card[] = [];
  for (const c of colors) {
    const faces: CardFace[] = [
      { kind: 'skip' },
      { kind: 'reverse' },
      { kind: 'draw', count: 2 },
      { kind: 'draw', count: 4 },
    ];
    faces.forEach((face, i) => {
      out.push({ id: id([c, 'a', String(i)]), color: c, face });
    });
  }
  return out;
}

function makeSpecialsRow(): Card[] {
  return colors.map((c) => ({
    id: id([c, 'discard']),
    color: c,
    face: { kind: 'discard-color' },
  }));
}

function makeWildRow(): Card[] {
  return [
    { id: 'wild', color: 'wild', face: { kind: 'wild' } },
    { id: 'wild:d4', color: 'wild', face: { kind: 'wild-draw', count: 4 } },
    { id: 'wild:d6', color: 'wild', face: { kind: 'wild-draw', count: 6 } },
    { id: 'wild:d10', color: 'wild', face: { kind: 'wild-draw', count: 10 } },
    {
      id: 'wild:rd4',
      color: 'wild',
      face: { kind: 'wild-reverse-draw', count: 4 },
    },
    {
      id: 'wild:roulette',
      color: 'wild',
      face: { kind: 'wild-color-roulette' },
    },
  ];
}

const sizeOptions: CardSize[] = ['sm', 'md', 'lg', 'xl'];

export default function CardsLabScreen() {
  const [size, setSize] = useState<CardSize>('md');
  const [faceDown, setFaceDown] = useState(false);

  const numbers = makeNumberRow();
  const actions = makeActionRow();
  const specials = makeSpecialsRow();
  const wilds = makeWildRow();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.eyebrow}>UNO No Mercy · Components</Text>
            <Text style={styles.title}>Card lab</Text>
            <Text style={styles.subtitle}>
              The foundational mobile card. Tap to press, hold for haptic
              feedback. Every face is composed from the same metallic surface
              plus a swappable glyph.
            </Text>
          </View>

          <View style={styles.toolbar}>
            <SegGroup
              label="Size"
              value={size}
              options={sizeOptions}
              onChange={setSize}
            />
            <Toggle
              value={faceDown}
              onChange={setFaceDown}
              labelOn="Back"
              labelOff="Face"
            />
          </View>

          <Section
            label="Numbers"
            hint="0–9 across all four colors. The chunky underline distinguishes 6 / 9 when held inverted."
          >
            <Grid>
              {numbers.map((c) => (
                <UnoCardMobile
                  key={c.id}
                  card={c}
                  size={size}
                  faceDown={faceDown}
                />
              ))}
            </Grid>
          </Section>

          <Section
            label="Action cards"
            hint="Skip, Reverse, Draw 2, Draw 4. Same color, different verbs."
          >
            <Grid>
              {actions.map((c) => (
                <UnoCardMobile
                  key={c.id}
                  card={c}
                  size={size}
                  faceDown={faceDown}
                />
              ))}
            </Grid>
          </Section>

          <Section
            label="Specials"
            hint="Discard Color (dump every card of one color) in all four colors."
          >
            <Grid>
              {specials.map((c) => (
                <UnoCardMobile
                  key={c.id}
                  card={c}
                  size={size}
                  faceDown={faceDown}
                />
              ))}
            </Grid>
          </Section>

          <Section
            label="Wilds"
            hint="The black metals. Wild Draw 4 / 6 / 10 are the No Mercy escalation ladder."
          >
            <Grid>
              {wilds.map((c) => (
                <UnoCardMobile
                  key={c.id}
                  card={c}
                  size={size}
                  faceDown={faceDown}
                />
              ))}
            </Grid>
          </Section>

          <Section
            label="Hand preview"
            hint="A small hand at the current size. Tap a card to raise it."
          >
            <HandPreview size={size} />
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionHint} numberOfLines={3}>
          {hint}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

function SegGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segGroup}>
      <Text style={styles.segLabel}>{label}</Text>
      <View style={styles.segOptions}>
        {options.map((opt) => {
          const active = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={[styles.segButton, active && styles.segButtonActive]}
            >
              <Text
                style={[
                  styles.segButtonLabel,
                  active && styles.segButtonLabelActive,
                ]}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Toggle({
  value,
  onChange,
  labelOn,
  labelOff,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.toggle}>
      <Text style={styles.toggleLabel}>{value ? labelOn : labelOff}</Text>
    </Pressable>
  );
}

function HandPreview({ size }: { size: CardSize }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cards: Card[] = [
    { id: 'h1', color: 'red', face: { kind: 'number', value: 7 } },
    { id: 'h2', color: 'blue', face: { kind: 'draw', count: 2 } },
    { id: 'h3', color: 'green', face: { kind: 'skip' } },
    { id: 'h4', color: 'yellow', face: { kind: 'reverse' } },
    { id: 'h5', color: 'wild', face: { kind: 'wild-draw', count: 6 } },
    { id: 'h6', color: 'blue', face: { kind: 'number', value: 0 } },
    { id: 'h7', color: 'wild', face: { kind: 'wild' } },
  ];
  return (
    <View style={styles.hand}>
      {cards.map((c) => (
        <UnoCardMobile
          key={c.id}
          card={c}
          size={size}
          raised={selectedId === c.id}
          onPress={() =>
            setSelectedId((prev) => (prev === c.id ? null : c.id))
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  safe: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six + 96,
    gap: Spacing.five,
  },
  header: {
    gap: Spacing.two,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  title: {
    color: 'white',
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.6,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 480,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    flexWrap: 'wrap',
  },
  segGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  segLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '500',
    paddingHorizontal: 4,
  },
  segOptions: {
    flexDirection: 'row',
    gap: 4,
  },
  segButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  segButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  segButtonLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  segButtonLabelActive: {
    color: 'white',
  },
  toggle: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  toggleLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '500',
  },
  section: {
    gap: Spacing.three,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  sectionLabel: {
    color: 'white',
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 0,
  },
  sectionHint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
    textAlign: 'right',
  },
  sectionBody: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.015)',
    padding: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  hand: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'flex-end',
  },
});
