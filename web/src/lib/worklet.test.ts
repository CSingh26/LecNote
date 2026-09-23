import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import workletSource from "./pcm-capture.js?raw";

it("downmixes channels, emits a full 15-second chunk, and flushes every remaining sample before acknowledgment", () => {
  const events: { type: string; samples?: Float32Array }[] = [];
  let Processor: new () => {
    process: (input: Float32Array[][]) => boolean;
    port: { onmessage: (event: { data: string }) => void };
  };
  runInNewContext(workletSource, {
    sampleRate: 8000,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (event: { type: string; samples?: Float32Array }) =>
          events.push(event),
        onmessage: () => {},
      };
    },
    registerProcessor: (_name: string, implementation: typeof Processor) => {
      Processor = implementation;
    },
  });
  const processor = new Processor!();
  processor.process([
    [new Float32Array(121232).fill(1), new Float32Array(121232).fill(-0.5)],
  ]);
  processor.port.onmessage({ data: "flush" });
  const chunks = events.filter((event) => event.type === "chunk");
  expect(chunks.map((event) => event.samples!.length)).toEqual([120000, 1232]);
  expect(chunks[0].samples![0]).toBe(0.25);
  expect(events.at(-1)?.type).toBe("flushed");
  expect(processor.process([[new Float32Array(128)]])).toBe(false);
});
