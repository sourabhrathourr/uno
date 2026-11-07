/** GLSL for the lounge's light-emitting surfaces. */

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const common = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 pick(float i, vec3 a, vec3 b, vec3 c) {
  i = mod(floor(i), 3.0);
  return i < 0.5 ? a : (i < 1.5 ? b : c);
}
`

/**
 * The LED wall behind the DJ: a dot-matrix screen with the song's cover in
 * the middle, spectrum-style bars and rings that fire on every kick, and the
 * song title scrolling along the bottom.
 */
export const ledWallFragment = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uKick;
uniform float uEnergy;
uniform float uPlaying;
uniform float uHasArt;
uniform float uHasText;
uniform float uTextAspect;
uniform float uAspect;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform sampler2D uArt;
uniform sampler2D uText;
varying vec2 vUv;
${common}
void main() {
  vec2 grid = vec2(160.0, 160.0 / uAspect);
  vec2 cell = floor(vUv * grid);
  vec2 local = fract(vUv * grid) - 0.5;
  float led = smoothstep(0.5, 0.22, length(local));
  vec2 p = (cell + 0.5) / grid;
  vec2 c = (p - 0.5) * vec2(uAspect, 1.0);

  vec3 col = vec3(0.0);

  // Rings expanding from the centre, one per beat.
  float d = length(c);
  float ring = fract(d * 0.9 - uBeat * 0.5);
  col += pick(uBeat * 0.5, uA, uB, uC) * smoothstep(0.08, 0.0, abs(ring - 0.5)) * (0.25 + 0.75 * uKick) * uEnergy;

  // Spectrum-ish bars rising from the bottom, re-rolled every half beat.
  float bars = 48.0;
  float column = floor(p.x * bars);
  float seed = hash(vec2(column, floor(uBeat * 2.0)));
  float centre = 1.0 - abs(p.x - 0.5) * 1.4;
  float h = (0.08 + seed * 0.45 * centre) * (0.35 + 0.65 * uKick) * (0.25 + uEnergy) * uPlaying;
  float bar = step(p.y, h + 0.12) * step(0.12, p.y);
  col += mix(uA, uB, p.y / max(h + 0.12, 0.01)) * bar * 1.2;

  // Slow background wash so the wall is never black.
  col += mix(uC, uA, 0.5 + 0.5 * sin(p.x * 3.0 + uTime * 0.3)) * 0.07;

  // Cover art in the middle, framed, breathing with the kick.
  float artSize = 0.62 + 0.03 * uKick;
  vec2 artUv = c / artSize + 0.5;
  artUv.y += 0.08;
  if (uHasArt > 0.5 && artUv.x > 0.0 && artUv.x < 1.0 && artUv.y > 0.0 && artUv.y < 1.0) {
    // YouTube thumbnails are 16:9 with letterboxing; take the middle square.
    vec2 src = vec2(0.5 + (artUv.x - 0.5) * 0.5625, artUv.y);
    vec3 art = texture2D(uArt, src).rgb;
    col = mix(col, art * (0.9 + 0.35 * uKick), 0.92);
  }

  // Scrolling title along the bottom strip, sampled at full resolution so
  // the letters stay readable between the LED dots.
  float stripLow = 0.015;
  float stripHigh = 0.115;
  float textMask = 0.0;
  if (uHasText > 0.5 && vUv.y < stripHigh && vUv.y > stripLow) {
    float ty = (vUv.y - stripLow) / (stripHigh - stripLow);
    float textWidth = (stripHigh - stripLow) * uTextAspect / uAspect;
    float tx = fract((vUv.x + uTime * 0.035) / textWidth);
    textMask = texture2D(uText, vec2(tx, ty)).r;
    col *= 0.25;
  }

  col *= mix(led, 1.0, 0.25) * (0.75 + 0.75 * uEnergy);
  col += vec3(textMask) * 0.9;
  gl_FragColor = vec4(col * 1.5, 1.0);
}
`

/** Light-up tiles in front of the stage. */
export const danceFloorFragment = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uKick;
uniform float uEnergy;
uniform float uMood;
uniform vec2 uTiles;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec2 vUv;
${common}
void main() {
  vec2 cell = floor(vUv * uTiles);
  vec2 local = fract(vUv * uTiles);
  float edge = smoothstep(0.0, 0.06, local.x) * smoothstep(1.0, 0.94, local.x)
             * smoothstep(0.0, 0.06, local.y) * smoothstep(1.0, 0.94, local.y);
  float beat = floor(uBeat);
  float h = hash(cell + floor(beat / 4.0) * 7.0);
  vec3 col = pick(h * 3.0 + floor(beat / 4.0), uA, uB, uC);

  float lit;
  if (uMood < 0.5) {
    // Idle: a slow glow drifting across.
    lit = 0.15 + 0.15 * sin(cell.x * 0.6 + cell.y * 0.4 - uTime * 0.6);
  } else if (uMood < 1.5) {
    // Chill: a soft diagonal wave, one sweep per bar.
    lit = 0.25 + 0.45 * pow(0.5 + 0.5 * sin((cell.x + cell.y) * 0.5 - uBeat * 1.5708), 2.0);
  } else if (uMood < 2.5) {
    // Groove: a checkerboard that swaps on each beat.
    float checker = mod(cell.x + cell.y + beat, 2.0);
    lit = 0.18 + checker * (0.35 + 0.65 * uKick);
  } else {
    // Hype: random tiles flash on every beat.
    float on = step(0.55, hash(cell + beat * 3.17));
    lit = 0.12 + on * (0.4 + 1.1 * uKick);
  }
  float glow = lit * edge * (0.4 + uEnergy);
  gl_FragColor = vec4(col * glow * 1.4 + vec3(0.012), 1.0);
}
`

export const beamVertex = /* glsl */ `
varying float vAlong;
varying float vFacing;
void main() {
  vAlong = uv.y;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vec3 view = normalize(cameraPosition - world.xyz);
  vFacing = abs(dot(worldNormal, view));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/** A soft volumetric-looking light cone; brightest at the source. */
export const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vAlong;
varying float vFacing;
void main() {
  float fade = pow(vAlong, 1.6);
  float soft = pow(vFacing, 1.8);
  float a = fade * soft * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}
`
