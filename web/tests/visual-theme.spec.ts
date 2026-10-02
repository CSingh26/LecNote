import { expect, test } from "@playwright/test";
import { installDemoApi, lectures } from "./fixtures/demo-library";

const palette = `
  :root[data-theme="light"] { --ink: #282b24; --muted: #61655c; --surface: #fffdf7; --surface-2: #f3f0e6; --line: #dedbd0; --primary: #526850; }
  :root[data-theme="dark"] { --ink: #f2eee2; --muted: #b5b6a8; --surface: #252921; --surface-2: #30362b; --line: #525b4b; --primary: #aac09e; }
`;

test("idle waveform repaints when the theme changes without new audio", async ({
  page,
}) => {
  await installDemoApi(page);
  await page.goto("/#/record");
  await page.addStyleTag({ content: palette });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const waveform = page.getByRole("img", { name: "Live recording waveform" });
  await expect(waveform).toBeVisible();
  const light = await waveform.evaluate((node) =>
    (node as HTMLCanvasElement).toDataURL(),
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect
    .poll(() =>
      waveform.evaluate(
        (node, previous) =>
          (node as HTMLCanvasElement).toDataURL() !== previous,
        light,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeEnabled();
});

test("Mermaid redraws for a new theme while preserving its lecture content", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installDemoApi(page);
  await page.route("**/api/lectures/energy", (route) =>
    route.fulfill({
      json: {
        ...lectures[0],
        notes: {
          ...lectures[0].notes,
          chunks: [
            {
              index: 0,
              start: 0,
              end: 12,
              title: "Energy transfer",
              summary: "Energy moves through a system.",
              visual: {
                kind: "mermaid",
                title: "Energy pathway",
                mermaid: "flowchart LR\n  A[Stored energy] --> B[Motion]",
              },
            },
          ],
        },
      },
    }),
  );
  await page.goto("/#/lecture/energy");
  await page.addStyleTag({ content: palette });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const diagram = page.getByRole("img", { name: "Lecture diagram" });
  await expect(
    diagram.getByText("Stored energy", { exact: true }),
  ).toBeVisible();
  const originalSvg = await diagram.locator("svg").elementHandle();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect
    .poll(() => originalSvg!.evaluate((node) => node.isConnected))
    .toBe(false);
  await expect(
    diagram.getByText("Stored energy", { exact: true }),
  ).toBeVisible();
  await expect(diagram.getByText("Motion", { exact: true })).toBeVisible();
  await expect(diagram.locator("script, foreignObject, style")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("lecture plots follow the current theme without changing their data", async ({
  page,
}) => {
  await installDemoApi(page);
  await page.route("**/api/lectures/energy", (route) =>
    route.fulfill({
      json: {
        ...lectures[0],
        notes: {
          ...lectures[0].notes,
          chunks: [
            {
              index: 0,
              start: 0,
              end: 12,
              title: "Speed and energy",
              summary: "Energy grows with speed.",
              visual: {
                kind: "plot",
                title: "Measured energy",
                x: [0, 1, 2],
                y: [0, 1, 4],
                x_label: "Speed",
                y_label: "Energy",
              },
            },
          ],
        },
      },
    }),
  );
  await page.goto("/#/lecture/energy");
  await page.addStyleTag({ content: palette });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const plot = page.getByRole("img", { name: "Measured energy" });
  await expect(plot).toBeVisible();
  const points = await plot.locator("polyline").getAttribute("points");
  const light = await plot
    .locator("polyline")
    .evaluate((node) => getComputedStyle(node).stroke);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect
    .poll(() =>
      plot
        .locator("polyline")
        .evaluate((node) => getComputedStyle(node).stroke),
    )
    .not.toBe(light);
  await expect(plot.locator("polyline")).toHaveAttribute("points", points!);
});
