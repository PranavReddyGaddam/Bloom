/**
 * Capture worklet: Float32 mic input -> 80ms Int16 PCM frames.
 *
 * A static asset rather than a bundled module because AudioWorklet code is
 * loaded by URL into a separate global scope — Next's bundler can't reach it,
 * and an import here would fail at runtime rather than at build time.
 *
 * Deliberately does NOT do voice activity detection. Deepgram Flux does
 * end-of-turn detection server-side, with acoustic and semantic context that
 * an energy threshold cannot approximate. Gone with the VAD: noise-floor
 * calibration, the "listening…" calibration state, the silence-duration rule,
 * and the "raise the threshold while the character is speaking" hack. This
 * worklet frames audio and measures a level for the mic ring. That's all.
 */

// 80ms at 16kHz. Deepgram calls this "strongly recommended for optimal model
// performance and latency"; at 2 bytes/sample it is exactly 2560 bytes.
const FRAME_SAMPLES = 1280

class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(FRAME_SAMPLES)
    this._offset = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    // No input yet (the graph is still warming up) — keep the node alive.
    if (!channel) return true

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._offset++] = channel[i]

      if (this._offset === FRAME_SAMPLES) {
        const pcm = new Int16Array(FRAME_SAMPLES)
        let sumSquares = 0

        for (let j = 0; j < FRAME_SAMPLES; j++) {
          const sample = Math.max(-1, Math.min(1, this._buffer[j]))
          // Asymmetric scaling: Int16 range is -32768..32767, so the negative
          // side gets the larger multiplier. Using 32767 for both clips the
          // most negative sample.
          pcm[j] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
          sumSquares += sample * sample
        }

        this.port.postMessage(
          { pcm: pcm.buffer, level: Math.sqrt(sumSquares / FRAME_SAMPLES) },
          // Transferred, not copied: this runs on the audio thread, where a
          // per-frame allocation every 80ms is worth avoiding.
          [pcm.buffer]
        )
        this._offset = 0
      }
    }

    return true
  }
}

registerProcessor('pcm-recorder', PCMRecorder)
