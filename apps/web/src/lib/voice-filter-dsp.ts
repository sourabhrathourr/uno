import { getVoiceFilter } from "./voice-filter-presets"
import type { VoiceFilterId, VoiceFilterPreset } from "./voice-filter-presets"

/** Two moving delay taps overlap to shift pitch without changing speech speed.
 * Each tap is silent when its read position wraps, avoiding a click at the seam.
 * All buffers are allocated once, outside the audio rendering loop. */
export class VoiceFilterDSP {
  private readonly buffer: Float32Array
  private readonly grain: number
  private readonly baseDelay: number
  private readonly echoDelay: number
  private readonly slew: number
  private write = 0
  private phase = 0
  private ringPhase = 0
  private low = 0
  private high = 0
  private pitch = 1
  private wet = 0
  private ringMix = 0
  private ringHz = 0
  private drive = 1
  private echoMix = 0
  private lowAlpha = 1
  private highAlpha = 0
  private target: VoiceFilterPreset = getVoiceFilter("normal")

  constructor(private readonly rate: number) {
    this.buffer = new Float32Array(Math.ceil(rate * 0.2))
    this.grain = Math.round(rate * 0.032)
    this.baseDelay = Math.round(rate * 0.003)
    this.echoDelay = Math.round(rate * 0.13)
    this.slew = 1 - Math.exp(-1 / (rate * 0.012))
  }

  setFilter(id: VoiceFilterId) {
    this.target = getVoiceFilter(id)
  }

  private read(delay: number) {
    const position =
      (this.write - delay + this.buffer.length) % this.buffer.length
    const index = Math.floor(position)
    const fraction = position - index
    return (
      this.buffer[index] * (1 - fraction) +
      this.buffer[(index + 1) % this.buffer.length] * fraction
    )
  }

  process(input: Float32Array | undefined, output: Float32Array) {
    const target = this.target
    const wetTarget = target.id === "normal" ? 0 : 1
    // Most players use their own voice. Keep that path cheap and delay-free.
    if (target.id === "normal" && this.wet < 0.00001) {
      this.wet = 0
      this.pitch = 1
      this.ringMix = 0
      this.ringHz = 0
      this.drive = 1
      this.echoMix = 0
      this.lowAlpha = 1
      this.highAlpha = 0
      this.low = 0
      this.high = 0
      for (let i = 0; i < output.length; i++) {
        const sample = input?.[i] ?? 0
        this.buffer[this.write] = sample
        output[i] = Math.max(-1, Math.min(1, sample))
        this.write = (this.write + 1) % this.buffer.length
      }
      return
    }
    const lowTarget =
      1 -
      Math.exp(
        (-2 * Math.PI * Math.min(target.lowpassHz, this.rate * 0.45)) /
          this.rate
      )
    const highTarget =
      1 - Math.exp((-2 * Math.PI * target.highpassHz) / this.rate)

    for (let i = 0; i < output.length; i++) {
      const sample = input?.[i] ?? 0
      this.buffer[this.write] = sample
      this.pitch += (target.pitch - this.pitch) * this.slew
      this.wet += (wetTarget - this.wet) * this.slew
      this.ringMix += (target.ringMix - this.ringMix) * this.slew
      this.ringHz += (target.ringHz - this.ringHz) * this.slew
      this.drive += (target.drive - this.drive) * this.slew
      this.echoMix += (target.echoMix - this.echoMix) * this.slew
      this.lowAlpha += (lowTarget - this.lowAlpha) * this.slew
      this.highAlpha += (highTarget - this.highAlpha) * this.slew

      this.phase = (this.phase + (1 - this.pitch) / this.grain + 1) % 1
      const secondPhase = (this.phase + 0.5) % 1
      const weight = Math.sin(Math.PI * this.phase) ** 2
      const shifted =
        this.read(this.baseDelay + this.phase * this.grain) * weight +
        this.read(this.baseDelay + secondPhase * this.grain) * (1 - weight)
      // Unity pitch needs no delay, including the robot and radio presets.
      const voice =
        target.pitch === 1 && Math.abs(this.pitch - 1) < 0.001
          ? sample
          : shifted
      this.ringPhase =
        (this.ringPhase + (2 * Math.PI * this.ringHz) / this.rate) %
        (2 * Math.PI)
      const metallic =
        voice * (1 - this.ringMix + this.ringMix * Math.sin(this.ringPhase))
      this.high += this.highAlpha * (metallic - this.high)
      const highpassed =
        this.highAlpha > 0.00001 ? metallic - this.high : metallic
      this.low += this.lowAlpha * (highpassed - this.low)
      const shaped =
        this.drive > 1.01
          ? Math.tanh(this.low * this.drive) / Math.tanh(this.drive)
          : this.low
      const effect =
        (shaped + this.read(this.echoDelay) * this.echoMix) / (1 + this.echoMix)
      const result = sample * (1 - this.wet) + effect * this.wet
      output[i] = Math.max(-1, Math.min(1, result))
      this.write = (this.write + 1) % this.buffer.length
    }
  }
}
