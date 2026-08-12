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
