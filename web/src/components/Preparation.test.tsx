import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Preparation } from "./Preparation";
import { Lecture as LecturePage } from "../pages/Lecture";
import type { Lecture, Resource } from "../types";

const base: Lecture = {
  id: "lesson",
  title: "Lecture preparation test",
  course_id: null,
  source_name: "lecture.wav",
  media_type: "audio/wav",
  status: "draft",
  duration: 10,
  created_at: "2026-09-24",
  updated_at: "2026-09-24",
  context: "",
  language: "en",
  transcript: null,
  notes: null,
  user_notes: "",
  attachments: [],
  error: null,
  job: null,
  selected_resource_ids: [],
  preparation_ready: false,
};
const resource: Resource = {
  id: "slides",
  course_id: "math",
  name: "Lecture slides",
  kind: "pdf",
  text: "Matrices and determinants",
  revision: 1,
  created_at: "2026-09-24",
  updated_at: "2026-09-24",
};
let lecture: Lecture;
let resources: Resource[];
let failSave: boolean;
let calls: { url: string; init: RequestInit }[];
beforeEach(() => {
  lecture = structuredClone(base);
  resources = [resource];
  calls = [];
  failSave = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method) calls.push({ url, init });
      if (url.endsWith("/preparation")) {
        if (failSave)
          return new Response(
            JSON.stringify({ detail: "Preparation could not be saved" }),
            { status: 409 },
          );
        const body = JSON.parse(init.body as string);
        lecture = {
          ...lecture,
          ...body,
          preparation_ready: Boolean(
            body.context.trim() || body.selected_resource_ids.length,
          ),
        };
      }
      return new Response(
        JSON.stringify(url.includes("/resources") ? resources : lecture),
      );
    }),
  );
});
const callbacks = () => ({
  onDirty: vi.fn(),
  onReady: vi.fn(),
  onSaved: vi.fn(),
  onBusy: vi.fn(),
});
const pageProps = {
  id: base.id,
  courses: [],
  dirty: false,
  onChanged: vi.fn(),
  onDirty: vi.fn(),
  seekTo: null,
};

it("saves a recording note without a course and clears dirty state only after success", async () => {
  const user = userEvent.setup();
  const events = callbacks();
  render(<Preparation lecture={lecture} {...events} />);
  await user.type(
    screen.getByLabelText("Recording note"),
    "Focus on determinants",
  );
  expect(events.onDirty).toHaveBeenLastCalledWith(true);
  expect(events.onReady).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole("button", { name: "Save preparation" }));
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("/api/lectures/lesson/preparation");
  expect(calls[0].init.method).toBe("PUT");
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    context: "Focus on determinants",
    selected_resource_ids: [],
  });
  await waitFor(() => expect(events.onReady).toHaveBeenLastCalledWith(true));
  expect(events.onDirty).toHaveBeenLastCalledWith(false);
  expect(events.onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ preparation_ready: true }),
  );
  expect(fetch).not.toHaveBeenCalledWith(
    expect.stringContaining("/courses/"),
    expect.anything(),
  );
});

it("selects only readable resources from this course and keeps selections across search", async () => {
  lecture = { ...base, course_id: "math" };
  resources = [
    resource,
    { ...resource, id: "foreign", course_id: "history", name: "Other class" },
    {
      ...resource,
      id: "error",
      name: "Unreadable PDF",
      text: "",
      error: "OCR failed",
    },
    { ...resource, id: "empty", name: "Empty text", text: "  " },
    {
      ...resource,
      id: "partial",
      name: "Partial extraction",
      error: "Only the first 100,000 characters were extracted",
    },
  ];
  const user = userEvent.setup();
  render(<Preparation lecture={lecture} {...callbacks()} />);
  const checkbox = await screen.findByRole("checkbox", {
    name: /Lecture slides/,
  });
  expect(screen.queryByText("Other class")).not.toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: /Unreadable PDF/ }),
  ).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /Empty text/ })).toBeDisabled();
  expect(
    screen.getByRole("checkbox", { name: /Partial extraction/ }),
  ).toBeEnabled();
  await user.click(checkbox);
  await user.type(
    screen.getByLabelText("Find class resources"),
    "nothing matches",
  );
  await user.click(screen.getByRole("button", { name: "Save preparation" }));
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    context: "",
    selected_resource_ids: ["slides"],
  });
});

it("preserves unsaved text and selections when polling delivers updated lecture data", async () => {
  lecture = {
    ...base,
    course_id: "math",
    context: "Saved note",
    preparation_ready: true,
  };
  const user = userEvent.setup();
  const events = callbacks();
  const view = render(<Preparation lecture={lecture} {...events} />);
  await user.type(screen.getByLabelText("Recording note"), " with edits");
  await user.click(
    await screen.findByRole("checkbox", { name: /Lecture slides/ }),
  );
  view.rerender(
    <Preparation
      lecture={{ ...lecture, context: "Remote change", updated_at: "later" }}
      {...events}
    />,
  );
  expect(screen.getByLabelText("Recording note")).toHaveValue(
    "Saved note with edits",
  );
  expect(
    screen.getByRole("checkbox", { name: /Lecture slides/ }),
  ).toBeChecked();
  expect(events.onDirty).toHaveBeenLastCalledWith(true);
});

it("retains edits on failed saves and enables generation only after a successful retry", async () => {
  failSave = true;
  const user = userEvent.setup();
  const events = callbacks();
  render(<Preparation lecture={lecture} {...events} />);
  await user.type(screen.getByLabelText("Recording note"), "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Save preparation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Preparation could not be saved",
  );
  expect(screen.getByLabelText("Recording note")).toHaveValue(
    "Keep this draft",
  );
  expect(events.onDirty).toHaveBeenLastCalledWith(true);
  expect(events.onReady).toHaveBeenLastCalledWith(false);
  failSave = false;
  await user.click(screen.getByRole("button", { name: "Save preparation" }));
  await waitFor(() => expect(events.onReady).toHaveBeenLastCalledWith(true));
});

it("requires removal of unavailable saved selections before saving", async () => {
  lecture = {
    ...base,
    course_id: "math",
    selected_resource_ids: ["foreign"],
    preparation_ready: true,
  };
  const user = userEvent.setup();
  const events = callbacks();
  render(<Preparation lecture={lecture} {...events} />);
  await screen.findByText(
    "Some selected resources are no longer available for this course.",
  );
  expect(events.onReady).toHaveBeenLastCalledWith(false);
  expect(
    screen.getByRole("button", { name: "Save preparation" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Remove unavailable selections" }),
  );
  await user.click(screen.getByRole("button", { name: "Save preparation" }));
  expect(
    JSON.parse(calls[0].init.body as string).selected_resource_ids,
  ).toEqual([]);
  expect(events.onReady).toHaveBeenLastCalledWith(false);
});

it("adopts saved context when a course and context change without local edits", async () => {
  const events = callbacks();
  const view = render(
    <Preparation lecture={{ ...base, context: "Old" }} {...events} />,
  );
  view.rerender(
    <Preparation
      lecture={{
        ...base,
        course_id: "math",
        context: "New saved context",
        preparation_ready: true,
      }}
      {...events}
    />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Recording note")).toHaveValue(
      "New saved context",
    ),
  );
  expect(events.onDirty).toHaveBeenLastCalledWith(false);
  expect(events.onReady).toHaveBeenLastCalledWith(true);
});

it("retains the recording note but clears old selections if the course changes", async () => {
  lecture = {
    ...base,
    course_id: "math",
    selected_resource_ids: ["slides"],
    preparation_ready: true,
  };
  const user = userEvent.setup();
  const events = callbacks();
  const view = render(<Preparation lecture={lecture} {...events} />);
  await screen.findByRole("checkbox", { name: /Lecture slides/ });
  await user.type(screen.getByLabelText("Recording note"), "My draft");
  lecture = {
    ...lecture,
    course_id: null,
    selected_resource_ids: [],
    preparation_ready: false,
  };
  view.rerender(<Preparation lecture={lecture} {...events} />);
  expect(screen.getByLabelText("Recording note")).toHaveValue("My draft");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save preparation" }));
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    context: "My draft",
    selected_resource_ids: [],
  });
});

it("gates generation despite lecture attachments and leaves local transcription available", async () => {
  lecture = {
    ...base,
    attachments: [
      {
        id: "attachment",
        name: "Old slides",
        kind: "pdf",
        text: "Context",
        url: "",
        created_at: "2026-09-24",
        error: null,
      },
    ],
  };
  const user = userEvent.setup();
  render(<LecturePage {...pageProps} />);
  expect(
    await screen.findByRole("button", { name: "Generate notes" }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText("Recording note"), "Unsaved context");
  expect(screen.getByRole("button", { name: "Generate notes" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Transcribe locally" }));
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    force: false,
    diarize: false,
    transcribe_only: true,
  });
});

it("requires an explicit Generate click after saving preparation", async () => {
  const user = userEvent.setup();
  render(<LecturePage {...pageProps} />);
  await user.type(
    await screen.findByLabelText("Recording note"),
    "Focus on examples",
  );
  await user.click(screen.getByRole("button", { name: "Save preparation" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate notes" }),
    ).toBeEnabled(),
  );
  expect(calls.map((call) => call.url)).toEqual([
    "/api/lectures/lesson/preparation",
  ]);
  await user.click(screen.getByRole("button", { name: "Generate notes" }));
  expect(calls[1].url).toBe("/api/lectures/lesson/process");
  expect(JSON.parse(calls[1].init.body as string)).toEqual({
    force: false,
    diarize: false,
  });
});

it("keeps local transcription available when a transcript already exists", async () => {
  lecture = {
    ...base,
    transcript: { language: "en", duration: 0, segments: [] },
  };
  render(<LecturePage {...pageProps} />);
  expect(
    await screen.findByRole("button", { name: "Transcribe locally" }),
  ).toBeEnabled();
});

it("preserves preparation drafts and navigation protection when changing lecture tabs", async () => {
  const user = userEvent.setup();
  const onDirty = vi.fn();
  render(<LecturePage {...pageProps} onDirty={onDirty} />);
  await user.type(
    await screen.findByLabelText("Recording note"),
    "Draft across tabs",
  );
  await user.click(screen.getByRole("tab", { name: "Materials" }));
  expect(screen.getByLabelText("Recording note")).toHaveValue(
    "Draft across tabs",
  );
  expect(onDirty).toHaveBeenLastCalledWith(true);
});

it.each(["recording", "generating"])(
  "disables preparation during %s and preserves recording transcript privacy",
  async (status) => {
    lecture = { ...base, status, context: "Saved", preparation_ready: true };
    render(<LecturePage {...pageProps} />);
    expect(await screen.findByLabelText("Recording note")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save preparation" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Generate notes" }),
    ).not.toBeInTheDocument();
    if (status === "recording")
      expect(
        screen.queryByRole("tab", { name: "Transcript" }),
      ).not.toBeInTheDocument();
  },
);
