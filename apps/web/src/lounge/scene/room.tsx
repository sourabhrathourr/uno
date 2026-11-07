import { useEffect, useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
} from "three"

import { BAR, BAR_BACK, COFFEE_TABLE, COUCHES, ROOM, TABLE } from "../layout"
import { neonTexture } from "../textures"
import { useBeat } from "./beat-context"
import type {
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Points,
  PointsMaterial,
  SpotLight,
} from "three"
import type { ThreeElements } from "@react-three/fiber"

export function Room() {
  const { halfWidth: hw, halfDepth: hd, height } = ROOM
  return (
    <group>
      {/* Polished dark floor: catches the colour of every light. */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[hw * 2, hd * 2]} />
        <meshStandardMaterial
          color="#141118"
          roughness={0.32}
          metalness={0.35}
        />
      </mesh>
      {/* Ceiling */}
      <mesh rotation-x={Math.PI / 2} position-y={height}>
        <planeGeometry args={[hw * 2, hd * 2]} />
        <meshStandardMaterial color="#09080b" roughness={0.95} />
      </mesh>
      <Walls />
      <NeonStrips />
      <NeonSign
        text="No Mercy"
        color="#ff3d9a"
        position={[-hw + 0.06, 3.6, 1.2]}
        rotationY={Math.PI / 2}
        width={4.2}
      />
      <NeonSign
        text="uno lounge"
        color="#3dd6ff"
        position={[0, 3.4, hd - 0.06]}
        rotationY={Math.PI}
        width={5}
      />
      <NeonSign
        text="bar"
        color="#ffb84d"
        position={[hw - 0.06, 4.1, 0.5]}
        rotationY={-Math.PI / 2}
        width={2.2}
      />
      <Bar />
      <Couches />
      <Rug />
      <TableLamp />
      <Plants />
      <Haze />
    </group>
  )
}

function Walls() {
  const { halfWidth: hw, halfDepth: hd, height } = ROOM
  const panels = useMemo(() => {
    const list: Array<{ x: number; z: number; ry: number; w: number }> = []
    for (let i = -6; i <= 6; i++) {
      list.push({ x: i * 2.1, z: hd - 0.04, ry: Math.PI, w: 1.9 })
      list.push({ x: -hw + 0.04, z: i * 2.1, ry: Math.PI / 2, w: 1.9 })
    }
    return list
  }, [hw, hd])
  return (
    <group>
      {[
        { position: [0, height / 2, -hd] as const, ry: 0, w: hw * 2 },
        { position: [0, height / 2, hd] as const, ry: Math.PI, w: hw * 2 },
        { position: [-hw, height / 2, 0] as const, ry: Math.PI / 2, w: hd * 2 },
        { position: [hw, height / 2, 0] as const, ry: -Math.PI / 2, w: hd * 2 },
      ].map((wall, index) => (
        <mesh key={index} position={wall.position} rotation-y={wall.ry}>
          <planeGeometry args={[wall.w, height]} />
          <meshStandardMaterial color="#0f0d13" roughness={0.85} />
        </mesh>
      ))}
      {/* Acoustic panels give the walls some texture under coloured light. */}
      {panels.map((panel, index) => (
        <mesh
          key={index}
          position={[panel.x, 2.3, panel.z]}
          rotation-y={panel.ry}
        >
          <boxGeometry args={[panel.w, 3.2, 0.06]} />
          <meshStandardMaterial
            color={index % 2 ? "#17141c" : "#141119"}
            roughness={0.95}
          />
        </mesh>
      ))}
    </group>
  )
}

/** Thin light strips along the top of the walls, breathing with the music. */
function NeonStrips() {
  const beat = useBeat()
  const materials = useRef<Array<MeshStandardMaterial | null>>([])
  const { halfWidth: hw, halfDepth: hd } = ROOM
  const y = 5.2
  const strips = [
    {
      position: [0, y, hd - 0.05] as const,
      size: [hw * 2, 0.05, 0.05] as const,
    },
    {
      position: [-hw + 0.05, y, 0] as const,
      size: [0.05, 0.05, hd * 2] as const,
    },
    {
      position: [hw - 0.05, y, 0] as const,
      size: [0.05, 0.05, hd * 2] as const,
    },
    {
      position: [0, 0.06, hd - 0.05] as const,
      size: [hw * 2, 0.03, 0.03] as const,
    },
    {
      position: [-hw + 0.05, 0.06, 0] as const,
      size: [0.03, 0.03, hd * 2] as const,
    },
  ]
  useFrame(() => {
    materials.current.forEach((material, index) => {
      if (!material) return
      material.emissive.copy(beat.colors[index % 3])
      material.emissiveIntensity = 1.4 + beat.pulse * 1.8 * beat.energy
    })
  })
  return (
    <group>
      {strips.map((strip, index) => (
        <mesh key={index} position={strip.position}>
          <boxGeometry args={strip.size} />
          <meshStandardMaterial
            ref={(material) => {
              materials.current[index] = material
            }}
            color="#000"
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function NeonSign({
  text,
  color,
  position,
  rotationY,
  width,
}: {
  text: string
  color: string
  position: [number, number, number]
  rotationY: number
  width: number
}) {
  const texture = useMemo(() => neonTexture(text, color), [text, color])
  const image = texture.image
  const height = (width * image.height) / image.width
  const material = useRef<{ opacity: number }>(null)
  const seed = useMemo(() => Math.random() * 10, [])
  useFrame(({ clock }) => {
    // The odd neon flicker.
    const t = clock.elapsedTime + seed
    const flicker = Math.sin(t * 0.7) > 0.985 ? 0.4 : 1
    if (material.current) material.current.opacity = flicker
  })
  return (
    <mesh position={position} rotation-y={rotationY}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        ref={material as never}
        map={texture}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
        color={new Color(1.6, 1.6, 1.6)}
      />
    </mesh>
  )
}

function Bar() {
  const shelfLight = useRef<PointLight>(null)
  const counterHeight = BAR.top
  const length = BAR.maxZ - BAR.minZ
  const centerZ = (BAR.minZ + BAR.maxZ) / 2
  const bottles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, index) => ({
        z: BAR_BACK.minZ + 0.6 + index * 0.55,
        shelf: index % 2,
        color: ["#3dd6c6", "#ffb84d", "#ff5d73", "#b06bff", "#9be15d"][
          index % 5
        ],
        height: 0.28 + ((index * 37) % 10) / 60,
      })),
    []
  )
  return (
    <group>
      <mesh position={[(BAR.minX + BAR.maxX) / 2, counterHeight / 2, centerZ]}>
        <boxGeometry args={[BAR.maxX - BAR.minX, counterHeight, length]} />
        <meshStandardMaterial color="#1a1310" roughness={0.6} />
      </mesh>
      <mesh
        position={[
          (BAR.minX + BAR.maxX) / 2 - 0.05,
          counterHeight + 0.03,
          centerZ,
        ]}
      >
        <boxGeometry args={[BAR.maxX - BAR.minX + 0.25, 0.06, length + 0.2]} />
        <meshStandardMaterial
          color="#2a211c"
          roughness={0.25}
          metalness={0.4}
        />
      </mesh>
      {/* Under-counter glow strip. */}
      <mesh position={[BAR.minX - 0.01, 0.12, centerZ]}>
        <boxGeometry args={[0.02, 0.04, length]} />
        <meshStandardMaterial
          color="#000"
          emissive="#3dd6c6"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      {/* Back shelves with backlit bottles. */}
      <mesh
        position={[
          (BAR_BACK.minX + BAR_BACK.maxX) / 2,
          BAR_BACK.top / 2,
          (BAR_BACK.minZ + BAR_BACK.maxZ) / 2,
        ]}
      >
        <boxGeometry
          args={[
            BAR_BACK.maxX - BAR_BACK.minX,
            BAR_BACK.top,
            BAR_BACK.maxZ - BAR_BACK.minZ,
          ]}
        />
        <meshStandardMaterial color="#120e0c" roughness={0.7} />
      </mesh>
      {[1.3, 1.95].map((y) => (
        <mesh
          key={y}
          position={[
            BAR_BACK.minX - 0.12,
            y,
            (BAR_BACK.minZ + BAR_BACK.maxZ) / 2,
          ]}
        >
          <boxGeometry
            args={[0.3, 0.03, BAR_BACK.maxZ - BAR_BACK.minZ - 0.4]}
          />
          <meshStandardMaterial
            color="#000"
            emissive="#ffb84d"
            emissiveIntensity={1.2}
            toneMapped={false}
          />
        </mesh>
      ))}
      {bottles.map((bottle, index) => (
        <mesh
          key={index}
          position={[
            BAR_BACK.minX - 0.12,
            (bottle.shelf ? 1.95 : 1.3) + 0.015 + bottle.height / 2,
            bottle.z,
          ]}
        >
          <cylinderGeometry args={[0.05, 0.06, bottle.height, 10]} />
          <meshStandardMaterial
            color={bottle.color}
            emissive={bottle.color}
            emissiveIntensity={0.9}
            transparent
            opacity={0.85}
            roughness={0.1}
          />
        </mesh>
      ))}
      {/* Stools */}
      {[-3.5, -1.5, 0.5, 2.5, 4.5].map((z) => (
        <group key={z} position={[BAR.minX - 0.65, 0, z]}>
          <mesh position-y={0.38}>
            <cylinderGeometry args={[0.03, 0.03, 0.76, 8]} />
            <meshStandardMaterial
              color="#888"
              metalness={0.9}
              roughness={0.25}
            />
          </mesh>
          <mesh position-y={0.78}>
            <cylinderGeometry args={[0.2, 0.2, 0.07, 18]} />
            <meshStandardMaterial color="#7a2a3a" roughness={0.5} />
          </mesh>
        </group>
      ))}
      <pointLight
        ref={shelfLight}
        position={[12.6, 2.6, 1]}
        color="#ffb070"
        intensity={9}
        distance={9}
        decay={1.6}
      />
    </group>
  )
}

function Couches() {
  return (
    <group>
      {COUCHES.map((couch, index) => {
        const w = couch.maxX - couch.minX
        const d = couch.maxZ - couch.minZ
        const cx = (couch.minX + couch.maxX) / 2
        const cz = (couch.minZ + couch.maxZ) / 2
        // Backrest along the side touching the wall or the far edge.
        const back =
          index === 0
            ? { x: couch.minX + 0.15, z: cz, w: 0.3, d }
            : index === 1
              ? { x: cx, z: couch.maxZ - 0.15, w, d: 0.3 }
              : { x: cx, z: couch.minZ + 0.15, w, d: 0.3 }
        return (
          <group key={index}>
            <mesh position={[cx, couch.top / 2, cz]}>
              <boxGeometry args={[w, couch.top, d]} />
              <meshStandardMaterial color="#3b2350" roughness={0.9} />
            </mesh>
            <mesh position={[back.x, couch.top + 0.3, back.z]}>
              <boxGeometry args={[back.w, 0.6, back.d]} />
              <meshStandardMaterial color="#45285e" roughness={0.9} />
            </mesh>
          </group>
        )
      })}
      <mesh
        position={[
          (COFFEE_TABLE.minX + COFFEE_TABLE.maxX) / 2,
          COFFEE_TABLE.top / 2,
          (COFFEE_TABLE.minZ + COFFEE_TABLE.maxZ) / 2,
        ]}
      >
        <boxGeometry
          args={[
            COFFEE_TABLE.maxX - COFFEE_TABLE.minX,
            COFFEE_TABLE.top,
            COFFEE_TABLE.maxZ - COFFEE_TABLE.minZ,
          ]}
        />
        <meshStandardMaterial color="#1d1a17" roughness={0.3} metalness={0.3} />
      </mesh>
      {/* Candle on the coffee table. */}
      <mesh position={[-10.7, COFFEE_TABLE.top + 0.06, 1]}>
        <cylinderGeometry args={[0.04, 0.04, 0.12, 10]} />
        <meshStandardMaterial
          color="#fff2d6"
          emissive="#ffb050"
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        position={[-10.7, 1.2, 1]}
        color="#ff9a4d"
        intensity={4}
        distance={6}
        decay={1.8}
      />
    </group>
  )
}

function Rug() {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[TABLE.x, 0.004, TABLE.z]}>
      <circleGeometry args={[3.4, 48]} />
      <meshStandardMaterial color="#2a1630" roughness={1} />
    </mesh>
  )
}

/** Warm pendant over the game table so the cards stay readable. */
function TableLamp() {
  return (
    <group position={[TABLE.x, 4.1, TABLE.z]}>
      <mesh position-y={1.2}>
        <cylinderGeometry args={[0.008, 0.008, 2.4, 4]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh>
        <coneGeometry args={[0.55, 0.42, 32, 1, true]} />
        <meshStandardMaterial
          color="#1f1a14"
          metalness={0.6}
          roughness={0.35}
          side={2}
        />
      </mesh>
      <mesh position-y={-0.12}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial
          color="#fff"
          emissive="#ffd9a0"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <AimedSpot
        position={[0, -0.1, 0]}
        aim={[0, -4.1, 0]}
        angle={0.85}
        penumbra={0.6}
        distance={8}
        decay={1.2}
        intensity={26}
        color="#ffd6a0"
      />
    </group>
  )
}

/** A spotlight aimed at a point in its parent's space. */
export function AimedSpot({
  aim,
  ...props
}: { aim: [number, number, number] } & ThreeElements["spotLight"]) {
  const light = useRef<SpotLight>(null)
  const target = useRef<Object3D>(null)
  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current
  }, [])
  return (
    <>
      <spotLight ref={light} {...props} />
      <object3D ref={target} position={aim} />
    </>
  )
}

function Plants() {
  const spots = [
    [-13.2, -6.5],
    [-13.2, 8.2],
    [13.2, 9.5],
    [-8, 13.2],
    [8, 13.2],
  ]
  return (
    <group>
      {spots.map(([x, z], index) => (
        <group key={index} position={[x, 0, z]}>
          <mesh position-y={0.3}>
            <cylinderGeometry args={[0.28, 0.22, 0.6, 16]} />
            <meshStandardMaterial color="#1c1a1f" roughness={0.6} />
          </mesh>
          {Array.from({ length: 7 }, (_, leaf) => {
            const angle = (leaf / 7) * Math.PI * 2 + index
            return (
              <mesh
                key={leaf}
                position={[
                  Math.cos(angle) * 0.18,
                  1.0 + (leaf % 3) * 0.15,
                  Math.sin(angle) * 0.18,
                ]}
                rotation={[Math.sin(angle) * 0.6, angle, Math.cos(angle) * 0.6]}
                scale={[0.35, 1, 0.12]}
              >
                <sphereGeometry args={[0.45, 8, 6]} />
                <meshStandardMaterial color="#1f5a3a" roughness={0.8} />
              </mesh>
            )
          })}
        </group>
      ))}
    </group>
  )
}

/** Drifting specks that catch the light, like haze in a club. */
let dot: CanvasTexture | null = null
function dotTexture() {
  if (dot) return dot
  const element = document.createElement("canvas")
  element.width = element.height = 32
  const ctx = element.getContext("2d")!
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  gradient.addColorStop(0, "rgba(255,255,255,1)")
  gradient.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 32, 32)
  dot = new CanvasTexture(element)
  return dot
}

function Haze() {
  const beat = useBeat()
  const points = useRef<Points>(null)
  const material = useRef<PointsMaterial>(null)
  const geometry = useMemo(() => {
    const count = 420
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * ROOM.halfWidth * 2
      positions[i * 3 + 1] = 0.5 + Math.random() * (ROOM.height - 1)
      positions[i * 3 + 2] = (Math.random() - 0.5) * ROOM.halfDepth * 2
    }
    const g = new BufferGeometry()
    g.setAttribute("position", new BufferAttribute(positions, 3))
    return g
  }, [])
  useFrame((_, dt) => {
    if (points.current) {
      points.current.rotation.y += dt * 0.006
      points.current.position.y = Math.sin(beat.time * 0.1) * 0.2
    }
    if (material.current) {
      material.current.color
        .copy(beat.colors[1])
        .lerp(new Color("#ffffff"), 0.5)
      material.current.opacity = 0.25 + beat.pulse * 0.25 * beat.energy
    }
  })
  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial
        ref={material}
        size={0.045}
        map={dotTexture()}
        alphaTest={0.01}
        transparent
        opacity={0.3}
        depthWrite={false}
        blending={AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}
