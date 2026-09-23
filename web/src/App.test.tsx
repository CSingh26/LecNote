import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";

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
beforeEach(() => {
  window.location.hash = "#/library";
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      let result: unknown = [];
      if (url === "/api/settings") result = settings;
      if (url === "/api/health") result = { status: "ok" };
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

it("shows an authentic empty library and traps focus in the new lecture dialog", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(
    await screen.findByText("Your library starts here"),
  ).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "New lecture" })[0]);
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
  await user.click(screen.getAllByRole("button", { name: "New lecture" })[0]);
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
    screen.getByRole("button", { name: "Add lecture" }).closest("form")!,
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
