class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(Math.max(1, Math.round(sampleRate * 0.08)));
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index] ?? 0));
      this.chunk[this.offset] =
        sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      this.offset += 1;
      if (this.offset === this.chunk.length) {
        const buffer = this.chunk.buffer;
        this.port.postMessage(buffer, [buffer]);
        this.chunk = new Int16Array(Math.max(1, Math.round(sampleRate * 0.08)));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
