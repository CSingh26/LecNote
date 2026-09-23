import { describe, expect, it } from "vitest";
import { encodeWav, SerialChunkQueue } from "./audio";

describe("independent WAV chunks", () => {
  it("encodes a mono PCM16 RIFF file with clipping and correct sizes", () => {
    const buffer = encodeWav(new Float32Array([-2, -1, 0, 1, 2]), 48000);
    const view = new DataView(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, 4))).toBe("RIFF");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(52, true)).toBe(32767);
  });
  it("serializes uploads, retains failures and drains the partial last chunk before finishing", async () => {
    const uploaded: number[] = [];
    let fail = true;
    const queue = new SerialChunkQueue(async (chunk) => {
      if (chunk.sequence === 1 && fail) throw new Error("offline");
      uploaded.push(chunk.sequence);
    });
    queue.add({ sequence: 0, offset: 0, wav: new ArrayBuffer(2) });
    queue.add({ sequence: 1, offset: 15, wav: new ArrayBuffer(2) });
    queue.add({ sequence: 2, offset: 30, wav: new ArrayBuffer(1) });
    await expect(queue.drain()).rejects.toThrow("offline");
    expect(uploaded).toEqual([0]);
    expect(queue.pending).toBe(2);
    fail = false;
    await queue.retry();
    expect(uploaded).toEqual([0, 1, 2]);
    expect(queue.pending).toBe(0);
  });
});
