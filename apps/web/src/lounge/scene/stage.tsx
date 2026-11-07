import { useEffect, useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  NormalBlending,
  SRGBColorSpace,
  ShaderMaterial,
  Texture,
  TextureLoader,
} from "three"

import {
  DANCE_FLOOR,
  DJ_BOOTH,
  DJ_SPOT,
  SPEAKERS,
  STAGE,
  STAGE_STEP,
} from "../layout"
import { marqueeTexture } from "../textures"
import { Avatar, DJ_LOOK } from "./avatar"
import { useBeat } from "./beat-context"
import {
  beamFragment,
  beamVertex,
  danceFloorFragment,
  fullscreenVertex,
  ledWallFragment,
} from "./shaders"
import type { MusicTrack } from "@workspace/game"
import type {
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SpotLight,
} from "three"

const MOOD_INDEX = { idle: 0, chill: 1, groove: 2, hype: 3 } as const

export function Stage({ track }: { track: MusicTrack | null }) {
  const djState = useRef({
    x: DJ_SPOT.x,
    y: STAGE.top,
    z: DJ_SPOT.z,
    heading: 0,
    animation: "idle" as const,
    dance: 0,
  })
  const width = STAGE.maxX - STAGE.minX
  const depth = STAGE.maxZ - STAGE.minZ
  return (
    <group>
      {/* Platform and its glowing lip. */}
      <mesh position={[0, STAGE.top / 2, (STAGE.minZ + STAGE.maxZ) / 2]}>
        <boxGeometry args={[width, STAGE.top, depth]} />
        <meshStandardMaterial
          color="#141218"
          roughness={0.45}
          metalness={0.3}
        />
      </mesh>
      <StageLip />
      <mesh
        position={[
          0,
          STAGE_STEP.top / 2,
          (STAGE_STEP.minZ + STAGE_STEP.maxZ) / 2,
        ]}
      >
        <boxGeometry
          args={[
            STAGE_STEP.maxX - STAGE_STEP.minX,
            STAGE_STEP.top,
            STAGE_STEP.maxZ - STAGE_STEP.minZ,
          ]}
        />
        <meshStandardMaterial color="#1b1820" roughness={0.5} metalness={0.2} />
      </mesh>

      <DjBooth />
      <Avatar state={djState} look={DJ_LOOK} name="DJ" dj />
      <LedWall track={track} />
      {SPEAKERS.map((box, index) => (
        <Speaker key={index} box={box} />
      ))}
      <Truss />
      <MovingHeads />
      <Lasers />
      <StrobeBar />
      <DanceFloor />
    </group>
  )
}

function StageLip() {
  const beat = useBeat()
  const ref = useRef<MeshStandardMaterial>(null)
  useFrame(() => {
    if (!ref.current) return
    ref.current.emissive.copy(beat.colors[0])
    ref.current.emissiveIntensity = 1.2 + beat.pulse * 2.5 * beat.energy
  })
  return (
    <mesh position={[0, STAGE.top - 0.03, STAGE.maxZ + 0.01]}>
      <boxGeometry args={[STAGE.maxX - STAGE.minX, 0.05, 0.03]} />
      <meshStandardMaterial ref={ref} color="#000" toneMapped={false} />
    </mesh>
  )
}

function DjBooth() {
  const beat = useBeat()
  const platters = useRef<Array<Mesh | null>>([])
  const front = useRef<MeshStandardMaterial>(null)
  const leds = useRef<Array<MeshStandardMaterial | null>>([])
  const cx = (DJ_BOOTH.minX + DJ_BOOTH.maxX) / 2
  const cz = (DJ_BOOTH.minZ + DJ_BOOTH.maxZ) / 2
  const height = DJ_BOOTH.top - STAGE.top
  useFrame((_, dt) => {
    for (const platter of platters.current)
      if (platter && beat.playing) platter.rotation.y -= dt * 3.5
    if (front.current) {
      front.current.emissive.copy(beat.colors[1])
      front.current.emissiveIntensity = 0.5 + beat.pulse * 1.5 * beat.energy
    }
    leds.current.forEach((led, index) => {
      if (!led) return
      const on = beat.playing && (Math.floor(beat.beat * 2) + index) % 3 === 0
      led.emissiveIntensity = on ? 4 : 0.3
    })
  })
  return (
    <group position={[cx, STAGE.top, cz]}>
      <mesh position-y={height / 2 - 0.05}>
        <boxGeometry
          args={[
            DJ_BOOTH.maxX - DJ_BOOTH.minX,
            height - 0.1,
            DJ_BOOTH.maxZ - DJ_BOOTH.minZ,
          ]}
        />
        <meshStandardMaterial color="#0d0c10" roughness={0.4} metalness={0.5} />
      </mesh>
      {/* Front panel that glows with the room colour. */}
      <mesh
        position={[
          0,
          height / 2 - 0.05,
          (DJ_BOOTH.maxZ - DJ_BOOTH.minZ) / 2 + 0.005,
        ]}
      >
        <planeGeometry
          args={[DJ_BOOTH.maxX - DJ_BOOTH.minX - 0.2, height - 0.3]}
        />
        <meshStandardMaterial ref={front} color="#050505" toneMapped={false} />
      </mesh>
      <mesh position-y={height - 0.03}>
        <boxGeometry
          args={[
            DJ_BOOTH.maxX - DJ_BOOTH.minX + 0.1,
            0.06,
            DJ_BOOTH.maxZ - DJ_BOOTH.minZ + 0.1,
          ]}
        />
        <meshStandardMaterial color="#1d1b22" roughness={0.3} metalness={0.6} />
      </mesh>
      {[-1.1, 1.1].map((x, index) => (
        <group key={x} position={[x, height + 0.03, 0]}>
          <mesh>
            <boxGeometry args={[0.7, 0.06, 0.6]} />
            <meshStandardMaterial
              color="#26242c"
              roughness={0.4}
              metalness={0.5}
            />
          </mesh>
          <mesh
            ref={(mesh) => {
              platters.current[index] = mesh
            }}
            position-y={0.05}
          >
            <cylinderGeometry args={[0.25, 0.25, 0.03, 32]} />
            <meshStandardMaterial
              color="#111"
              roughness={0.3}
              metalness={0.2}
            />
          </mesh>
          <mesh position={[0.1, 0.075, 0.05]}>
            <boxGeometry args={[0.04, 0.02, 0.18]} />
            <meshStandardMaterial
              color="#c9c9c9"
              metalness={0.8}
              roughness={0.2}
            />
          </mesh>
        </group>
      ))}
      {/* Mixer with blinking channel LEDs. */}
      <group position={[0, height + 0.04, 0]}>
        <mesh>
          <boxGeometry args={[0.6, 0.08, 0.5]} />
          <meshStandardMaterial
            color="#1a1a20"
            roughness={0.4}
            metalness={0.5}
          />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <mesh key={index} position={[-0.2 + index * 0.08, 0.05, 0.12]}>
            <boxGeometry args={[0.03, 0.01, 0.12]} />
            <meshStandardMaterial
              ref={(material) => {
                leds.current[index] = material
              }}
              color="#000"
              emissive={index % 2 ? "#3dff9e" : "#ff3d9a"}
              emissiveIntensity={0.3}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function LedWall({ track }: { track: MusicTrack | null }) {
  const beat = useBeat()
  const wallWidth = 12
  const wallHeight = 4.6
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uKick: { value: 0 },
      uEnergy: { value: 0 },
      uPlaying: { value: 0 },
      uHasArt: { value: 0 },
      uHasText: { value: 0 },
      uTextAspect: { value: 1 },
      uAspect: { value: wallWidth / wallHeight },
      uA: { value: beat.colors[0].clone() },
      uB: { value: beat.colors[1].clone() },
      uC: { value: beat.colors[2].clone() },
      uArt: { value: new Texture() },
      uText: { value: new Texture() },
    }),
    []
  )

  const artUrl = track?.thumbnailUrl ?? null
  useEffect(() => {
    uniforms.uHasArt.value = 0
    if (!artUrl) return
    let cancelled = false
    const loader = new TextureLoader()
    loader.setCrossOrigin("anonymous")
    loader.load(
      artUrl,
      (texture) => {
        if (cancelled) return texture.dispose()
        texture.colorSpace = SRGBColorSpace
        const previous = uniforms.uArt.value
        uniforms.uArt.value = texture
        uniforms.uHasArt.value = 1
        previous.dispose()
      },
      undefined,
      () => {
        uniforms.uHasArt.value = 0
      }
    )
    return () => {
      cancelled = true
    }
  }, [artUrl, uniforms])

  useEffect(() => {
    if (!track) {
      uniforms.uHasText.value = 0
      return
    }
    const marquee = marqueeTexture(`♪  ${track.title}  ·  ${track.artist}`)
    uniforms.uText.value = marquee.texture
    uniforms.uTextAspect.value = marquee.aspect
    uniforms.uHasText.value = 1
  }, [track?.id, uniforms])

  useFrame(() => {
    uniforms.uTime.value = beat.time
    uniforms.uBeat.value = beat.beat
    uniforms.uKick.value = beat.kick
    uniforms.uEnergy.value = beat.energy
    uniforms.uPlaying.value = beat.playing ? 1 : 0
    uniforms.uA.value.copy(beat.colors[0])
    uniforms.uB.value.copy(beat.colors[1])
    uniforms.uC.value.copy(beat.colors[2])
  })

  return (
    <group position={[0, STAGE.top + wallHeight / 2 + 0.6, STAGE.minZ + 0.12]}>
      <mesh position-z={-0.06}>
        <boxGeometry args={[wallWidth + 0.3, wallHeight + 0.3, 0.1]} />
        <meshStandardMaterial color="#08070a" roughness={0.6} />
      </mesh>
      <mesh>
        <planeGeometry args={[wallWidth, wallHeight]} />
        <ShaderSurface
          vertexShader={fullscreenVertex}
          fragmentShader={ledWallFragment}
          uniforms={uniforms}
        />
      </mesh>
    </group>
  )
}

function Speaker({ box }: { box: (typeof SPEAKERS)[number] }) {
  const beat = useBeat()
  const cones = useRef<Array<Mesh | null>>([])
  const width = box.maxX - box.minX
  const depth = box.maxZ - box.minZ
  const height = box.top - STAGE.top
  useFrame(() => {
    const push = 1 + beat.kick * 0.35 * beat.energy * (beat.playing ? 1 : 0)
    for (const cone of cones.current) cone?.scale.set(1, 1, push)
  })
  return (
    <group
      position={[
        (box.minX + box.maxX) / 2,
        STAGE.top,
        (box.minZ + box.maxZ) / 2,
      ]}
    >
      <mesh position-y={height / 2}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color="#0b0b0e" roughness={0.75} />
      </mesh>
      {[0.55, 1.45, 2.2].map((y, index) => (
        <group key={y} position={[0, y, depth / 2 + 0.01]}>
          <mesh>
            <ringGeometry
              args={[index === 2 ? 0.14 : 0.3, index === 2 ? 0.18 : 0.38, 32]}
            />
            <meshStandardMaterial
              color="#2a2a30"
              metalness={0.6}
              roughness={0.3}
            />
          </mesh>
          <mesh
            ref={(mesh) => {
              cones.current[index] = mesh
            }}
            rotation-x={Math.PI / 2}
          >
            <coneGeometry
              args={[index === 2 ? 0.14 : 0.3, 0.12, 32, 1, true]}
            />
            <meshStandardMaterial
              color="#151518"
              roughness={0.6}
              side={DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

const TRUSS_Y = 5.6
const TRUSS_Z = -8.6

function Truss() {
  return (
    <group position={[0, TRUSS_Y, TRUSS_Z]}>
      {[-0.15, 0.15].map((offset) => (
        <mesh key={offset} position={[0, offset, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.04, 0.04, 13, 8]} />
          <meshStandardMaterial
            color="#2b2b30"
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
      ))}
      {[-6.5, 6.5].map((x) => (
        <mesh key={x} position={[x, -(TRUSS_Y - STAGE.top) / 2, 0]}>
          <cylinderGeometry args={[0.06, 0.06, TRUSS_Y - STAGE.top, 8]} />
          <meshStandardMaterial
            color="#2b2b30"
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
      ))}
    </group>
  )
}

/** One cone shared by every beam; the tip sits at the origin, aiming down. */
const beamGeometry = (() => {
  const geometry = new CylinderGeometry(0.05, 1.5, 11, 28, 1, true)
  geometry.translate(0, -5.5, 0)
  return geometry
})()

function Beam({
  colorIndex,
  intensityScale = 1,
}: {
  colorIndex: number
  intensityScale?: number
}) {
  const beat = useBeat()
  const uniforms = useMemo(
    () => ({
      uColor: { value: beat.colors[colorIndex].clone() },
      uIntensity: { value: 0 },
    }),
    []
  )
  useFrame(() => {
    uniforms.uColor.value.copy(beat.colors[colorIndex])
    const level = beat.playing
      ? (0.35 + beat.energy * 0.45) * (0.55 + beat.pulse * 0.9)
      : 0.22
    uniforms.uIntensity.value = level * intensityScale
  })
  return (
    <mesh geometry={beamGeometry} renderOrder={2}>
      <ShaderSurface
        vertexShader={beamVertex}
        fragmentShader={beamFragment}
        uniforms={uniforms}
        additive
      />
    </mesh>
  )
}

/**
 * Six moving heads on the truss. Chill songs drift in slow figure-eights,
 * groove songs sweep with the bar, hype songs snap to new positions on every
 * beat and fan out on phrase changes.
 */
function MovingHeads() {
  const beat = useBeat()
  const heads = useRef<Array<Group | null>>([])
  const tilts = useRef<Array<Group | null>>([])
  const spots = useRef<Array<SpotLight | null>>([])
  const xs = [-5, -3, -1, 1, 3, 5]

  useFrame((_, dt) => {
    const mood = beat.grid.mood
    const b = beat.beat
    const k =
      1 - Math.exp(-dt * (mood === "hype" ? 14 : mood === "groove" ? 6 : 2.5))
    xs.forEach((x, index) => {
      const head = heads.current[index]
      const tilt = tilts.current[index]
      if (!head || !tilt) return
      const side = x < 0 ? -1 : 1
      let pan = 0
      let tiltAngle = 0.5
      if (mood === "idle") {
        pan = Math.sin(beat.time * 0.25 + index) * 0.4
        tiltAngle = 0.55 + Math.sin(beat.time * 0.2 + index * 0.7) * 0.1
      } else if (mood === "chill") {
        const t = (b / 16) * Math.PI * 2
        pan = Math.sin(t + index * 0.6) * 0.6
        tiltAngle = 0.55 + Math.sin(t * 2 + index) * 0.2
      } else if (mood === "groove") {
        const t = (b / 8) * Math.PI * 2
        pan = Math.sin(t) * 0.8 * side + (index % 2 ? 0.2 : -0.2)
        tiltAngle = 0.6 + Math.cos(t * 0.5 + index * 0.5) * 0.25
      } else {
        const step = Math.floor(b)
        const fan = ((beat.bar % 8) + 8) % 8 === 0
        pan = fan
          ? side * (0.3 + Math.abs(x) * 0.12)
          : Math.sin(step * 1.7 + index * 2.1) * 0.9
        tiltAngle = fan ? 0.35 : 0.45 + ((step + index) % 3) * 0.18
      }
      head.rotation.y += (pan - head.rotation.y) * k
      tilt.rotation.x += (tiltAngle - tilt.rotation.x) * k
    })
    spots.current.forEach((spot) => {
      if (!spot) return
      spot.color.copy(beat.colors[0])
      spot.intensity = beat.playing
        ? (30 + beat.energy * 40) * (0.5 + beat.pulse)
        : 12
    })
  })

  return (
    <group position={[0, TRUSS_Y - 0.2, TRUSS_Z]}>
      {xs.map((x, index) => (
        <group
          key={x}
          position-x={x}
          ref={(group) => {
            heads.current[index] = group
          }}
        >
          <mesh position-y={0.1}>
            <boxGeometry args={[0.32, 0.12, 0.32]} />
            <meshStandardMaterial
              color="#1b1b20"
              metalness={0.6}
              roughness={0.35}
            />
          </mesh>
          {/* Tilt forward toward the room; the beam points along -y. */}
          <group
            ref={(group) => {
              tilts.current[index] = group
            }}
            rotation-x={0.5}
          >
            <mesh position-y={-0.1}>
              <cylinderGeometry args={[0.13, 0.11, 0.3, 16]} />
              <meshStandardMaterial
                color="#26262c"
                metalness={0.6}
                roughness={0.35}
              />
            </mesh>
            <mesh position-y={-0.26} rotation-x={Math.PI / 2}>
              <circleGeometry args={[0.1, 16]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
            <Beam colorIndex={index % 2} />
            {/* The outer heads carry real lights so the floor gets lit too. */}
            {(index === 0 || index === xs.length - 1) && (
              <FollowSpot
                onLight={(light) => {
                  spots.current[index === 0 ? 0 : 1] = light
                }}
              />
            )}
          </group>
        </group>
      ))}
    </group>
  )
}

function FollowSpot({
  onLight,
}: {
  onLight: (light: SpotLight | null) => void
}) {
  const light = useRef<SpotLight>(null)
  const target = useRef<Object3D>(null)
  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current
    onLight(light.current)
    return () => onLight(null)
  }, [])
  return (
    <>
      <spotLight
        ref={light}
        angle={0.3}
        penumbra={0.7}
        distance={20}
        decay={1.3}
        intensity={20}
      />
      <object3D ref={target} position-y={-10} />
    </>
  )
}

/** A fan of laser lines for hype songs, sweeping over the crowd. */
function Lasers() {
  const beat = useBeat()
  const fan = useRef<Group>(null)
  const materials = useRef<Array<MeshStandardMaterial | null>>([])
  const count = 9
  useFrame(() => {
    const group = fan.current
    if (!group) return
    const on =
      beat.playing &&
      !beat.reducedMotion &&
      (beat.grid.mood === "hype" ||
        (beat.grid.mood === "groove" && ((beat.bar % 16) + 16) % 16 >= 12))
    group.visible = on
    if (!on) return
    const b = beat.beat
    group.rotation.x = 0.25 + Math.sin((b / 8) * Math.PI * 2) * 0.22
    group.rotation.y = Math.sin((b / 16) * Math.PI * 2) * 0.35
    const spread = 0.12 + 0.08 * Math.sin((b / 4) * Math.PI)
    group.children.forEach((child, index) => {
      child.rotation.y = (index - (count - 1) / 2) * spread
    })
    materials.current.forEach((material) => {
      if (!material) return
      material.color.copy(beat.colors[2]).multiplyScalar(2.5 + beat.kick * 4)
      material.opacity = 0.35 + beat.kick * 0.55
    })
  })
  return (
    <group
      ref={fan}
      position={[0, STAGE.top + 3.4, STAGE.minZ + 0.6]}
      visible={false}
    >
      {Array.from({ length: count }, (_, index) => (
        <group key={index}>
          <mesh position-z={12} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.012, 0.012, 24, 4, 1, true]} />
            <meshStandardMaterial
              ref={(material) => {
                materials.current[index] = material
              }}
              color="#00ff80"
              emissive="#000"
              transparent
              depthWrite={false}
              blending={AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function StrobeBar() {
  const beat = useBeat()
  const material = useRef<MeshStandardMaterial>(null)
  useFrame(() => {
    if (material.current) material.current.emissiveIntensity = beat.strobe * 8
  })
  return (
    <mesh position={[0, TRUSS_Y + 0.25, TRUSS_Z]}>
      <boxGeometry args={[4, 0.1, 0.1]} />
      <meshStandardMaterial
        ref={material}
        color="#222"
        emissive="#ffffff"
        emissiveIntensity={0}
        toneMapped={false}
      />
    </mesh>
  )
}

function DanceFloor() {
  const beat = useBeat()
  const width = DANCE_FLOOR.maxX - DANCE_FLOOR.minX
  const depth = DANCE_FLOOR.maxZ - DANCE_FLOOR.minZ
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uKick: { value: 0 },
      uEnergy: { value: 0 },
      uMood: { value: 0 },
      uTiles: { value: [Math.round(width / 1), Math.round(depth / 1)] },
      uA: { value: beat.colors[0].clone() },
      uB: { value: beat.colors[1].clone() },
      uC: { value: beat.colors[2].clone() },
    }),
    []
  )
  useFrame(() => {
    uniforms.uTime.value = beat.time
    uniforms.uBeat.value = beat.beat
    uniforms.uKick.value = beat.kick
    uniforms.uEnergy.value = beat.energy
    uniforms.uMood.value = MOOD_INDEX[beat.grid.mood]
    uniforms.uA.value.copy(beat.colors[0])
    uniforms.uB.value.copy(beat.colors[1])
    uniforms.uC.value.copy(beat.colors[2])
  })
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[
        (DANCE_FLOOR.minX + DANCE_FLOOR.maxX) / 2,
        0.006,
        (DANCE_FLOOR.minZ + DANCE_FLOOR.maxZ) / 2,
      ]}
    >
      <planeGeometry args={[width, depth]} />
      <ShaderSurface
        vertexShader={fullscreenVertex}
        fragmentShader={danceFloorFragment}
        uniforms={uniforms}
      />
    </mesh>
  )
}

/**
 * A shader material that keeps the exact uniforms object it was given.
 * (Passing `uniforms` as a JSX prop copies it, so per-frame updates to our
 * object would never reach the GPU.)
 */
function ShaderSurface({
  vertexShader,
  fragmentShader,
  uniforms,
  additive = false,
}: {
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, { value: unknown }>
  additive?: boolean
}) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: additive,
        depthWrite: !additive,
        blending: additive ? AdditiveBlending : NormalBlending,
        side: additive ? DoubleSide : FrontSide,
        toneMapped: false,
      }),
    [vertexShader, fragmentShader, uniforms, additive]
  )
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}
