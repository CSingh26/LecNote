import { expect, test } from "@playwright/test";
import { installDemoApi, lectures } from "./fixtures/demo-library";

for (const width of [1440, 390]) {
  test(`study accents and dialog motion follow design tokens at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await installDemoApi(page);
    await page.route("**/api/lectures/energy", (route) =>
      route.fulfill({
        json: {
          ...lectures[0],
          notes_stale: true,
          notes: {
            ...lectures[0].notes,
            overview: "> Check the units before applying the energy formula.",
            chunks: [
              {
                index: 0,
                start: 0,
                end: 12,
                title: "Energy and units",
                summary: "Mass and speed determine kinetic energy.",
                formulas: [
                  {
                    latex: "E_k = \\frac{1}{2}mv^2",
                    explanation: "Energy in joules.",
                  },
                ],
                emphasized_points: ["Speed is squared."],
              },
            ],
          },
        },
      }),
    );
    await page.goto("/#/lecture/energy");
    for (const selector of [
      ".notes-content .notice",
      ".markdown blockquote",
      ".formula",
      ".emphasis",
    ]) {
      const element = page.locator(selector).first();
      await expect(element).toBeVisible();
      await expect.soft(element).toHaveCSS("border-left-width", "1px");
    }
    await page.screenshot({
      path: `test-results/polish/study-accents-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);

    await page.getByRole("button", { name: "Edit lecture details" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect.soft(dialog).toHaveCSS("animation-duration", "0.18s");
    const easing = await page
      .locator(":root")
      .evaluate((node) =>
        getComputedStyle(node).getPropertyValue("--ease").trim(),
      );
    await expect.soft(dialog).toHaveCSS("animation-timing-function", easing);
    await page.screenshot({
      path: `test-results/polish/dialog-${width}.png`,
      animations: "disabled",
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dialog).toHaveCSS("animation-name", "none");
    await expect(dialog).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Edit lecture details" }),
    ).toBeFocused();
  });
}
