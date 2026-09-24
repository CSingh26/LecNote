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

for (const stopMode of [
  "button",
  "ended",
  "setup",
  "paused",
  "paused-ended",
  "resume",
] as const) {
  test(`records microphone and lecture audio together through New lecture (${stopMode})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sessions: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/live"))
        sessions.push(request.url());
    });
    await page.addInitScript(() => {
      const tracks: MediaStreamTrack[] = [];
      const calls: string[] = [];
      function tone(frequency: number, video = false) {
        const context = new AudioContext({ sampleRate: 48000 });
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        void context.resume();
        if (video) {
          const canvas = document.createElement("canvas");
          destination.stream.addTrack(
            canvas.captureStream().getVideoTracks()[0],
          );
        }
        tracks.push(...destination.stream.getTracks());
        return destination.stream;
      }
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        value: async () => {
          calls.push("lecture");
          return tone(880, true);
        },
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          calls.push("microphone");
          return tone(220);
        },
      });
      Object.assign(window, { captureTest: { tracks, calls } });
    });
    const chunks: Buffer[] = [];
    const positions: { sequence: number; offset: number }[] = [];
    await page.route("**/api/live/**/chunks", async (route) => {
      const data = route.request().postDataBuffer()!;
      const start = data.indexOf(Buffer.from("RIFF"));
      const length = data.readUInt32LE(start + 40);
      chunks.push(data.subarray(start, start + 44 + length));
      const body = data.toString("latin1");
      positions.push({
        sequence: Number(body.match(/name="sequence"\r\n\r\n(\d+)/)![1]),
        offset: Number(body.match(/name="offset"\r\n\r\n([\d.]+)/)![1]),
      });
      await route.fulfill({ json: { accepted: true } });
    });
    await page.route("**/api/live/**/finish", (route) =>
      route.fulfill({ json: lecture }),
    );
    let releaseSession = () => {};
    if (stopMode === "setup") {
      const pending = new Promise<void>((resolve) => {
        releaseSession = resolve;
      });
      await page.route("**/api/live", async (route) => {
        await pending;
        await route.fulfill({
          json: { id: lecture.id, lecture_id: lecture.id },
        });
      });
    }
    await page.goto("/");
    await page
      .getByRole("button", { name: "New lecture", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Record live", exact: true })
      .click();
    await page
      .getByLabel("Lecture title", { exact: true })
      .fill("Mixed lecture");
    await page
      .getByRole("button", { name: "Open recorder", exact: true })
      .click();
    await expect(page.getByLabel("Recording title")).toHaveValue(
      "Mixed lecture",
    );
    await page.getByRole("button", { name: "Both", exact: true }).click();
    const started = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/api/live"),
    );
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await started;
    if (stopMode === "setup") {
      const cancellation = page.waitForRequest((request) =>
        request.url().endsWith(`/lectures/${lecture.id}/cancel`),
      );
      try {
        const stopped = await page.evaluate(() => {
          const tracks = (
            window as unknown as { captureTest: { tracks: MediaStreamTrack[] } }
          ).captureTest.tracks;
          const video = tracks.find((track) => track.kind === "video")!;
          video.stop();
          video.dispatchEvent(new Event("ended"));
          return tracks.every((track) => track.readyState === "ended");
        });
        expect(stopped).toBe(true);
      } finally {
        releaseSession();
      }
      await cancellation;
      await expect(
        page.getByRole("button", { name: "Start recording", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/sharing ended before recording/i),
      ).toBeVisible();
      expect(chunks).toHaveLength(0);
      expect(errors).toEqual([]);
      return;
    }
    await expect(page.locator(".record-time")).toHaveText("0:02", {
      timeout: 10000,
    });
    const pauses = ["paused", "paused-ended", "resume"].includes(stopMode);
    if (pauses) {
      await page
        .getByRole("button", { name: "Pause recording", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText("Paused");
      await expect.poll(() => chunks.length).toBe(1);
      const elapsed = await page.locator(".record-time").innerText();
      await expect(page.getByLabel("Recording title")).toBeDisabled();
      // Audio still arrives from the synthetic inputs throughout this break.
      await page.waitForTimeout(1200);
      await expect(page.locator(".record-time")).toHaveText(elapsed);
      expect(chunks).toHaveLength(1);
      await page.getByRole("link", { name: "Library", exact: true }).click();
      await expect(
        page.getByText("Recording paused", { exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Record", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Resume recording" }),
      ).toBeVisible();
      await expect(
        page.getByText("Live transcript", { exact: true }),
      ).toHaveCount(0);
      const protectedPage = await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(protectedPage).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("paused-desktop.png"),
        fullPage: true,
      });
      if (stopMode === "resume") {
        await page.getByRole("button", { name: "Resume recording" }).click();
        await expect(page.getByRole("status")).toHaveText("Recording");
        await expect(page.locator(".record-time")).not.toHaveText(elapsed);
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("both-recording-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("both-recording-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (stopMode === "ended" || stopMode === "paused-ended") {
      await page.evaluate(() => {
        const track = (
          window as unknown as { captureTest: { tracks: MediaStreamTrack[] } }
        ).captureTest.tracks.find((track) => track.kind === "video")!;
        track.stop();
        track.dispatchEvent(new Event("ended"));
      });
    } else {
      await page
        .getByRole("button", { name: "Stop & save", exact: true })
        .click();
    }
    await expect(
      page.getByRole("button", { name: "Record another lecture" }),
    ).toBeVisible();
    expect(chunks).toHaveLength(stopMode === "resume" ? 2 : 1);
    expect(sessions).toHaveLength(1);
    let total = 0;
    chunks.forEach((chunk, index) => {
      expect(positions[index]).toEqual({
        sequence: index,
        offset: total / 48000,
      });
      total += chunk.readUInt32LE(40) / 2;
    });
    const wav = chunks[0],
      rate = wav.readUInt32LE(24);
    expect(wav.readUInt16LE(22)).toBe(1);
    const samples = (wav.length - 44) / 2;
    for (const frequency of [220, 880]) {
      let sin = 0,
        cos = 0;
      const start = Math.floor(rate / 4),
        count = Math.floor(rate / 2);
      expect(samples).toBeGreaterThan(start + count);
      for (let n = 0; n < count; n++) {
        const sample = wav.readInt16LE(44 + (start + n) * 2) / 32768;
        const angle = (2 * Math.PI * frequency * n) / rate;
        sin += sample * Math.sin(angle);
        cos += sample * Math.cos(angle);
      }
      expect((2 * Math.hypot(sin, cos)) / count).toBeGreaterThan(0.15);
    }
    const capture = await page.evaluate(() => {
      const test = (
        window as unknown as {
          captureTest: { tracks: MediaStreamTrack[]; calls: string[] };
        }
      ).captureTest;
      return {
        calls: test.calls,
        states: test.tracks.map((track) => track.readyState),
      };
    });
    expect(capture.calls).toEqual(["lecture", "microphone"]);
    expect(capture.states.every((state) => state === "ended")).toBe(true);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "New lecture", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Record live", exact: true })
      .click();
    await page
      .getByLabel("Lecture title", { exact: true })
      .fill("A different lecture");
    await page
      .getByRole("button", { name: "Open recorder", exact: true })
      .click();
    await expect(page.getByLabel("Recording title")).toHaveValue(
      "A different lecture",
    );
    expect(errors).toEqual([]);
  });
}
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
  await page.getByLabel("Recording file").setInputFiles({
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
  await expect(page.getByText("Live transcript", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByText("Recording in progress")).toBeVisible();
  await expect.poll(() => received.length, { timeout: 20000 }).toBe(1);
  await page.getByRole("link", { name: "Record", exact: true }).click();
  await expect(page.getByText("Live transcript", { exact: true })).toHaveCount(
    0,
  );
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
