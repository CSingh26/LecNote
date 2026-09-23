export type AudioChunk = { sequence: number; offset: number; wav: ArrayBuffer };
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WAVE"],
    [12, "fmt "],
    [36, "data"],
  ] as const) {
    [...text].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  }
  view.setUint32(4, 36 + samples.length * 2, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      44 + index * 2,
      Math.round(clipped * (clipped < 0 ? 32768 : 32767)),
      true,
    );
  });
  return buffer;
}

export class SerialChunkQueue {
  private chunks: AudioChunk[] = [];
  private running: Promise<void> | null = null;
  private error: unknown = null;
  constructor(
    private upload: (chunk: AudioChunk) => Promise<void>,
    private changed: () => void = () => {},
  ) {}
  get pending() {
    return this.chunks.length;
  }
  add(chunk: AudioChunk) {
    this.chunks.push(chunk);
    this.changed();
    this.start();
  }
  private start() {
    if (this.running || this.error) return;
    this.running = (async () => {
      while (this.chunks.length) {
        try {
          await this.upload(this.chunks[0]);
        } catch (error) {
          this.error = error;
          this.changed();
          return;
        }
        this.chunks.shift();
        this.changed();
      }
    })().finally(() => {
      this.running = null;
    });
  }
  async drain() {
    this.start();
    await this.running;
    if (this.error) throw this.error;
  }
  async retry() {
    await this.running;
    this.error = null;
    await this.drain();
  }
}
