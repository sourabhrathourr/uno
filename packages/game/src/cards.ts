export type CardColor = "red" | "green" | "blue" | "yellow" | "wild"

export type NumberValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type CardFace =
  | { kind: "number"; value: NumberValue }
  | { kind: "skip" }
  | { kind: "skip-everyone" }
  | { kind: "reverse" }
  | { kind: "draw"; count: 2 | 4 }
  | { kind: "discard-color" }
  | { kind: "wild" }
  | { kind: "wild-draw"; count: 4 | 6 | 10 }
  | { kind: "wild-reverse-draw"; count: 4 }
  | { kind: "wild-color-roulette" }

export type Card = {
  id: string
  color: CardColor
  face: CardFace
}
