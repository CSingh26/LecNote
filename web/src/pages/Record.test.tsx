import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as recording from "../lib/recorder";
import type { Lecture } from "../types";
import { Record } from "./Record";

const lecture: Lecture = {
  id: "recorded-lecture",
  title: "Energy of motion",
  source_name: "recording.wav",
  media_type: "audio/wav",
  course_id: null,
  status: "recording",
  duration: 30,
  created_at: "2026-09-23",
  updated_at: "2026-09-23",
  context: "",
  language: "en",
  transcript: {
    language: "en",
    duration: 30,
    segments: [
      {
        id: 0,
        start: 0,
        end: 30,
        text: "Kinetic energy depends on mass and velocity.",
        speaker: "Professor",
      },
    ],
  },
  notes: null,
  user_notes: "",
  attachments: [],
  error: null,
  job: null,
};
const requests: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(recording, "useRecorder").mockReturnValue({
    phase: "recording",
    lectureId: "recorded-lecture",
    title: "Energy of motion",
    elapsed: 30,
    pending: 1,
    uploaded: 2,
    error: "",
    signal: [0, 0.4, -0.2, 0],
    hasAudio: true,
    source: "microphone",
  });
  vi.spyOn(recording.recorder, "protected", "get").mockReturnValue(true);
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requests.push(url);
      return new Response(JSON.stringify(lecture), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps transcript content out of the recorder while recording", async () => {
  render(<Record courses={[]} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });

  expect(
    screen.queryByText("Kinetic energy depends on mass and velocity."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Live transcript" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Listening for the first words"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Recording", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("0:30")).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Live recording waveform" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop & save" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Download captured chunks (WAV)" }),
  ).toBeEnabled();
  expect(screen.getByRole("link", { name: "Open lecture" })).toHaveAttribute(
    "href",
    "#/lecture/recorded-lecture",
  );
});

it("does not fetch or poll lecture details while recording", async () => {
  render(<Record courses={[]} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });

  expect(requests).toEqual([]);
});
