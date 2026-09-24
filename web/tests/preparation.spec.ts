import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`class resources and saved preparation at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const course = {
      id: "math",
      name: "Mathematics",
      code: "M101",
      color: "#235b44",
      context: "Linear algebra",
      vocabulary: "",
      created_at: "2026-09-24",
      lecture_count: 1,
    };
    let resources = [
      {
        id: "slides",
        course_id: "math",
        name: "Lecture slides: matrices, determinants, and linear transformations",
        kind: "pdf",
        text: "Determinants and inverses",
        revision: 1,
        created_at: "2026-09-24",
        updated_at: "2026-09-24",
      },
    ];
    let lecture = {
      id: "lesson",
      title: "Linear algebra",
      course_id: "math",
      source_name: "Imported transcript",
      media_type: "",
      status: "draft",
      duration: 10,
      created_at: "2026-09-24",
      updated_at: "2026-09-24",
      context: "",
      selected_resource_ids: [],
      preparation_ready: false,
      language: "en",
      transcript: {
        language: "en",
        duration: 10,
        segments: [
          {
            id: 0,
            start: 0,
            end: 10,
            text: "A matrix maps one vector space to another.",
            speaker: null,
          },
        ],
      },
      notes: null,
      user_notes: "",
      attachments: [],
      error: null,
      job: null,
    };
    const mutations: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (method !== "GET") mutations.push(path);
      if (path.endsWith("/resources/note") && method === "POST")
        resources = [
          ...resources,
          {
            ...resources[0],
            ...request.postDataJSON(),
            id: "note",
            kind: "note",
          },
        ];
      if (path.endsWith("/preparation"))
        lecture = {
          ...lecture,
          ...request.postDataJSON(),
          preparation_ready: true,
        };
      const result =
        path === "/api/settings"
          ? {
              model: "test",
              language: "en",
              capabilities: {},
              api_key_configured: false,
            }
          : path === "/api/courses"
            ? [course]
            : path.includes("/resources")
              ? resources
              : path === "/api/lectures"
                ? [lecture]
                : path.startsWith("/api/lectures/")
                  ? lecture
                  : path === "/api/health"
                    ? { status: "ok" }
                    : [];
      await route.fulfill({ json: result });
    });
    await page.goto("/#/courses");
    await page
      .getByRole("button", { name: "Resources for Mathematics" })
      .click();
    await expect(
      page.getByRole("link", { name: /^Open Lecture slides/ }),
    ).toHaveAttribute("href", "/api/courses/math/resources/slides/file");
    await page.screenshot({
      path: testInfo.outputPath(`resources-${width}.png`),
      fullPage: true,
    });
    const overflow = await page
      .locator('[role="dialog"]')
      .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByLabel("Resource name").fill("Exam focus");
    await page.getByLabel("Note text").fill("Practice inverses");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Exam focus", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.goto("/#/lecture/lesson");
    await expect(
      page.getByRole("button", { name: "Generate notes", exact: true }),
    ).toBeDisabled();
    await page
        .getByRole("textbox", { name: "Recording note", exact: true })
      .fill("Focus on worked examples");
    await page.getByRole("checkbox", { name: /^Lecture slides/ }).check();
    await page.getByRole("tab", { name: "Transcript", exact: true }).click();
    await expect(
        page.getByRole("textbox", { name: "Recording note", exact: true }),
    ).toHaveValue("Focus on worked examples");
    await page
      .getByRole("button", { name: "Save preparation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Generate notes", exact: true }),
    ).toBeEnabled();
    expect(mutations).toEqual([
      "/api/courses/math/resources/note",
      "/api/lectures/lesson/preparation",
    ]);
    await page.screenshot({
      path: testInfo.outputPath(`preparation-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Generate notes", exact: true })
      .click();
    await expect
      .poll(() => mutations.at(-1))
      .toBe("/api/lectures/lesson/process");
    expect(errors).toEqual([]);
  });
}
