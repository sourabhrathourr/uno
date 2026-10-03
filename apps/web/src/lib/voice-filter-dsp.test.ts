import { describe, expect, it } from "vitest"
import { VoiceFilterDSP } from "./voice-filter-dsp"
import { VOICE_FILTERS, getVoiceFilter } from "./voice-filter-presets"
import type { VoiceFilterId } from "./voice-filter-presets"

function render(filter: VoiceFilterId, rate = 24000, seconds = 1) {
  const dsp = new VoiceFilterDSP(rate)
  dsp.setFilter(filter)
  const output = new Float32Array(rate * seconds)
  for (let offset = 0; offset < output.length; offset += 128) {
    const block = output.subarray(offset, offset + 128)
    const input = Float32Array.from(
      block,
      (_, i) => 0.2 * Math.sin((2 * Math.PI * 180 * (offset + i)) / rate)
    )
    dsp.process(input, block)
  }
  return output
}

function strongestFrequency(samples: Float32Array, rate: number) {
  let best = 0
  let strongest = 0
  for (let frequency = 70; frequency < 450; frequency += 2) {
    let real = 0
    let imaginary = 0
    for (let i = 0; i < samples.length; i++) {
      real += samples[i] * Math.cos((2 * Math.PI * frequency * i) / rate)
      imaginary += samples[i] * Math.sin((2 * Math.PI * frequency * i) / rate)
    }
    const power = real * real + imaginary * imaginary
    if (power > strongest) {
      strongest = power
      best = frequency
    }
  }
  return best
}

describe("live voice DSP", () => {
  it("passes the normal voice through sample for sample", () => {
    const input = new Float32Array([0, 0.2, -0.3, 0.8, -0.8, 0])
    const output = new Float32Array(input.length)
    new VoiceFilterDSP(48000).process(input, output)
    expect(output).toEqual(input)
  })

  it.each(["cat", "kid", "giant", "chipmunk"] as const)(
    "shifts %s pitch while keeping the same speech length",
    (filter) => {
      const output = render(filter, 24000, 2)
      const frequency = strongestFrequency(output.subarray(24000), 24000)
      expect(
        Math.abs(frequency - 180 * getVoiceFilter(filter).pitch)
      ).toBeLessThan(22)
      expect(output).toHaveLength(48000)
    }
  )

  it("gives the monster a low growl with metallic sidebands", () => {
    const output = render("monster", 24000, 2)
    expect(strongestFrequency(output.subarray(24000), 24000)).toBeLessThan(150)
  })

  it.each([44100, 48000])(
    "keeps every preset finite and in range at %i Hz",
    (rate) => {
      for (const filter of VOICE_FILTERS) {
        const output = render(filter.id, rate)
        expect(
          output.every(
            (sample) => Number.isFinite(sample) && Math.abs(sample) <= 1
          )
        ).toBe(true)
        expect(output.some((sample) => Math.abs(sample) > 0.02)).toBe(true)
      }
    }
  )

  it("adds no sound when the mic input is silent", () => {
    for (const filter of VOICE_FILTERS) {
      const dsp = new VoiceFilterDSP(48000)
      dsp.setFilter(filter.id)
      const output = new Float32Array(24000)
      dsp.process(undefined, output)
      expect(output.every((sample) => sample === 0)).toBe(true)
    }
  })

  it("returns to the dry signal after switching back to You", () => {
    const dsp = new VoiceFilterDSP(48000)
    dsp.setFilter("monster")
    const input = new Float32Array(24000).fill(0.2)
    dsp.process(input, new Float32Array(input.length))
    dsp.setFilter("normal")
    const output = new Float32Array(input.length)
    dsp.process(input, output)
    expect(output.at(-1)).toBeCloseTo(0.2, 5)
  })

  it("treats unknown saved or worklet input as normal", () => {
    expect(getVoiceFilter("invalid").id).toBe("normal")
    expect(getVoiceFilter(null).id).toBe("normal")
    expect(getVoiceFilter({ pitch: 100 }).id).toBe("normal")
  })
})
