import { expect, test } from "@playwright/test";
import { recording } from "../../src/components/Milestone5.fixtures";

for (const width of [1440, 390, 320]) {
  test(`merge, relevance and storage at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const writes: { url: string; data: unknown }[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(info.project.use.baseURL!).origin)
        return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (route.request().method() !== "GET") {
        writes.push({
          url: url.pathname,
          data: route.request().postDataJSON(),
        });
        return route.fulfill({ json: { ...recording, id: "merged" } });
      }
      return route.fulfill({
        json: [
          recording,
          {
            ...recording,
            id: "two",
            title: "Part two with a long title about energy and momentum",
          },
        ],
      });
    });
    await page.goto("/tests/milestone5/index.html");
    await page.getByRole("button", { name: "Merge recordings" }).click();
    const dialog = page.getByRole("dialog");
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByLabel("Merged lecture title").fill("Combined lecture");
    await dialog.getByRole("checkbox", { name: /Part one/ }).check();
    await dialog.getByRole("checkbox", { name: /Part two/ }).check();
    const up = dialog.getByRole("button", { name: /Move Part two.* up/ });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("listitem").first()).toContainText(
      "Part two",
    );
    await page.screenshot({
      path: info.outputPath(`merge-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Merge recordings" }).click();
    await expect(page).toHaveURL(/#\/lecture\/merged$/);
    expect(writes[0]).toEqual({
      url: "/api/lectures/merge",
      data: { lecture_ids: ["two", "one"], title: "Combined lecture" },
    });

    await page.goto("/tests/milestone5/index.html?view=relevance");
    await expect(page.getByRole("status")).toContainText("75 MiB saved");
    await page.getByRole("button", { name: "Seek to 0:15" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-seek", "15");
    await page.getByLabel("Category for segment 0").selectOption("off_topic");
    await expect(
      page.getByRole("button", { name: "Off topic (1)" }),
    ).toBeVisible();
    expect(writes[1]).toEqual({
      url: "/api/lectures/one/relevance",
      data: { overrides: { "0": "off_topic", "1": "class_logistics" } },
    });
    await page.screenshot({
      path: info.outputPath(`relevance-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const select of await page.getByRole("combobox").all()) {
      const bounds = await select.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }

    await page.goto("/tests/milestone5/index.html?view=settings");
    await expect(
      page.getByRole("checkbox", { name: /Compress recordings/ }),
    ).toBeChecked();
    await page.screenshot({
      path: info.outputPath(`settings-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
