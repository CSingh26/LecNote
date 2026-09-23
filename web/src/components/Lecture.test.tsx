import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Lecture } from "../pages/Lecture";
import type { Lecture as LectureData, Settings } from "../types";

const base: LectureData = {
  id: "1",
  title: "Imported lesson",
  source_name: "Imported transcript",
  media_type: "",
  course_id: null,
  status: "draft",
  duration: 4,
  created_at: "2026-09-23",
  updated_at: "2026-09-23",
  context: "",
  language: "en",
  transcript: {
    language: "en",
    duration: 4,
    segments: [{ id: 0, start: 0, end: 4, text: "An idea", speaker: null }],
  },
  notes: null,
  user_notes: "",
  attachments: [],
  error: null,
  job: null,
};
const settings = { diarization: true } as Settings;
let lecture = base;
const calls: RequestInit[] = [];
beforeEach(() => {
  lecture = base;
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method) calls.push(init);
      return new Response(JSON.stringify(lecture), { status: 200 });
    }),
  );
});
const props = {
  id: "1",
  courses: [],
  settings,
  onChanged: () => {},
  onDirty: () => {},
  dirty: false,
  seekTo: null,
};

it("does not request media for an imported transcript", async () => {
  const { container } = render(<Lecture {...props} />);
  await screen.findByText("Imported lesson");
  expect(container.querySelector("audio,video")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Transcribe locally" }),
  ).not.toBeInTheDocument();
});
it("sends local transcription and the saved diarization default explicitly", async () => {
  lecture = {
    ...base,
    transcript: null,
    source_name: "audio.wav",
    media_type: "audio/wav",
  };
  const user = userEvent.setup();
  render(<Lecture {...props} />);
  await user.click(
    await screen.findByRole("button", { name: "Transcribe locally" }),
  );
  await waitFor(() => expect(calls.length).toBe(1));
  expect(JSON.parse(calls[0].body as string)).toEqual({
    force: false,
    diarize: true,
    transcribe_only: true,
  });
});
it("uses a settings default that arrives after the lecture and respects manual changes", async () => {
  const user = userEvent.setup();
  const view = render(<Lecture {...props} settings={undefined} />);
  await screen.findByRole("button", { name: "Generate notes" });
  view.rerender(<Lecture {...props} />);
  expect(
    screen.getByRole("checkbox", { name: "Detect speakers" }),
  ).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Detect speakers" }));
  await user.click(screen.getByRole("button", { name: "Generate notes" }));
  await waitFor(() => expect(calls.length).toBe(1));
  expect(JSON.parse(calls[0].body as string)).toEqual({
    force: false,
    diarize: false,
  });
});

it("saves corrected transcript speakers and personal notes to their real endpoints", async () => {
  const user = userEvent.setup();
  render(<Lecture {...props} />);
  await user.click(await screen.findByRole("tab", { name: "Transcript" }));
  await user.click(screen.getByRole("button", { name: "Edit transcript" }));
  await user.type(screen.getByLabelText("Speaker 1"), "Professor");
  await user.click(screen.getByRole("button", { name: "Save transcript" }));
  await waitFor(() => expect(calls.length).toBe(1));
  expect(JSON.parse(calls[0].body as string).segments[0].speaker).toBe(
    "Professor",
  );
  await user.click(screen.getByRole("tab", { name: "Notes" }));
  await user.click(screen.getByRole("button", { name: "Edit notes" }));
  await user.type(screen.getByLabelText("Your notes"), "My observation");
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  await waitFor(() => expect(calls.length).toBe(2));
  expect(JSON.parse(calls[1].body as string)).toEqual({
    user_notes: "My observation",
  });
});
