import type { Card, CardColor, CardFace, NumberValue } from "./cards"

const colors: Array<Exclude<CardColor, "wild">> = ["red", "yellow", "green", "blue"]

export function createNoMercyDeck(): Card[] {
  const deck: Card[] = []

  for (const color of colors) {
    for (let copy = 1; copy <= 2; copy += 1) {
      for (let value = 0; value <= 9; value += 1) {
        deck.push(
          makeCard(color, { kind: "number", value: value as NumberValue }, copy),
        )
      }
    }

    addCopies(deck, color, { kind: "draw", count: 2 }, 3)
    addCopies(deck, color, { kind: "draw", count: 4 }, 2)
    addCopies(deck, color, { kind: "skip" }, 3)
    addCopies(deck, color, { kind: "skip-everyone" }, 2)
    addCopies(deck, color, { kind: "reverse" }, 3)
    addCopies(deck, color, { kind: "discard-color" }, 3)
  }

  addCopies(deck, "wild", { kind: "wild-reverse-draw", count: 4 }, 8)
  addCopies(deck, "wild", { kind: "wild-draw", count: 6 }, 4)
  addCopies(deck, "wild", { kind: "wild-draw", count: 10 }, 4)
  addCopies(deck, "wild", { kind: "wild-color-roulette" }, 8)

  return deck
}

export function shuffleCards(cards: Card[], random = Math.random): Card[] {
  const copy = [...cards]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const value = copy[i]
    copy[i] = copy[j] as Card
    copy[j] = value as Card
  }
  return copy
}

function addCopies(deck: Card[], color: CardColor, face: CardFace, count: number) {
  for (let copy = 1; copy <= count; copy += 1) {
    deck.push(makeCard(color, face, copy))
  }
}

function makeCard(color: CardColor, face: CardFace, copy: number): Card {
  return {
    id: `${color}:${faceKey(face)}:${copy}`,
    color,
    face,
  }
}

function faceKey(face: CardFace): string {
  switch (face.kind) {
    case "number":
      return `n${face.value}`
    case "draw":
      return `draw${face.count}`
    case "wild-draw":
      return `wild-draw${face.count}`
    case "wild-reverse-draw":
      return `wild-reverse-draw${face.count}`
    default:
      return face.kind
  }
}
