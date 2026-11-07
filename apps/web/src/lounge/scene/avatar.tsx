import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { DoubleSide } from "three"

import { hashString } from "../beat"
import { groundHeight } from "../physics"
import { bubbleTexture, labelTexture } from "../textures"
import { useBeat } from "./beat-context"
import type { WorldAvatarState } from "@workspace/game"
import type { Group, Mesh, Sprite } from "three"

export type AvatarLook = {
  body: string
  accent: string
  skin: string
  hat: "none" | "cap" | "beanie" | "headphones" | "bun"
}

const BODY_COLORS = [
  "#ff5d73",
  "#4d8dff",
  "#3ddc97",
  "#ffb84d",
  "#b06bff",
  "#ff7a3d",
  "#2ed1d1",
  "#f45dc8",
  "#9be15d",
  "#5d6bff",
]
const SKINS = ["#f5d0b5", "#e8b48f", "#c98e64", "#9a6644", "#6b4430", "#f2c6a0"]
const HATS: Array<AvatarLook["hat"]> = [
  "none",
  "cap",
  "beanie",
  "headphones",
  "bun",
  "none",
]

export function lookForPlayer(playerId: string): AvatarLook {
  const hash = hashString(playerId)
  return {
    body: BODY_COLORS[hash % BODY_COLORS.length],
    accent: BODY_COLORS[(hash >>> 5) % BODY_COLORS.length],
    skin: SKINS[(hash >>> 9) % SKINS.length],
    hat: HATS[(hash >>> 13) % HATS.length],
  }
}

export const DJ_LOOK: AvatarLook = {
  body: "#1c1c22",
  accent: "#ff3d9a",
  skin: "#c98e64",
  hat: "headphones",
}

type Props = {
  /** Read every frame. Mutate it to move the avatar. */
  state: { current: WorldAvatarState }
  look: AvatarLook
  name?: string
  /** Ease toward `state` instead of snapping (remote players). */
  smooth?: boolean
  speaking?: boolean
  crowned?: boolean
  bubble?: string | null
  badge?: string | null
  dj?: boolean
}

/**
 * A chunky toy-like character built from primitives, animated by hand: no
 * model files to load, and every pose follows the room's beat.
 */
export function Avatar({
  state,
  look,
  name,
  smooth = false,
  speaking = false,
  crowned = false,
  bubble = null,
  badge = null,
  dj = false,
}: Props) {
  const beat = useBeat()
  const root = useRef<Group>(null)
  const hips = useRef<Group>(null)
  const torso = useRef<Group>(null)
  const head = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const legL = useRef<Group>(null)
  const legR = useRef<Group>(null)
  const shadow = useRef<Mesh>(null)
  const tag = useRef<Group>(null)
  const pose = useRef({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    walk: 0,
    spin: 0,
    init: false,
  })

  const label = useMemo(
    () =>
      name
        ? labelTexture(name, {
            ring: speaking ? "#3ddc97" : null,
            background: dj ? "rgba(255,61,154,0.85)" : undefined,
          })
        : null,
    [name, speaking, dj]
  )
  const bubbleTex = useMemo(
    () => (bubble ? bubbleTexture(bubble) : null),
    [bubble]
  )
  const badgeTex = useMemo(
    () =>
      badge
        ? labelTexture(badge, {
            background: "#ffd23d",
            color: "#1a1200",
            size: 52,
          })
        : null,
    [badge]
  )

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const target = state.current
    const p = pose.current
    if (!p.init || !smooth) {
      p.x = target.x
      p.y = target.y
      p.z = target.z
      p.heading = target.heading
      p.init = true
    } else {
      const k = 1 - Math.exp(-dt * 12)
      const far = Math.hypot(target.x - p.x, target.z - p.z) > 4
      p.x = far ? target.x : p.x + (target.x - p.x) * k
      p.y = far ? target.y : p.y + (target.y - p.y) * k
      p.z = far ? target.z : p.z + (target.z - p.z) * k
      let delta = target.heading - p.heading
      delta = Math.atan2(Math.sin(delta), Math.cos(delta))
      p.heading += delta * k
    }

    const animation = target.animation
    const moving = animation === "walk" || animation === "run"
    p.walk += dt * (animation === "run" ? 13 : animation === "walk" ? 8.5 : 0)
    const t = beat.time
    const b = beat.beat
    const kick = beat.kick
    const swing = moving
      ? Math.sin(p.walk) * (animation === "run" ? 1.0 : 0.62)
      : 0

    let hipY = 0.78
    let lean = 0
    let sway = 0
    let headNod = 0
    let headTilt = 0
    let lArmX = -swing * 0.9
    let rArmX = swing * 0.9
    let lArmZ = 0.12
    let rArmZ = -0.12
    let lLegX = swing
    let rLegX = -swing
    let yaw = 0

    if (moving) {
      hipY += Math.abs(Math.cos(p.walk)) * (animation === "run" ? 0.09 : 0.05)
      lean = animation === "run" ? 0.22 : 0.06
    } else if (animation === "idle") {
      hipY += Math.sin(t * 2.1) * 0.008
      lArmZ = 0.1 + Math.sin(t * 1.3) * 0.03
      rArmZ = -lArmZ
      // Vibe to the music a little even when standing still.
      if (beat.playing) {
        headNod = kick * 0.16 * beat.energy
        hipY -= kick * 0.025 * beat.energy
      }
    } else if (animation === "jump") {
      lLegX = -0.55
      rLegX = -0.35
      lArmZ = 2.4
      rArmZ = -2.4
      lean = -0.05
    } else if (animation === "sit") {
      hipY = 0.5
      lLegX = -1.45
      rLegX = -1.45
      lArmX = -0.75
      rArmX = -0.75
      lArmZ = 0.05
      rArmZ = -0.05
      lean = 0.12
      if (beat.playing) headNod = kick * 0.08 * beat.energy
    } else {
      const dance = target.dance
      const beatIndex = Math.floor(b)
      const even = beatIndex % 2 === 0
      const bounce = Math.pow(1 - beat.phase, 2)
      if (dance === 0) {
        // Bounce + alternating fist pumps.
        hipY -= bounce * 0.1
        lArmX = even ? -2.6 + bounce * 0.8 : -0.4
        rArmX = even ? -0.4 : -2.6 + bounce * 0.8
        lArmZ = 0.3
        rArmZ = -0.3
        headNod = bounce * 0.25
        lLegX = bounce * 0.15
        rLegX = bounce * 0.15
      } else if (dance === 1) {
        // Hands up, swaying over two beats.
        const s = Math.sin((b / 2) * Math.PI)
        sway = s * 0.22
        lArmZ = 2.7 + s * 0.25
        rArmZ = -2.7 + s * 0.25
        hipY -= bounce * 0.05
        headTilt = s * 0.25
      } else if (dance === 2) {
        // Spin one turn per bar, arms out.
        yaw = ((b % 4) / 4) * Math.PI * 2
        lArmZ = 1.5
        rArmZ = -1.5
        hipY -= bounce * 0.06
        headTilt = 0.2
      } else {
        // Shuffle: kicks alternate each half beat.
        const half = Math.floor(b * 2) % 2 === 0
        lLegX = half ? -0.7 * bounce : 0.2
        rLegX = half ? 0.2 : -0.7 * bounce
        lArmX = -0.9
        rArmX = -0.9
        lArmZ = 0.6
        rArmZ = -0.6
        sway = (half ? 1 : -1) * 0.1
        hipY -= bounce * 0.06
      }
    }

    if (dj && beat.playing) {
      // Behind the decks: nod hard, one hand on the platter, the other up
      // on the first beat of each phrase.
      headNod = Math.pow(1 - beat.phase, 3) * 0.32
      hipY -= Math.pow(1 - beat.phase, 2) * 0.05
      rArmX = -1.25 + Math.sin(t * 9) * 0.12
      rArmZ = -0.35
      const barInPhrase = ((beat.bar % 8) + 8) % 8
      const handUp = barInPhrase === 0 || barInPhrase === 4
      lArmZ = handUp ? 2.6 + Math.sin(t * 6) * 0.15 : 0.35
      lArmX = handUp ? 0 : -1.2
      sway = Math.sin(b * Math.PI) * 0.06 * beat.energy
    }

    const k = 1 - Math.exp(-dt * 16)
    const ease = (current: number, next: number) =>
      current + (next - current) * k

    if (root.current) {
      root.current.position.set(p.x, p.y, p.z)
      p.spin =
        animation === "dance" && target.dance === 2 ? yaw : ease(p.spin, 0)
      root.current.rotation.y = p.heading + p.spin
    }
    if (hips.current) {
      hips.current.position.y = ease(hips.current.position.y, hipY)
      hips.current.rotation.z = ease(hips.current.rotation.z, sway)
    }
    if (torso.current)
      torso.current.rotation.x = ease(torso.current.rotation.x, lean)
    if (head.current) {
      head.current.rotation.x = ease(head.current.rotation.x, headNod)
      head.current.rotation.z = ease(head.current.rotation.z, headTilt)
    }
    if (armL.current) {
      armL.current.rotation.x = ease(armL.current.rotation.x, lArmX)
      armL.current.rotation.z = ease(armL.current.rotation.z, -lArmZ)
    }
    if (armR.current) {
      armR.current.rotation.x = ease(armR.current.rotation.x, rArmX)
      armR.current.rotation.z = ease(armR.current.rotation.z, -rArmZ)
    }
    if (legL.current)
      legL.current.rotation.x = ease(legL.current.rotation.x, lLegX)
    if (legR.current)
      legR.current.rotation.x = ease(legR.current.rotation.x, rLegX)

    if (shadow.current) {
      const ground = groundHeight(p.x, p.z, p.y)
      const height = Math.max(0, p.y - ground)
      shadow.current.position.y = ground - p.y + 0.012
      const scale = 1 / (1 + height * 0.8)
      shadow.current.scale.setScalar(scale)
      ;(shadow.current.material as { opacity: number }).opacity = 0.45 * scale
    }
    if (tag.current) tag.current.position.y = hipY + 1.32
  })

  return (
    <group ref={root}>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial
          color="#000"
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      </mesh>
      <group ref={hips} position-y={0.78}>
        {/* Legs */}
        <group ref={legL} position={[-0.13, 0, 0]}>
          <mesh position-y={-0.22}>
            <capsuleGeometry args={[0.095, 0.3, 4, 10]} />
            <meshStandardMaterial color={look.accent} roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.47, 0.05]} scale={[1, 0.6, 1.4]}>
            <sphereGeometry args={[0.1, 12, 10]} />
            <meshStandardMaterial color="#1a1a1f" roughness={0.5} />
          </mesh>
        </group>
        <group ref={legR} position={[0.13, 0, 0]}>
          <mesh position-y={-0.22}>
            <capsuleGeometry args={[0.095, 0.3, 4, 10]} />
            <meshStandardMaterial color={look.accent} roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.47, 0.05]} scale={[1, 0.6, 1.4]}>
            <sphereGeometry args={[0.1, 12, 10]} />
            <meshStandardMaterial color="#1a1a1f" roughness={0.5} />
          </mesh>
        </group>

        <group ref={torso}>
          <mesh position-y={0.3}>
            <capsuleGeometry args={[0.25, 0.32, 6, 16]} />
            <meshStandardMaterial color={look.body} roughness={0.55} />
          </mesh>

          {/* Arms hang from the shoulders and rotate there. */}
          <group ref={armL} position={[-0.31, 0.5, 0]}>
            <mesh position-y={-0.2}>
              <capsuleGeometry args={[0.075, 0.26, 4, 10]} />
              <meshStandardMaterial color={look.body} roughness={0.55} />
            </mesh>
            <mesh position-y={-0.4}>
              <sphereGeometry args={[0.075, 10, 8]} />
              <meshStandardMaterial color={look.skin} roughness={0.6} />
            </mesh>
          </group>
          <group ref={armR} position={[0.31, 0.5, 0]}>
            <mesh position-y={-0.2}>
              <capsuleGeometry args={[0.075, 0.26, 4, 10]} />
              <meshStandardMaterial color={look.body} roughness={0.55} />
            </mesh>
            <mesh position-y={-0.4}>
              <sphereGeometry args={[0.075, 10, 8]} />
              <meshStandardMaterial color={look.skin} roughness={0.6} />
            </mesh>
          </group>

          <group ref={head} position-y={0.78}>
            <mesh>
              <sphereGeometry args={[0.24, 24, 18]} />
              <meshStandardMaterial color={look.skin} roughness={0.6} />
            </mesh>
            {/* Eyes, with a glint so they read in the dark. */}
            {[-0.085, 0.085].map((x) => (
              <group key={x} position={[x, 0.03, 0.205]}>
                <mesh scale={[1, 1.35, 0.6]}>
                  <sphereGeometry args={[0.036, 10, 8]} />
                  <meshBasicMaterial color="#111" />
                </mesh>
                <mesh position={[0.012, 0.016, 0.018]}>
                  <sphereGeometry args={[0.011, 6, 6]} />
                  <meshBasicMaterial color="#fff" />
                </mesh>
              </group>
            ))}
            {[-0.14, 0.14].map((x) => (
              <mesh key={x} position={[x, -0.055, 0.185]} scale={[1, 0.6, 0.4]}>
                <sphereGeometry args={[0.04, 8, 6]} />
                <meshBasicMaterial color="#ff8a8a" transparent opacity={0.55} />
              </mesh>
            ))}
            <mesh position={[0, -0.075, 0.215]} rotation-x={0.15}>
              <torusGeometry args={[0.04, 0.01, 6, 12, Math.PI]} />
              <meshBasicMaterial color="#3a1d1d" side={DoubleSide} />
            </mesh>
            <Hat look={look} />
            {crowned && <Crown />}
          </group>
        </group>
      </group>

      <group ref={tag} position-y={2.1}>
        {label && (
          <sprite scale={[0.24 * label.aspect, 0.24, 1]}>
            <spriteMaterial
              map={label.texture}
              transparent
              depthWrite={false}
            />
          </sprite>
        )}
        {badgeTex && (
          <sprite position-y={0.3} scale={[0.26 * badgeTex.aspect, 0.26, 1]}>
            <spriteMaterial
              map={badgeTex.texture}
              transparent
              depthWrite={false}
            />
          </sprite>
        )}
        {bubbleTex && (
          <Bubble
            texture={bubbleTex.texture}
            aspect={bubbleTex.aspect}
            lifted={Boolean(badgeTex)}
          />
        )}
      </group>
    </group>
  )
}

function Bubble({
  texture,
  aspect,
  lifted,
}: {
  texture: ReturnType<typeof bubbleTexture>["texture"]
  aspect: number
  lifted: boolean
}) {
  const ref = useRef<Sprite>(null)
  const born = useRef(performance.now())
  useFrame(() => {
    const age = (performance.now() - born.current) / 1000
    const pop = Math.min(1, age * 6)
    const scale = 0.5 * (0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)))
    ref.current?.scale.set(scale * aspect, scale, 1)
  })
  return (
    <sprite ref={ref} position-y={lifted ? 0.72 : 0.42}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  )
}

function Hat({ look }: { look: AvatarLook }) {
  switch (look.hat) {
    case "cap":
      return (
        <group position-y={0.13}>
          <mesh scale={[1, 0.62, 1]}>
            <sphereGeometry
              args={[0.25, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]}
            />
            <meshStandardMaterial color={look.accent} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.0, 0.2]} rotation-x={-0.12}>
            <boxGeometry args={[0.3, 0.02, 0.2]} />
            <meshStandardMaterial color={look.accent} roughness={0.6} />
          </mesh>
        </group>
      )
    case "beanie":
      return (
        <group position-y={0.08}>
          <mesh scale={[1.05, 0.85, 1.05]}>
            <sphereGeometry
              args={[0.25, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]}
            />
            <meshStandardMaterial color={look.accent} roughness={0.9} />
          </mesh>
          <mesh position-y={0.22}>
            <sphereGeometry args={[0.06, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.9} />
          </mesh>
        </group>
      )
    case "headphones":
      return (
        <group>
          <mesh rotation-z={0} position-y={0.04}>
            <torusGeometry args={[0.26, 0.025, 8, 24, Math.PI]} />
            <meshStandardMaterial
              color="#222"
              roughness={0.4}
              metalness={0.4}
            />
          </mesh>
          {[-0.25, 0.25].map((x) => (
            <mesh key={x} position={[x, 0.02, 0]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.085, 0.085, 0.07, 16]} />
              <meshStandardMaterial
                color={look.accent}
                emissive={look.accent}
                emissiveIntensity={0.6}
                roughness={0.4}
              />
            </mesh>
          ))}
        </group>
      )
    case "bun":
      return (
        <mesh position={[0, 0.2, -0.12]}>
          <sphereGeometry args={[0.1, 12, 10]} />
          <meshStandardMaterial color="#2a1a12" roughness={0.8} />
        </mesh>
      )
    default:
      return null
  }
}

function Crown() {
  return (
    <group position-y={0.27}>
      <mesh>
        <cylinderGeometry args={[0.13, 0.15, 0.09, 5, 1, true]} />
        <meshStandardMaterial
          color="#ffd23d"
          emissive="#ffb000"
          emissiveIntensity={0.8}
          metalness={0.8}
          roughness={0.25}
          side={DoubleSide}
        />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (i / 5) * Math.PI * 2
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * 0.13, 0.08, Math.sin(angle) * 0.13]}
          >
            <coneGeometry args={[0.03, 0.08, 6]} />
            <meshStandardMaterial
              color="#ffd23d"
              emissive="#ffb000"
              emissiveIntensity={0.9}
              metalness={0.8}
              roughness={0.25}
            />
          </mesh>
        )
      })}
    </group>
  )
}
