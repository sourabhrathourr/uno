import { useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { useBeat } from "./beat-context"
import type { AmbientLight, PointLight } from "three"

/**
 * Room-wide light. Low and moody by default; the stage washes swell with the
 * music's energy and pulse on the kick.
 */
export function Lights() {
  const beat = useBeat()
  const washes = useRef<Array<PointLight | null>>([])
  const strobe = useRef<PointLight>(null)
  const ambient = useRef<AmbientLight>(null)

  useFrame(() => {
    washes.current.forEach((light, index) => {
      if (!light) return
      light.color.copy(beat.colors[index % 3])
      const level = beat.playing
        ? 6 + beat.energy * 14 * (0.45 + beat.pulse * 0.9)
        : 5
      light.intensity = level
    })
    if (strobe.current) strobe.current.intensity = beat.strobe * 60
    if (ambient.current)
      ambient.current.intensity = 0.9 + beat.pulse * 0.12 * beat.energy
  })

  const washSpots: Array<[number, number, number]> = [
    [-5, 3.2, -6],
    [5, 3.2, -6],
    [0, 4.2, -3],
    [-9, 3.5, 6],
    [9, 3.5, -8],
  ]
  return (
    <>
      <ambientLight ref={ambient} color="#5a4a82" intensity={0.9} />
      <hemisphereLight args={["#7a68c0", "#1a1220", 0.9]} />
      {washSpots.map((position, index) => (
        <pointLight
          key={index}
          ref={(light) => {
            washes.current[index] = light
          }}
          position={position}
          distance={16}
          decay={1.5}
          intensity={6}
        />
      ))}
      {/* Warm light by the entrance so faces read on the way in. */}
      <pointLight
        position={[0, 3.6, 10]}
        color="#ffb98a"
        intensity={7}
        distance={12}
        decay={1.5}
      />
      <pointLight
        ref={strobe}
        position={[0, 5, -8]}
        color="#ffffff"
        intensity={0}
        distance={22}
        decay={1.2}
      />
    </>
  )
}
