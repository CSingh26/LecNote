import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import type { Course, Lecture, Resource } from "./types";

const settings = {
  model: "gpt-4.1-mini",
  whisper_model: "base",
  chunk_minutes: 8,
  parallel_requests: 4,
  language: "",
  diarization: false,
  api_key_configured: false,
  hf_token_configured: false,
  input_price_per_million: 0,
  output_price_per_million: 0,
  capabilities: {
    whisper: false,
    ffmpeg: false,
    ocr: false,
    diarization: false,
  },
};
const requests: { url: string; init?: RequestInit }[] = [];
let courseList: Course[] = [];
let lectureList: Lecture[] = [];
let resourceList: Resource[] = [];
const makeCourse = (id: string, code: string, name: string): Course => ({
  id,
  name,
  code,
  color: "#f1de54",
  context: "",
  vocabulary: "",
  created_at: "2026-09-23",
  lecture_count: 1,
});
const makeLecture = (
  id: string,
  title: string,
  course: string | null,
): Lecture => ({
  id,
  title,
  course_id: course,
  source_name: "",
  media_type: "",
  status: "ready",
  duration: 2712,
  created_at: "2026-09-28",
  updated_at: "2026-09-28",
  context: "",
  language: "en",
  preparation_ready: true,
  transcript: {
    language: "en",
    duration: 4,
    segments: [{ id: 0, start: 0, end: 4, text: "Energy", speaker: null }],
  },
  notes: null,
  user_notes: "",
  attachments: [],
  error: null,
  job: null,
});
beforeEach(() => {
  // Canvas drawing is verified in Chromium, not jsdom.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  window.location.hash = "#/library";
  requests.length = 0;
  courseList = [];
  lectureList = [];
  resourceList = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      let result: unknown = [];
      if (url === "/api/settings") result = settings;
      if (url === "/api/health") result = { status: "ok" };
      if (url === "/api/courses") result = courseList;
      if (url.startsWith("/api/lectures?")) {
        const course = new URL(url, "http://localhost").searchParams.get(
          "course_id",
        );
        result = lectureList.filter(
          (lecture) => !course || lecture.course_id === course,
        );
      }
      const detail = /^\/api\/lectures\/([^/?]+)$/.exec(url);
      if (detail && !init?.method)
        result = lectureList.find(
          (lecture) => lecture.id === decodeURIComponent(detail[1]),
        );
      const resources = /^\/api\/courses\/([^/]+)\/resources/.exec(url);
      if (resources)
        result = resourceList.filter(
          (resource) => resource.course_id === resources[1],
        );
      if (url === "/api/courses" && init?.method === "POST")
        result = {
          id: "course-1",
          ...JSON.parse(init.body as string),
          lecture_count: 0,
        };
      if (url === "/api/lectures" && init?.method === "POST")
        result = {
          id: "lecture-1",
          title: "Lecture",
          status: "draft",
          attachments: [],
          transcript: null,
        };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

it("carries the selected class into New lecture and then the recorder", async () => {
  courseList = [
    {
      id: "acc502",
      name: "ACC",
      code: "502",
      color: "#26715b",
      context: "",
      vocabulary: "",
      created_at: "2026-09-23",
      lecture_count: 0,
    },
  ];
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("option", { name: "502 · ACC" });
  await user.selectOptions(screen.getByLabelText("Filter by course"), "acc502");
  expect(window.location.hash).toBe("#/library?course=acc502");
  await user.click(await screen.findByRole("button", { name: "Add lecture" }));
  await user.click(screen.getByRole("menuitem", { name: "Upload recording" }));
  expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue(
    "acc502",
  );
  await user.type(screen.getByLabelText("Lecture title"), "Accounting lecture");
  await user.click(screen.getByRole("button", { name: "Record live" }));
  await user.click(screen.getByRole("button", { name: "Open recorder" }));
  expect(await screen.findByRole("combobox", { name: "Course" })).toHaveValue(
    "acc502",
  );
});

it("opens the recorder directly from the library header", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Your library starts here");
  await user.click(
    within(document.querySelector(".app-header")!).getByRole("link", {
      name: "Record lecture",
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Start recording" }),
  ).toBeInTheDocument();
  expect(requests.some((request) => request.url === "/api/live")).toBe(false);
});

it("opens the recorder from New lecture without requiring a file or losing details", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Your library starts here");
  await user.click(screen.getByRole("button", { name: "Upload recording" }));
  await user.type(
    screen.getByLabelText("Lecture title"),
    "Energy and momentum",
  );
  await user.type(
    screen.getByLabelText("Lecture context"),
    "Conservation laws",
  );
  await user.click(screen.getByRole("button", { name: "Record live" }));
  expect(screen.queryByLabelText("Recording file")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open recorder" }));
  expect(await screen.findByLabelText("Recording title")).toHaveValue(
    "Energy and momentum",
  );
  expect(screen.getByLabelText("Lecture context")).toHaveValue(
    "Conservation laws",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(requests.some((request) => request.init?.method === "POST")).toBe(
    false,
  );
});

it("shows an authentic empty library and traps focus in the new lecture dialog", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(
    await screen.findByText("Your library starts here"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Upload recording" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toBeInTheDocument();
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("uploads a draft by default when no API key is configured", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Your library starts here");
  await user.click(screen.getByRole("button", { name: "Upload recording" }));
  expect(
    screen.getByRole("checkbox", { name: /Generate notes after upload/i }),
  ).not.toBeChecked();
  await user.upload(
    screen.getByLabelText("Recording file"),
    new File(["audio"], "lesson.wav", { type: "audio/wav" }),
  );
  expect(screen.getByLabelText("Lecture title")).toHaveValue("lesson");
  expect(
    (screen.getByLabelText("Recording file") as HTMLInputElement).files?.[0]
      .name,
  ).toBe("lesson.wav");
  // jsdom's native file validity does not see user-event's FileList shim.
  // Browser coverage exercises the actual submit button and native validation.
  fireEvent.submit(
    within(screen.getByRole("dialog"))
      .getByRole("button", { name: "Add lecture" })
      .closest("form")!,
  );
  await waitFor(() =>
    expect(requests.some((r) => r.init?.body instanceof FormData)).toBe(true),
  );
  const form = requests.find((r) => r.init?.body instanceof FormData)!.init!
    .body as FormData;
  expect(form.get("process")).toBe("false");
});

it("creates a course through the array-based API", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("link", { name: "Courses" }));
  await user.click(await screen.findByRole("button", { name: "New course" }));
  await user.type(screen.getByLabelText("Course name"), "Mechanics");
  await user.type(screen.getByLabelText("Course code"), "PHY 101");
  await user.click(screen.getByRole("button", { name: "Create course" }));
  await waitFor(() =>
    expect(
      requests.find(
        (r) => r.url === "/api/courses" && r.init?.method === "POST",
      ),
    ).toBeTruthy(),
  );
  expect(
    JSON.parse(
      requests.find((r) => r.init?.method === "POST")!.init!.body as string,
    ),
  ).toMatchObject({ name: "Mechanics", code: "PHY 101" });
});

it("keeps saved secrets blank and omits untouched secrets when saving settings", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("link", { name: "Settings" }));
  const key = await screen.findByLabelText("OpenAI API key");
  expect(key).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Chunk length (minutes)"), {
    target: { value: "6" },
  });
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    expect(requests.some((r) => r.init?.method === "PUT")).toBe(true),
  );
  const payload = JSON.parse(
    requests.find((r) => r.init?.method === "PUT")!.init!.body as string,
  );
  expect(payload.chunk_minutes).toBe(6);
  expect(payload).not.toHaveProperty("api_key");
  expect(payload).not.toHaveProperty("hf_token");
});

it.each([
  "#/lectures/missing",
  "#/lecture",
  "#/lecture/%ZZ",
  "#/library/extra",
])("offers a return to the library from an invalid route %s", async (hash) => {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Page not found" }),
  ).toBeInTheDocument();
  expect(document.title).toBe("Page not found · LecNote");
  await user.click(screen.getByRole("link", { name: "Back to library" }));
  expect(
    await screen.findByText("Your library starts here"),
  ).toBeInTheDocument();
});

const physicsLibrary = () => {
  courseList = [
    makeCourse("phy101", "PHY101", "Physics"),
    makeCourse("acc502", "ACC502", "Accounting"),
  ];
  lectureList = [
    makeLecture("energy", "Energy of motion", "phy101"),
    makeLecture("newton", "Newton's second law", "phy101"),
    makeLecture("ledger", "Ledgers", "acc502"),
  ];
  resourceList = [
    {
      id: "source-1",
      course_id: "phy101",
      name: "Energy reference.pdf",
      kind: "pdf",
      text: "Kinetic energy",
      created_at: "2026-09-28",
      updated_at: "2026-09-28",
      revision: 1,
    },
  ];
};

it("keeps every course reachable and syncs the course across destinations", async () => {
  courseList = Array.from({ length: 10 }, (_, index) =>
    makeCourse(`c${index}`, `C${index}`, `Course ${index}`),
  );
  courseList[3] = makeCourse("phy101", "PHY101", "Physics");
  const user = userEvent.setup();
  render(<App />);
  const rail = await screen.findByRole("navigation", { name: "Courses" });
  await within(rail).findByRole("link", { name: /Course 9/ });
  expect(within(rail).getAllByRole("link")).toHaveLength(11);
  expect(
    within(rail).getByRole("link", { name: "All courses" }),
  ).toHaveAttribute("aria-current", "page");
  await user.click(within(rail).getByRole("link", { name: /Physics/ }));
  expect(window.location.hash).toBe("#/library?course=phy101");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Physics" }),
  ).toBeInTheDocument();
  expect(within(rail).getByRole("link", { name: /Physics/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Materials" })).toHaveAttribute(
    "href",
    "#/materials?course=phy101",
  );
});

it("opens Materials for the selected course", async () => {
  physicsLibrary();
  window.location.hash = "#/materials?course=phy101";
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Physics materials" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Energy reference.pdf")).toBeVisible();
  expect(document.title).toBe("Materials · LecNote");
});

it("imports a transcript into the selected course from the Add lecture menu", async () => {
  physicsLibrary();
  window.location.hash = "#/library?course=phy101";
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("link", { name: /Energy of motion/ });
  await user.click(screen.getByRole("button", { name: "Add lecture" }));
  await user.click(screen.getByRole("menuitem", { name: "Import transcript" }));
  expect(screen.getByLabelText("Course")).toHaveValue("phy101");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add lecture" })).toHaveFocus();
});

it("keeps the lecture index visible beside selected notes", async () => {
  physicsLibrary();
  window.location.hash = "#/library?course=phy101";
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("link", { name: /Energy of motion/ }),
  );
  expect(
    await screen.findByRole("heading", { level: 1, name: "Energy of motion" }),
  ).toBeInTheDocument();
  const index = screen.getByRole("region", { name: "Lecture index" });
  expect(
    await within(index).findByRole("link", { name: /Energy of motion/ }),
  ).toHaveAttribute("aria-current", "page");
  expect(within(index).getByRole("link", { name: /Newton/ })).toBeVisible();
  expect(within(index).queryByText("Ledgers")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Notes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const materials = screen.getByRole("region", {
    name: "Physics course materials",
  });
  expect(
    await within(materials).findByText("Energy reference.pdf"),
  ).toBeVisible();
});

it("resolves the correct course for a direct lecture link", async () => {
  physicsLibrary();
  window.location.hash = "#/lecture/energy?t=12";
  render(<App />);
  const index = await screen.findByRole("region", { name: "Lecture index" });
  expect(
    await within(index).findByRole("heading", { name: "Physics" }),
  ).toBeInTheDocument();
  const rail = screen.getByRole("navigation", { name: "Courses" });
  await waitFor(() =>
    expect(within(rail).getByRole("link", { name: /Physics/ })).toHaveAttribute(
      "aria-current",
      "page",
    ),
  );
  expect(screen.getByRole("link", { name: "Materials" })).toHaveAttribute(
    "href",
    "#/materials?course=phy101",
  );
});

it("close reader returns to the selected course", async () => {
  physicsLibrary();
  window.location.hash = "#/lecture/energy";
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Energy of motion" });
  await user.click(screen.getByRole("link", { name: "Close lecture" }));
  expect(window.location.hash).toBe("#/library?course=phy101");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Physics" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Lecture index" })).toBeNull();
});

it("rejecting unsaved edits preserves the selected lecture", async () => {
  physicsLibrary();
  window.location.hash = "#/lecture/energy";
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Energy of motion" });
  await user.click(screen.getByRole("button", { name: "Edit notes" }));
  await user.type(screen.getByLabelText("Your notes"), "Draft");
  await user.click(screen.getByRole("link", { name: "Close lecture" }));
  expect(confirm).toHaveBeenCalled();
  expect(window.location.hash).toBe("#/lecture/energy");
  expect(screen.getByLabelText("Your notes")).toHaveValue("Draft");
  expect(
    screen.getByRole("heading", { level: 1, name: "Energy of motion" }),
  ).toBeInTheDocument();
});
