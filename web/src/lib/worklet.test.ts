import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import workletSource from "./pcm-capture.js?raw";

function captureProcessor() {
  const events: { type: string; samples?: Float32Array; total?: number }[] = [];
  let Processor: new () => {
    process: (input: Float32Array[][]) => boolean;
    port: { onmessage: (event: { data: string }) => void };
  };
  runInNewContext(workletSource, {
    sampleRate: 8000,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (event: (typeof events)[number]) => events.push(event),
        onmessage: () => {},
      };
    },
    registerProcessor: (_name: string, implementation: typeof Processor) => {
      Processor = implementation;
    },
  });
  const processor = new Processor!();
  return { processor, events };
}

it("downmixes channels, emits a full 15-second chunk, and flushes every remaining sample before acknowledgment", () => {
  const { processor, events } = captureProcessor();
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

it("flushes on pause and excludes paused samples and time across repeated resumes", () => {
  const { processor, events } = captureProcessor();
  processor.process([[new Float32Array(8000).fill(0.25)]]);
  processor.port.onmessage({ data: "pause" });
  expect(events.filter((event) => event.type === "chunk")).toHaveLength(1);
  const count = events.length;
  expect(processor.process([[new Float32Array(40000).fill(-1)]])).toBe(true);
  processor.port.onmessage({ data: "pause" });
  expect(events).toHaveLength(count);
  for (const level of [0.5, 0.75]) {
    processor.port.onmessage({ data: "resume" });
    processor.process([[new Float32Array(8000).fill(level)]]);
    processor.port.onmessage({ data: "pause" });
    processor.process([[new Float32Array(16000).fill(-1)]]);
  }
  processor.port.onmessage({ data: "flush" });
  const chunks = events.filter((event) => event.type === "chunk");
  expect(chunks.map((chunk) => chunk.samples!.length)).toEqual([
    8000, 8000, 8000,
  ]);
  expect(chunks.map((chunk) => [...new Set(chunk.samples)])).toEqual([
    [0.25],
    [0.5],
    [0.75],
  ]);
  expect(events.filter((event) => event.type === "meter").at(-1)?.total).toBe(
    24000,
  );
  expect(events.at(-1)?.type).toBe("flushed");
  processor.port.onmessage({ data: "resume" });
  expect(processor.process([[new Float32Array(128)]])).toBe(false);
});

it("can stop immediately after pausing without an empty or duplicated chunk", () => {
  const { processor, events } = captureProcessor();
  processor.process([[new Float32Array(128).fill(0.5)]]);
  processor.port.onmessage({ data: "pause" });
  processor.port.onmessage({ data: "flush" });
  expect(events.map((event) => event.type)).toEqual(["chunk", "flushed"]);
  expect(events[0].samples).toHaveLength(128);
});
