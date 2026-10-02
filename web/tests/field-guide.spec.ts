import { expect, test, type Locator, type Page } from "@playwright/test";
import { installDemoApi, lectures } from "./fixtures/demo-library";

const shots = "test-results/field-guide";
type Theme = "light" | "dark";

test("long inline and display formulas scroll within the reader on desktop and mobile", async ({
  page,
}) => {
  const formula = String.raw`\frac{a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12} + a_{13} + a_{14} + a_{15} + a_{16} + a_{17} + a_{18} + a_{19} + a_{20}}{1 + x^2}`;
  await installDemoApi(page);
  await page.route("**/api/lectures/energy", (route) =>
    route.fulfill({
      json: {
        ...lectures[0],
        notes: {
          ...lectures[0].notes,
          overview: `Inline formula $${formula}$ stays available.\n\nShort formula $x^2$.\n\n$$\n${formula}\n$$`,
        },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/lecture/energy");
  const inline = page.locator("#overview .markdown p > .katex");
  await expect(inline).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noHorizontalOverflow(page);
    for (const formula of [
      inline.first(),
      page.locator("#overview .katex-display"),
    ]) {
      const scroll = await formula.evaluate((element) => {
        const content = element.querySelector(".katex-html")!;
        element.scrollLeft = 0;
        const before = content.getBoundingClientRect().right;
        element.scrollLeft = element.scrollWidth;
        const viewport = element.getBoundingClientRect();
        const end = content.getBoundingClientRect();
        return {
          client: element.clientWidth,
          total: element.scrollWidth,
          offset: element.scrollLeft,
          before,
          after: end.right,
          viewportRight: viewport.right,
          contentTop: end.top,
          contentBottom: end.bottom,
          viewportTop: viewport.top,
          viewportBottom: viewport.bottom,
        };
      });
      if (width === 390) {
        expect(scroll.total).toBeGreaterThan(scroll.client);
        expect(scroll.offset).toBeGreaterThan(0);
        expect(scroll.after).toBeLessThan(scroll.before);
      }
      expect(scroll.after).toBeLessThanOrEqual(scroll.viewportRight + 1);
      expect(scroll.contentTop).toBeGreaterThanOrEqual(scroll.viewportTop - 1);
      expect(scroll.contentBottom).toBeLessThanOrEqual(scroll.viewportBottom + 1);
    }
    expect(
      await inline
        .last()
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await noHorizontalOverflow(page);
  }
});

async function themeSelect(page: Page) {
  const rail = page.getByRole("complementary", { name: "Course index" });
  if (!(await rail.isVisible())) {
    await page.getByRole("button", { name: "Open courses" }).click();
  }
  const select = rail.getByRole("combobox", {
    name: "Color theme",
    exact: true,
  });
  await expect(select).toBeVisible();
  await expect(select).toHaveJSProperty("tagName", "SELECT");
  return select;
}

async function expectTheme(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function noHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(layout.document, "The document fits the viewport").toBeLessThanOrEqual(
    layout.viewport,
  );
  expect(layout.body, "The page content fits the viewport").toBeLessThanOrEqual(
    layout.viewport,
  );
}

async function setTheme(page: Page, theme: Theme) {
  await (await themeSelect(page)).selectOption(theme);
  await expectTheme(page, theme);
  const close = page.getByRole("button", {
    name: "Close courses",
    exact: true,
  });
  if (await close.count()) await page.keyboard.press("Escape");
}

async function expectReadableText(target: Locator, description: string) {
  await expect(target).toBeVisible();
  const result = await target.evaluate((element) => {
    type Color = [number, number, number, number];
    const context = document.createElement("canvas").getContext("2d")!;
    // Computed styles resolve the theme's CSS variables. A canvas converts
    // supported CSS color formats to sRGB, retaining their alpha channel.
    const color = (value: string): Color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r / 255, g / 255, b / 255, a / 255];
    };
    const over = (front: Color, back: Color): Color => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (!alpha) return [0, 0, 0, 0];
      const channel = (index: number) =>
        (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) /
        alpha;
      return [channel(0), channel(1), channel(2), alpha];
    };
    let foreground = color(getComputedStyle(element).color);
    let background: Color = [0, 0, 0, 0];
    const backgroundImages: string[] = [];
    // Composite from the text outward. Applying opacity to each complete
    // group also accounts for opacity inherited visually from ancestors.
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") {
        backgroundImages.push(style.backgroundImage);
      }
      const layer = color(style.backgroundColor);
      foreground = over(foreground, layer);
      background = over(background, layer);
      const opacity = Number(style.opacity);
      foreground[3] *= opacity;
      background[3] *= opacity;
    }
    const luminance = (value: Color) => {
      const linear = value
        .slice(0, 3)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        );
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const ink = luminance(foreground);
    const paper = luminance(background);
    return {
      ratio: (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05),
      foreground,
      background,
      backgroundImages,
    };
  });
  expect(result.backgroundImages, `${description}: solid background`).toEqual(
    [],
  );
  expect(result.background[3], `${description}: resolved canvas`).toBe(1);
  expect(result.foreground[3], `${description}: resolved text`).toBe(1);
  expect(
    result.ratio,
    `${description}: text contrast ${result.ratio.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(4.5);
}

for (const width of [1440, 390]) {
  test(`theme select supports keyboard, saved choices, and system changes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await installDemoApi(page);
    await page.goto("/#/library?course=phy101");
    await expectTheme(page, "dark");
    let select = await themeSelect(page);
    await expect(select).toHaveValue("system");
    await expect(select.getByRole("option")).toHaveCount(3);
    for (const label of ["Light", "Dark", "System"]) {
      await expect(
        select.getByRole("option", { name: label, exact: true }),
      ).toHaveCount(1);
    }

    const chooseWithKeyboard = async (value: "light" | "dark" | "system") => {
      await select.focus();
      await page.keyboard.press(value[0]);
      await page.keyboard.press("Tab");
      await expect(select).toHaveValue(value);
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("lecnote-theme")))
        .toBe(value);
    };

    await chooseWithKeyboard("light");
    await expectTheme(page, "light");
    await page.reload();
    await expectTheme(page, "light");
    select = await themeSelect(page);
    await expect(select).toHaveValue("light");

    await chooseWithKeyboard("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "dark");
    await chooseWithKeyboard("system");
    await expectTheme(page, "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "light");
    await page.reload();
    await expectTheme(page, "light");
    await expect(await themeSelect(page)).toHaveValue("system");
    await noHorizontalOverflow(page);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`demo library and lecture reader fit ${width}px in ${theme} theme`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await installDemoApi(page);
      await page.goto("/#/library?course=phy101");
      await expect(
        page.getByRole("heading", { name: "Physics", exact: true }),
      ).toBeVisible();
      const lecture = page.getByRole("link", { name: /Energy of motion/ });
      await expect(lecture).toBeVisible();
      await setTheme(page, theme);
      await page.evaluate(() => document.fonts.ready);
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: `${shots}/library-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });

      await lecture.click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Energy of motion" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Kinetic energy" }),
      ).toBeVisible();
      await expectTheme(page, theme);
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: `${shots}/reader-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      expect(errors).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`main text, muted text, selected course, and primary action are readable in ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDemoApi(page);
    await page.goto("/#/library?course=phy101");
    await expect(
      page.getByRole("link", { name: /Energy of motion/ }),
    ).toBeVisible();
    await setTheme(page, theme);
    await expectReadableText(
      page.locator(".lecture-name strong").first(),
      "Main text",
    );
    await expectReadableText(
      page.locator(".lecture-name small").first(),
      "Muted metadata",
    );
    const selectedCourse = page
      .getByRole("navigation", { name: "Courses", exact: true })
      .getByRole("link", { name: /Physics/ });
    await expect(selectedCourse).toHaveAttribute("aria-current", "page");
    await expectReadableText(
      selectedCourse.locator("strong"),
      "Selected course code",
    );
    await expectReadableText(
      selectedCourse.locator("span"),
      "Selected course name",
    );

    await page
      .getByRole("button", { name: "Add lecture", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Import transcript", exact: true })
      .click();
    const primary = page
      .getByRole("dialog")
      .getByRole("button", { name: "Import transcript", exact: true });
    await expect(primary).toBeEnabled();
    await expectReadableText(primary, "Primary action");
  });
}
