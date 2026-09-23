import { useSyncExternalStore } from "react";
import { api, downloadBlob, json, message } from "./api";
import { encodeWav, SerialChunkQueue } from "./audio";
import { captureInputs, type RecordingSource } from "./capture";
import captureWorkletUrl from "./pcm-capture.js?url&no-inline";

type Phase =
  "idle" | "requesting" | "recording" | "stopping" | "blocked" | "complete";
type RecordingState = {
  phase: Phase;
  lectureId: string;
  title: string;
  elapsed: number;
  pending: number;
  uploaded: number;
  error: string;
  signal: number[];
  hasAudio: boolean;
  source: RecordingSource;
};
const idle: RecordingState = {
  phase: "idle",
  lectureId: "",
  title: "",
  elapsed: 0,
  pending: 0,
  uploaded: 0,
  error: "",
  signal: [],
  hasAudio: false,
  source: "microphone",
};

export class RecorderController {
  private state: RecordingState = idle;
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private streams: MediaStream[] = [];
  private node: AudioWorkletNode | null = null;
  private queue: SerialChunkQueue | null = null;
  private retained: ArrayBuffer[] = [];
  private captured = 0;
  private rate = 48000;
  private resolveFlush: (() => void) | null = null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(patch: Partial<RecordingState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  get protected() {
    return ["requesting", "recording", "stopping", "blocked"].includes(
      this.state.phase,
    );
  }
  async start(
    title: string,
    course_id: string,
    language: string,
    context = "",
    source: RecordingSource = "microphone",
  ) {
    if (this.protected) return;
    this.retained = [];
    this.captured = 0;
    this.update({ ...idle, phase: "requesting", title, source });
    try {
      this.context = new AudioContext({ sampleRate: 48000 });
      // Resume during the click gesture, before waiting for either permission picker.
      const resumed = this.context.resume();
      void resumed.catch(() => {});
      this.streams = await captureInputs(source);
      let inputEnded = false;
      const tracks = this.streams.flatMap((stream) => stream.getTracks());
      const requireLiveInputs = () => {
        if (inputEnded || tracks.some((track) => track.readyState !== "live"))
          throw new Error(
            "Audio sharing ended before recording started. Start again to select your sources.",
          );
      };
      tracks.forEach((track) =>
        track.addEventListener("ended", () => {
          inputEnded = true;
          if (this.state.phase === "recording") void this.stop();
          else tracks.forEach((input) => input.stop());
        }),
      );
      await resumed;
      requireLiveInputs();
      this.rate = this.context.sampleRate;
      if (this.rate < 8000 || this.rate > 96000)
        throw new Error(
          "The microphone sample rate must be between 8 kHz and 96 kHz.",
        );
      await this.context.audioWorklet.addModule(captureWorkletUrl);
      await this.context.resume();
      requireLiveInputs();
      const session = await api<{ id: string; lecture_id: string }>(
        "/live",
        json("POST", {
          title,
          course_id: course_id || null,
          language,
          context,
        }),
      );
      this.update({ lectureId: session.lecture_id });
      requireLiveInputs();
      this.queue = new SerialChunkQueue(
        async (chunk) => {
          const form = new FormData();
          form.append(
            "file",
            new Blob([chunk.wav], { type: "audio/wav" }),
            `chunk-${chunk.sequence}.wav`,
          );
          form.append("sequence", String(chunk.sequence));
          form.append("offset", String(chunk.offset));
          try {
            await api(`/live/${session.id}/chunks`, {
              method: "POST",
              body: form,
            });
            this.update({ uploaded: this.state.uploaded + 1, error: "" });
          } catch (error) {
            this.update({
              error: `Audio retained in this tab. ${message(error)}`,
            });
            throw error;
          }
        },
        () => this.update({ pending: this.queue?.pending ?? 0 }),
      );
      this.node = new AudioWorkletNode(this.context, "pcm-chunk-processor");
      this.node.port.onmessage = (
        event: MessageEvent<{
          type: string;
          samples?: Float32Array;
          signal?: number[];
          total?: number;
        }>,
      ) => {
        if (event.data.type === "chunk" && event.data.samples) {
          const samples = event.data.samples;
          const wav = encodeWav(samples, this.rate);
          const sequence = this.retained.length;
          const offset = this.captured / this.rate;
          this.captured += samples.length;
          this.retained.push(wav);
          this.queue?.add({ sequence, offset, wav });
          this.update({ hasAudio: true, elapsed: this.captured / this.rate });
        } else if (event.data.type === "meter")
          this.update({
            signal: event.data.signal ?? [],
            elapsed: (event.data.total ?? 0) / this.rate,
          });
        else if (event.data.type === "flushed") {
          this.resolveFlush?.();
          this.resolveFlush = null;
        }
      };
      const mute = this.context.createGain();
      mute.gain.value = 0;
      for (const stream of this.streams) {
        const gain = this.context.createGain();
        gain.gain.value = 1 / this.streams.length;
        // The shared display's video track is never connected, encoded, or uploaded.
        this.context.createMediaStreamSource(stream).connect(gain);
        gain.connect(this.node);
      }
      this.node.connect(mute);
      mute.connect(this.context.destination);
      this.update({ phase: "recording" });
    } catch (error) {
      await this.release();
      let detail = message(error);
      if (this.state.lectureId) {
        try {
          await api(`/lectures/${this.state.lectureId}/cancel`, json("POST"));
        } catch (cleanupError) {
          detail += ` The empty recording session could not be closed: ${message(cleanupError)}`;
        }
      }
      this.update({ phase: "idle", error: detail });
    }
  }
  private async release() {
    this.node?.disconnect();
    this.node = null;
    this.streams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
    this.streams = [];
    await this.context?.close().catch(() => {});
    this.context = null;
  }
  async stop() {
    if (this.state.phase !== "recording") return;
    this.update({ phase: "stopping" });
    try {
      // The worklet acknowledges only after posting the final partial buffer.
      await new Promise<void>((resolve) => {
        this.resolveFlush = resolve;
        this.node!.port.postMessage("flush");
      });
      await this.release();
      await this.queue?.drain();
      await this.finish();
    } catch (error) {
      this.update({
        phase: "blocked",
        error: `Recording saved in this tab. ${message(error)}`,
      });
    }
  }
  private async finish() {
    if (!this.retained.length)
      throw new Error(
        "No audio was captured. Keep this tab open and retry or start a new recording.",
      );
    await api(`/live/${this.state.lectureId}/finish`, json("POST"));
    this.update({
      phase: "complete",
      pending: 0,
      error: "",
      signal: [],
      elapsed: this.captured / this.rate,
    });
  }
  async retry() {
    const stopped = this.state.phase === "blocked";
    if (stopped) this.update({ phase: "stopping" });
    try {
      await this.queue?.retry();
      if (stopped) await this.finish();
      else this.update({ error: "" });
    } catch (error) {
      this.update({
        phase: stopped ? "blocked" : this.state.phase,
        error: message(error),
      });
    }
  }
  download() {
    if (!this.retained.length) return;
    const header = encodeWav(new Float32Array(0), this.rate);
    const view = new DataView(header);
    const bytes = this.retained.reduce(
      (total, buffer) => total + buffer.byteLength - 44,
      0,
    );
    view.setUint32(4, 36 + bytes, true);
    view.setUint32(40, bytes, true);
    downloadBlob(
      new Blob([header, ...this.retained.map((buffer) => buffer.slice(44))], {
        type: "audio/wav",
      }),
      `${this.state.title || "lecture"}.wav`,
    );
  }
}

// Module ownership keeps audio capture alive across route and component changes.
export const recorder = new RecorderController();
export const useRecorder = () =>
  useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
window.addEventListener("beforeunload", (event) => {
  if (recorder.protected) {
    event.preventDefault();
    event.returnValue = "";
  }
});
