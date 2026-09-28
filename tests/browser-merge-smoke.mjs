import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "../web/node_modules/playwright/index.mjs";

// Run only against tests/browser_server.py with a throwaway library.
const base = process.env.LECNOTE_TEST_URL || "http://127.0.0.1:8871";
const output = path.resolve("artifacts/browser-merge");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function request(method, endpoint, options = {}) {
  const response = await page.request[method](base + "/api" + endpoint, options);
  assert.ok(response.ok(), `${endpoint}: ${await response.text()}`);
  return response.json();
}

function audio() {
  const wav = Buffer.alloc(44 + 32000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  return wav;
}

try {
  const course = await request("post", "/courses", {
    data: { name: "Merge verification", code: "PHY102", color: "#b85e26" },
  });
  const resource = await request("post", `/courses/${course.id}/resources/note`, {
    data: { name: "Energy reference", text: "Kinetic energy is proportional to speed squared." },
  });
  const parts = [];
  for (const [index, title] of ["Motion: first part", "Motion: second part"].entries()) {
    const part = await request("post", "/lectures", {
      multipart: {
        title, course_id: course.id, process: "false",
        file: { name: "part.wav", mimeType: "audio/wav", buffer: audio() },
      },
    });
    await request("put", `/lectures/${part.id}/transcript`, {
      data: { language: "en", duration: 1, segments: [
        { id: 0, start: 0, end: 1, text: index ? "Check the units." : "Energy depends on speed." },
      ] },
    });
    parts.push(part);
  }
  await request("put", `/lectures/${parts[0].id}/preparation`, {
    data: { context: "Focus on the worked examples.", selected_resource_ids: [resource.id] },
  });
  await request("post", `/lectures/${parts[0].id}/attachments`, {
    multipart: { file: { name: "worked-example.txt", mimeType: "text/plain", buffer: Buffer.from("Mass is 2 kg.") } },
  });
  await page.goto(base + "/#/library?course=" + course.id);
  await page.getByRole("button", { name: "Merge recordings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Merged lecture title").fill("Motion: complete lecture");
  for (const part of parts)
    await dialog.getByRole("checkbox", { name: new RegExp(part.title) }).check();
  assert.equal(await dialog.getByRole("checkbox", { name: "Generate notes after merging" }).isChecked(), true);
  await page.screenshot({ path: output + "/merge-desktop.png", fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "Merge and generate notes" }).click();
  await page.getByRole("heading", { name: "Key takeaways", exact: true }).waitFor();
  const id = new URL(page.url()).hash.split("/").at(-1);
  const merged = await request("get", "/lectures/" + id);
  assert.equal(merged.status, "ready");
  assert.equal(merged.job.status, "completed");
  assert.equal(merged.notes.title, "Motion: complete lecture");
  assert.equal(merged.notes.provenance.resource_provenance[0].id, resource.id);
  assert.match(merged.notes.provenance.context, /Focus on the worked examples/);
  assert.equal(merged.transcript.segments.length, 2);
  assert.equal(merged.attachments.length, 1);
  assert.equal(merged.attachments[0].name, "worked-example.txt");
  assert.equal(merged.selected_resource_ids[0], resource.id);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 800)
      await page.waitForFunction(() => document.querySelector(".sidebar").getBoundingClientRect().right <= 0);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/notes-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.getByRole("tab", { name: /^Materials/ }).click();
  await page.getByText("worked-example.txt", { exact: true }).waitFor();
  await page.screenshot({ path: output + "/materials-mobile.png", fullPage: true });
  const material = await page.request.get(base + merged.attachments[0].url);
  assert.equal(await material.text(), "Mass is 2 kg.");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    status: "passed", mergedLectureId: id, screenshots: output,
    checks: ["real FFmpeg merge", "explicit note job completion", "retained preparation",
      "class resource provenance", "independent attachment download", "desktop and mobile layout"],
  }));
} finally {
  await browser.close();
}
