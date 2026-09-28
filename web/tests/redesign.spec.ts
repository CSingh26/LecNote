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
