import type { Page, Route } from "@playwright/test";

// Synthetic demo library for isolated browser checks only. It is served through
// Playwright route mocks and must never be written into a real LecNote library.
const now = new Date();
const day = (offset: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    .toISOString()
    .slice(0, 10);

export const settings = {
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
  capabilities: { whisper: true, ffmpeg: true, ocr: false, diarization: false },
};

const course = (id: string, code: string, name: string, color: string) => ({
  id,
  code,
  name,
  color,
  context: "",
  vocabulary: "",
  created_at: day(40),
  lecture_count: 0,
});
export const courses = [
  course("phy101", "PHY101", "Physics", "#22221f"),
  course("acc502", "ACC502", "Accounting", "#9b5b3c"),
  course("math201", "MATH201", "Calculus", "#3f7d4f"),
];
export const denseCourses = [
  ...courses,
  ...Array.from({ length: 9 }, (_, index) =>
    course(
      `extra${index}`,
      `HIST${300 + index}`,
      index === 4
        ? "Comparative constitutional history of federal and parliamentary systems"
        : `History seminar ${index + 1}`,
      "#476e9b",
    ),
  ),
];

const notes = {
  title: "Kinetic energy",
  overview:
    "Kinetic energy depends on mass and speed.\n\n$$E_k = \\frac{1}{2}mv^2.$$",
  takeaways: [],
  glossary: [],
  review_questions: [],
  chunks: [],
  usage: { input_tokens: 0, output_tokens: 0 },
  model: "demo",
};
const lecture = (
  id: string,
  title: string,
  status: string,
  duration: number,
  offset: number,
  courseId = "phy101",
) => ({
  id,
  title,
  course_id: courseId,
  course_code: courses.find((item) => item.id === courseId)?.code,
  course_name: courses.find((item) => item.id === courseId)?.name,
  course_color: courses.find((item) => item.id === courseId)?.color,
  source_name: "",
  media_type: "",
  status,
  duration,
  created_at: day(offset),
  updated_at: day(offset),
  context: "",
  language: "en",
  preparation_ready: true,
  selected_resource_ids: [],
  transcript: {
    language: "en",
    duration,
    segments: [
      {
        id: 0,
        start: 0,
        end: 12,
        text: "Kinetic energy depends on mass and speed.",
        speaker: null,
      },
    ],
  },
  notes: status === "ready" ? notes : null,
  user_notes: "",
  attachments: [],
  error: null,
  job: null,
});
export const lectures = [
  lecture("energy", "Energy of motion", "ready", 2712, 0),
  lecture("newton", "Newton's second law", "ready", 3128, 3),
  lecture("momentum", "Momentum and collisions", "draft", 2306, 5),
  lecture("work", "Work and power", "ready", 2495, 7),
  lecture("ledgers", "Ledgers and journals", "ready", 2900, 2, "acc502"),
];
const resource = (id: string, name: string, kind: string, text: string) => ({
  id,
  course_id: "phy101",
  name,
  kind,
  text,
  url: `/api/courses/phy101/resources/${id}/file`,
  created_at: day(10),
  updated_at: day(10),
  error: null,
  revision: 1,
});
export const resources = [
  resource(
    "ref",
    "Energy reference.pdf",
    "pdf",
    "Kinetic energy depends on mass and speed.",
  ),
  resource("slides", "Lecture slides.pdf", "pdf", "Energy of motion"),
  resource(
    "examples",
    "Worked examples.md",
    "md",
    "### 3. Kinetic energy\n\nKinetic energy depends on mass and speed.\n\n$$E_k = \\frac{1}{2}mv^2.$$",
  ),
];

export async function installDemoApi(
  page: Page,
  options: {
    courses?: typeof courses;
    failResources?: boolean;
    longTitle?: boolean;
  } = {},
) {
  const courseList = options.courses ?? courses;
  const lectureList = options.longTitle
    ? [
        {
          ...lectures[0],
          title:
            "Energy of motion, conservation of mechanical energy, and a very long derivation of the work–energy theorem",
        },
        ...lectures.slice(1),
      ]
    : lectures;
  const requests: string[] = [];
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requests.push(`${route.request().method()} ${path}${url.search}`);
    if (route.request().method() !== "GET")
      return route.fulfill({ status: 405, json: { detail: "Read-only demo" } });
    const detail = /^\/api\/lectures\/([^/]+)$/.exec(path);
    const courseResources = /^\/api\/courses\/([^/]+)\/resources$/.exec(path);
    if (path === "/api/settings") return route.fulfill({ json: settings });
    if (path === "/api/health")
      return route.fulfill({ json: { status: "ok" } });
    if (path === "/api/courses") return route.fulfill({ json: courseList });
    if (path === "/api/lectures") {
      const courseId = url.searchParams.get("course_id");
      const q = (url.searchParams.get("q") || "").toLowerCase();
      return route.fulfill({
        json: lectureList.filter(
          (item) =>
            (!courseId || item.course_id === courseId) &&
            item.title.toLowerCase().includes(q),
        ),
      });
    }
    if (detail) {
      const found = lectureList.find(
        (item) => item.id === decodeURIComponent(detail[1]),
      );
      return found
        ? route.fulfill({ json: found })
        : route.fulfill({ status: 404, json: { detail: "Lecture not found" } });
    }
    if (courseResources) {
      if (options.failResources)
        return route.fulfill({
          status: 500,
          json: { detail: "Course materials are unavailable." },
        });
      const q = (url.searchParams.get("q") || "").toLowerCase();
      return route.fulfill({
        json: resources.filter(
          (item) =>
            item.course_id === decodeURIComponent(courseResources[1]) &&
            `${item.name} ${item.text}`.toLowerCase().includes(q),
        ),
      });
    }
    return route.fulfill({ json: [] });
  });
  return requests;
}
