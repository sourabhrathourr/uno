/** ICE already supplies a generation ID, including for clients without exchange IDs. */
export function iceUsernameFragments(sdp: string | undefined): Set<string> {
  return new Set(
    Array.from(
      (sdp ?? "").matchAll(/^a=ice-ufrag:(\S+)/gm),
      (match) => match[1]
    )
  )
}

export function candidateMatchesDescription(
  candidate: RTCIceCandidateInit,
  sdp: string | undefined
) {
  const fragment =
    candidate.usernameFragment ??
    candidate.candidate?.match(/\bufrag (\S+)/)?.[1]
  return !fragment || iceUsernameFragments(sdp).has(fragment)
}
