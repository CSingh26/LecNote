import { expect, test, type Page } from "@playwright/test";
import { denseCourses, installDemoApi } from "./fixtures/demo-library";

const shots = "test-results/redesign";
const noHorizontalOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
const box = async (page: Page, selector: string) =>
  (await page.locator(selector).first().boundingBox())!;

for (const width of [1440, 1280]) {
  test(`reading workspace keeps index, notes, and materials together at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await installDemoApi(page);
    await page.goto("/#/library?course=phy101");
    await page.getByRole("link", { name: /Energy of motion/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Energy of motion" }),
    ).toBeVisible();
    const index = page.getByRole("region", { name: "Lecture index" });
    await expect(
      index.getByRole("link", { name: /Energy of motion/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(index.getByRole("link", { name: /Newton/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Kinetic energy" }),
    ).toBeVisible();
    const materials = page.getByRole("region", {
      name: "Physics course materials",
    });
    await expect(materials.getByText("Worked examples.md")).toBeVisible();
    await materials
      .getByRole("button", { name: "Preview Worked examples.md" })
      .click();
    await expect(
      materials.getByRole("heading", { name: "3. Kinetic energy" }),
    ).toBeVisible();
    const h1 = await page
      .getByRole("heading", { level: 1 })
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(h1).toBeLessThanOrEqual(32);
    const rail = await box(page, ".course-rail");
    const indexBox = await box(page, ".lecture-index");
    const reader = await box(page, ".reader-column");
    expect(rail.x + rail.width).toBeLessThanOrEqual(indexBox.x + 1);
    expect(indexBox.x + indexBox.width).toBeLessThanOrEqual(reader.x + 1);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${shots}/reader-${width}.png` });
  });
}

test("library, materials, and every course stay reachable with ten or more courses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installDemoApi(page, { courses: denseCourses });
  await page.goto("/#/library");
  const rail = page.getByRole("navigation", { name: "Courses" });
  await expect(rail.getByRole("link")).toHaveCount(denseCourses.length + 1);
  const last = rail.getByRole("link", { name: /HIST308/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const long = rail.getByRole("link", { name: /Comparative constitutional/ });
  const longBox = (await long.boundingBox())!;
  const railBox = await box(page, ".course-rail");
  expect(longBox.x + longBox.width).toBeLessThanOrEqual(
    railBox.x + railBox.width,
  );
  await rail.getByRole("link", { name: /Physics/ }).click();
  await expect(page).toHaveURL(/#\/library\?course=phy101$/);
  await expect(
    page.getByRole("link", { name: "Materials", exact: true }),
  ).toHaveAttribute("href", "#/materials?course=phy101");
  await page.screenshot({ path: `${shots}/library-1280.png` });
  await page.getByRole("link", { name: "Materials", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Physics materials" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview Energy reference.pdf" })
    .click();
  await expect(page.getByRole("link", { name: "Open original" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${shots}/materials-1280.png` });
});

for (const width of [1280, 390]) {
  test(`material search and preview stay aligned at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await installDemoApi(page);
    await page.goto("/#/materials?course=phy101");
    await page
      .getByRole("button", { name: "Preview Energy reference.pdf" })
      .click();
    await expect(
      page.getByRole("link", { name: "Open original" }),
    ).toBeVisible();
    const search = await box(page, ".course-materials-search");
    const list = await box(page, ".material-list");
    const preview = await box(page, ".material-preview");
    expect(search.height).toBeLessThan(60);
    expect(search.y + search.height).toBeLessThanOrEqual(list.y);
    if (width > 900) {
      expect(Math.abs(list.y - preview.y)).toBeLessThanOrEqual(1);
      expect(list.x + list.width).toBeLessThanOrEqual(preview.x);
    } else {
      expect(list.y + list.height).toBeLessThanOrEqual(preview.y);
    }
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: `${shots}/material-preview-${width}.png`,
      fullPage: true,
    });
  });
}

test("Add lecture menu and course drawer work from the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDemoApi(page);
  await page.goto("/#/library?course=phy101");
  await expect(
    page.getByRole("link", { name: /Energy of motion/ }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${shots}/library-390.png` });
  const addLecture = page.getByRole("button", { name: "Add lecture" });
  await addLecture.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "Upload recording" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Course", { exact: true })).toHaveValue(
    "phy101",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(addLecture).toBeFocused();
  const toggle = page.getByRole("button", { name: "Open courses" });
  await expect(page.locator(".course-rail")).toBeHidden();
  await toggle.click();
  const rail = page.getByRole("navigation", { name: "Courses" });
  await expect(rail.getByRole("link", { name: /Calculus/ })).toBeVisible();
  await page.screenshot({ path: `${shots}/drawer-390.png` });
  await page.keyboard.press("Escape");
  await expect(page.locator(".course-rail")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open courses" }),
  ).toBeFocused();
});

for (const width of [390, 320]) {
  test(`narrow reader is full width with an explicit return at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await installDemoApi(page, { longTitle: true });
    await page.goto("/#/lecture/energy");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".lecture-index")).toBeHidden();
    const reader = await box(page, ".reader-column");
    expect(reader.width).toBeGreaterThan(width - 2);
    const title = await box(page, ".lecture-header h1");
    expect(title.width).toBeGreaterThan(width * 0.8);
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: `${shots}/reader-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Lectures" }).click();
    await expect(page).toHaveURL(/#\/library\?course=phy101$/);
    await expect(page.locator(".lecture-row").first()).toBeVisible();
    const rowTitle = await box(page, ".lecture-row .lecture-name");
    const status = await box(page, ".lecture-row .status");
    expect(rowTitle.x + rowTitle.width).toBeLessThanOrEqual(status.x + 1);
    await noHorizontalOverflow(page);
  });
}

test("remaining screens share the Course Editions system", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installDemoApi(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "library",
      "materials?course=phy101",
      "record",
      "courses",
      "jobs",
      "search",
      "settings",
    ]) {
      await page.goto(`/#/${route}`);
      await expect(page.locator("main h1").first()).toBeVisible();
      const size = await page
        .locator("main h1")
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      expect(size).toBeLessThanOrEqual(32);
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: `${shots}/${route.split("?")[0]}-${width}-screen.png`,
        fullPage: width < 800,
      });
    }
  }
  expect(errors).toEqual([]);
});

test.describe("motion", () => {
  test.use({ reducedMotion: "no-preference" });
  test("course markers use 160ms and reveals use 180ms", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDemoApi(page);
    await page.goto("/#/lecture/energy");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const marker = await page
      .locator(".course-rail nav a")
      .nth(1)
      .evaluate(
        (node) => getComputedStyle(node, "::before").transitionDuration,
      );
    expect(marker.split(",").map((value) => value.trim())).toContain("0.16s");
    const tab = await page
      .locator(".tabs > button")
      .first()
      .evaluate((node) => getComputedStyle(node, "::after").transitionDuration);
    expect(tab).toBe("0.16s");
    await page
      .getByRole("button", { name: "Preview Worked examples.md" })
      .click();
    const reveal = await page
      .locator(".material-preview")
      .evaluate((node) => getComputedStyle(node).animationDuration);
    expect(reveal).toBe("0.18s");
  });
});

test("reduced motion removes animation without hiding content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDemoApi(page);
  await page.goto("/#/lecture/energy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("button", { name: "Preview Worked examples.md" })
    .click();
  await page.getByRole("button", { name: "Add lecture" }).click();
  for (const selector of [
    "main",
    ".reader-column",
    "[role=tabpanel]",
    ".material-preview",
    ".menu-popover",
  ]) {
    const style = await page
      .locator(selector)
      .first()
      .evaluate((node) => {
        const computed = getComputedStyle(node);
        return {
          animation: computed.animationName,
          opacity: computed.opacity,
        };
      });
    expect(style).toEqual({ animation: "none", opacity: "1" });
  }
  const transition = await page
    .locator(".tabs > button")
    .first()
    .evaluate((node) => getComputedStyle(node, "::after").transitionDuration);
  expect(parseFloat(transition)).toBeLessThanOrEqual(0.001);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Add lecture" })).toBeFocused();
});

test("course material errors offer a retry beside the notes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDemoApi(page, { failResources: true });
  await page.goto("/#/lecture/energy");
  const materials = page.getByRole("region", {
    name: "Physics course materials",
  });
  await expect(materials.getByRole("alert")).toContainText(
    "Course materials are unavailable.",
  );
  await expect(materials.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Kinetic energy" }),
  ).toBeVisible();
});

test("narrow screens use a labelled drawer and a materials disclosure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDemoApi(page);
  await page.goto("/#/lecture/energy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Open courses" }).click();
  await expect(
    page.getByRole("navigation", { name: "Courses" }).getByRole("link").first(),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  const toggle = page.getByRole("button", { name: "Show course materials" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const materials = page.getByRole("region", {
    name: "Physics course materials",
  });
  await expect(materials.getByText("Energy reference.pdf")).toBeHidden();
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Hide course materials" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(materials.getByText("Energy reference.pdf")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `${shots}/reader-materials-390.png` });
});
