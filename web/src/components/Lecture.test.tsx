import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Lecture } from "../pages/Lecture";
import type { Course, Lecture as LectureData, Settings } from "../types";

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
it("opens relevance review on the lecture and hides it while recording", async () => {
  const user = userEvent.setup();
  const view = render(<Lecture {...props} />);
  await user.click(await screen.findByRole("tab", { name: "Relevance" }));
  expect(screen.getByLabelText("Category for segment 0")).toBeInTheDocument();
  view.unmount();
  lecture = { ...base, status: "recording" };
  render(<Lecture {...props} />);
  await screen.findByText("Imported lesson");
  expect(
    screen.queryByRole("tab", { name: "Relevance" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "Transcript" }),
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
  lecture = { ...base, context: "Lecture focus", preparation_ready: true };
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

const accounting: Course = {
  id: "acc502",
  name: "ACC",
  code: "502",
  color: "#26715b",
  context: "",
  vocabulary: "",
  created_at: "2026-09-23",
  lecture_count: 0,
};

it("assigns a saved lecture directly to ACC502 without resubmitting context", async () => {
  const user = userEvent.setup();
  render(<Lecture {...props} courses={[accounting]} />);
  const select = await screen.findByRole("combobox", { name: "Course" });
  await user.selectOptions(select, "acc502");
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].method).toBe("PATCH");
  expect(JSON.parse(calls[0].body as string)).toEqual({ course_id: "acc502" });
});

it("keeps saved notes visible with an outdated notice after input edits", async () => {
  lecture = {
    ...base,
    status: "ready",
    notes_stale: true,
    notes: {
      title: "Accounting notes",
      overview: "Assets equal liabilities plus equity.",
      chunks: [],
      takeaways: [],
      glossary: [],
      review_questions: [],
      model: "test",
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
  render(<Lecture {...props} />);
  expect(
    await screen.findByText("Assets equal liabilities plus equity."),
  ).toBeVisible();
  expect(screen.getByText(/Saved notes may be out of date/)).toBeVisible();
});

it("does not expose the transcript tab while a lecture is recording", async () => {
  lecture = { ...base, status: "recording" };
  render(<Lecture {...props} />);
  await screen.findByText("Imported lesson");
  expect(
    screen.queryByRole("tab", { name: "Transcript" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("An idea")).not.toBeInTheDocument();
});

const physics: Course = {
  ...accounting,
  id: "phy101",
  name: "Physics",
  code: "PHY101",
};
const finished: LectureData = {
  ...base,
  course_id: "phy101",
  status: "ready",
  preparation_ready: true,
  notes: {
    title: "Kinetic energy",
    overview: "Kinetic energy depends on mass and speed.",
    chunks: [],
    takeaways: [],
    glossary: [],
    review_questions: [],
    model: "test",
    usage: { input_tokens: 0, output_tokens: 0 },
  },
};
const withResources = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method) calls.push(init);
      if (url.includes("/resources"))
        return new Response(
          JSON.stringify([
            {
              id: "ref",
              course_id: "phy101",
              name: "Energy reference.pdf",
              kind: "pdf",
              text: "Energy",
              created_at: "2026-09-23",
              updated_at: "2026-09-23",
              revision: 1,
            },
          ]),
        );
      return new Response(JSON.stringify(lecture), { status: 200 });
    }),
  );

it("keeps notes open beside course materials with preparation in a contextual region", async () => {
  lecture = finished;
  withResources();
  render(<Lecture {...props} courses={[physics]} />);
  expect(
    await screen.findByText("Kinetic energy depends on mass and speed."),
  ).toBeVisible();
  const context = screen.getByRole("region", {
    name: "Preparation and processing",
  });
  expect(
    within(context).getByRole("heading", { name: "Preparation" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      within(context).getByRole("button", { name: "Regenerate notes" }),
    ).toBeEnabled(),
  );
  const materials = screen.getByRole("region", {
    name: "Physics course materials",
  });
  expect(
    await within(materials).findByText("Energy reference.pdf"),
  ).toBeVisible();
  expect(screen.queryByText("OVERVIEW")).not.toBeInTheDocument();
});

it("distinguishes lecture attachments from course materials", async () => {
  lecture = finished;
  withResources();
  const user = userEvent.setup();
  render(<Lecture {...props} courses={[physics]} />);
  await user.click(await screen.findByRole("tab", { name: "Materials" }));
  expect(
    screen.getByRole("heading", { name: "Lecture attachments" }),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Physics course materials" }),
  ).toBeVisible();
});

it("switches lecture views with the keyboard", async () => {
  const user = userEvent.setup();
  render(<Lecture {...props} />);
  const notes = await screen.findByRole("tab", { name: "Notes" });
  notes.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Transcript" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Relevance" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(screen.getByRole("tab", { name: "Notes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it("keeps unsaved note edits when switching views is rejected", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  render(<Lecture {...props} />);
  await user.click(await screen.findByRole("button", { name: "Edit notes" }));
  await user.type(screen.getByLabelText("Your notes"), "Draft");
  await user.click(screen.getByRole("tab", { name: "Transcript" }));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: "Notes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByLabelText("Your notes")).toHaveValue("Draft");
});

it("retries failed processing only through the explicit action", async () => {
  lecture = { ...base, status: "failed", preparation_ready: true };
  const user = userEvent.setup();
  render(<Lecture {...props} />);
  const retry = await screen.findByRole("button", {
    name: "Retry processing",
  });
  expect(calls).toHaveLength(0);
  await user.click(retry);
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(JSON.parse(calls[0].body as string)).toEqual({
    force: false,
    diarize: true,
  });
});
