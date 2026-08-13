import type { Direction } from "./game"

/**
 * The order turns actually pass in, given a seating list and a direction.
 *
 * Play always opens with the first seat. Clockwise then follows the list as
 * written; counter-clockwise walks it backwards from that same opening seat.
 * Both the web and mobile seating editors use this to spell out what the
 * direction toggle will do, rather than leaving players to guess.
 */
export function turnOrderFromSeating<T>(
  seating: T[],
  direction: Direction
): T[] {
  if (seating.length <= 2 || direction === 1) return [...seating]

  const [first, ...rest] = seating
  return [first as T, ...rest.reverse()]
}

/**
 * Seat avatars shrink fast as a table fills up, and on small screens the
 * picture stops being readable well before the eight-player limit. Initials
 * are the fallback identity: "Rushil" reads as RU, "Rushil Mehta" as RM.
 */
export function playerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "??"

  const first = words[0] as string
  if (words.length === 1) return first.slice(0, 2).toUpperCase()

  const second = words[1] as string
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase()
}
