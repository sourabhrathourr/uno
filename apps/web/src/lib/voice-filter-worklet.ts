import { VoiceFilterDSP } from "./voice-filter-dsp"
import { getVoiceFilter } from "./voice-filter-presets"

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor
): void

class VoiceFilterProcessor extends AudioWorkletProcessor {
  private readonly dsp = new VoiceFilterDSP(sampleRate)
  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      this.dsp.setFilter(getVoiceFilter(event.data).id)
    }
  }
  process(
    inputs: Array<Array<Float32Array | undefined> | undefined>,
    outputs: Array<Array<Float32Array | undefined> | undefined>
  ) {
    const output = outputs[0]?.[0]
    if (output) this.dsp.process(inputs[0]?.[0], output)
    return true
  }
}

registerProcessor("uno-voice-filter", VoiceFilterProcessor)
