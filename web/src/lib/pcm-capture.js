class PCMChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(Math.round(sampleRate * 15));
    this.length = 0;
    this.total = 0;
    this.lastMeter = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.stopped = true;
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  flush() {
    if (!this.length) return;
    const samples = this.samples.slice(0, this.length);
    this.port.postMessage({ type: "chunk", samples }, [samples.buffer]);
    this.length = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i] || 0;
      this.samples[this.length++] = mono / channels.length;
      this.total++;
      if (this.length === this.samples.length) this.flush();
    }
    if (this.total - this.lastMeter >= sampleRate / 5) {
      this.lastMeter = this.total;
      this.port.postMessage({
        type: "meter",
        total: this.total,
        signal: Array.from(channels[0].slice(0, 128)),
      });
    }
    return true;
  }
}
registerProcessor("pcm-chunk-processor", PCMChunkProcessor);
