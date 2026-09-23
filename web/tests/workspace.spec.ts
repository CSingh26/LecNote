import { expect, test } from "@playwright/test";

const settings = {
  model: "gpt-4.1-mini",
  whisper_model: "base",
  chunk_minutes: 8,
  parallel_requests: 4,
  language: "",
  diarization: true,
  api_key_configured: false,
  hf_token_configured: false,
  input_price_per_million: 0,
  output_price_per_million: 0,
  capabilities: { whisper: true, ffmpeg: true, ocr: true, diarization: false },
};
const lecture = {
  id: "test-lecture",
  title: "Browser test lecture",
  course_id: null,
  source_name: "Imported transcript",
  media_type: "",
  status: "draft",
  duration: 10,
  created_at: "2026-09-23",
  updated_at: "2026-09-23",
  context: "",
  language: "en",
  transcript: {
    language: "en",
    duration: 10,
    segments: [
      { id: 0, start: 0, end: 10, text: "A test idea", speaker: "Professor" },
    ],
  },
  notes: null,
  user_notes: "",
  attachments: [],
  error: null,
  job: null,
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const result =
      path === "/api/settings"
        ? settings
        : path === "/api/health"
          ? { status: "ok" }
          : path === "/api/live"
            ? { id: lecture.id, lecture_id: lecture.id }
            : path.startsWith("/api/lectures/")
              ? lecture
              : [];
    await route.fulfill({ json: result });
  });
});
test("empty desktop and mobile layouts, dialog keyboard access, and real native upload submit", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("Your library starts here")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("library-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "New lecture", exact: true })
    .first()
    .click();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Add lecture" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "New lecture", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Recording file")
    .setInputFiles({
      name: "test.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("test upload"),
    });
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/lectures") && request.method() === "POST",
  );
  await page.route("**/api/lectures", (route) =>
    route.fulfill({ json: lecture }),
  );
  await page.getByRole("button", { name: "Add lecture" }).click();
  expect((await request).postData()).toContain('name="process"\r\n\r\nfalse');
  await expect(
    page.getByText("Imported transcript · No source recording"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("OpenAI API key")).toHaveValue("");
  await page.screenshot({
    path: testInfo.outputPath("settings-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/library");
  await expect(page.getByText("Your library starts here")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("library-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("record-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("recording survives navigation, sends sample-derived ordered WAV chunks and finishes after the partial upload", async ({
  page,
}) => {
  const received: {
    sequence: number;
    offset: number;
    frames: number;
    rate: number;
  }[] = [];
  const events: string[] = [];
  await page.addInitScript(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    (window as unknown as { microphoneRequests: number }).microphoneRequests =
      0;
    navigator.mediaDevices.getUserMedia = (...args) => {
      (window as unknown as { microphoneRequests: number })
        .microphoneRequests++;
      return get(...args);
    };
  });
  await page.route("**/api/live/**/chunks", async (route) => {
    const body = route.request().postDataBuffer()!;
    const text = body.toString("latin1");
    const sequence = Number(text.match(/name="sequence"\r\n\r\n(\d+)/)![1]);
    const offset = Number(text.match(/name="offset"\r\n\r\n([\d.]+)/)![1]);
    const start = body.indexOf(Buffer.from("RIFF"));
    expect(body.readUInt16LE(start + 22)).toBe(1);
    expect(body.readUInt16LE(start + 34)).toBe(16);
    received.push({
      sequence,
      offset,
      frames: body.readUInt32LE(start + 40) / 2,
      rate: body.readUInt32LE(start + 24),
    });
    if (sequence > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    events.push(`chunk-${sequence}`);
    await route.fulfill({ json: { accepted: true } });
  });
  await page.route("**/api/live/**/finish", async (route) => {
    events.push("finish");
    await route.fulfill({ json: lecture });
  });
  await page.goto("/#/record");
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { microphoneRequests: number })
          .microphoneRequests,
    ),
  ).toBe(0);
  await page.getByLabel("Recording title").fill("Browser microphone test");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("button", { name: "Stop & save" })).toBeVisible();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByText("Recording in progress")).toBeVisible();
  await expect.poll(() => received.length, { timeout: 20000 }).toBe(1);
  await page.getByRole("link", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop & save" }).click();
  await expect(
    page.getByRole("button", { name: "Record another lecture" }),
  ).toBeVisible();
  expect(received).toHaveLength(2);
  expect(received[0]).toMatchObject({ sequence: 0, offset: 0 });
  expect(received[0].frames / received[0].rate).toBe(15);
  expect(received[1].sequence).toBe(1);
  expect(received[1].offset).toBe(15);
  expect(received[1].frames).toBeGreaterThan(0);
  expect(events).toEqual(["chunk-0", "chunk-1", "finish"]);
});
