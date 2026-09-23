import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../web/node_modules/playwright/index.mjs';

const base = process.env.LECNOTE_TEST_URL || 'http://127.0.0.1:8766';
const output = path.resolve('artifacts/browser');
await fs.mkdir(output, { recursive: true });
const microphone = process.env.LECNOTE_TEST_MICROPHONE;
const browser = await chromium.launch({ headless: true, args: microphone ? [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${path.resolve(microphone)}`,
] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const suffix = Date.now().toString().slice(-7);
const courseName = `Physics verification ${suffix}`;
const lectureTitle = `Energy of motion ${suffix}`;
let lectureId;

async function fits() {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, 'Page must not overflow horizontally');
}

async function screenshot(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
}

try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/library-desktop.png`, fullPage: true });
  await fits();
  await page.getByRole('navigation').getByRole('link', { name: 'Courses', exact: true }).click();
  await page.getByRole('button', { name: 'New course', exact: true }).click();
  await page.getByLabel('Course name', { exact: true }).fill(courseName);
  await page.getByLabel('Course code', { exact: true }).fill('PHY 101');
  await page.getByLabel('Course context', { exact: true }).fill('Mechanics and energy');
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByRole('heading', { name: courseName }).waitFor();
  await page.getByRole('navigation').getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'New lecture', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Transcript', exact: true }).click();
  await dialog.getByLabel('Transcript file', { exact: true }).setInputFiles(path.resolve('examples/transcript.json'));
  await dialog.getByLabel('Lecture title', { exact: true }).fill(lectureTitle);
  const courses = await (await page.request.get(`${base}/api/courses`)).json();
  await dialog.getByLabel('Course', { exact: true }).selectOption(courses.find(item => item.name === courseName).id);
  await dialog.getByRole('button', { name: 'Import transcript', exact: true }).click();
  await page.getByRole('heading', { name: lectureTitle, exact: true }).waitFor();
  lectureId = new URL(page.url()).hash.split('/').at(-1);
  assert.equal(await page.locator('audio,video').count(), 0, 'Imported transcripts must not show a broken player');
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Edit transcript', exact: true }).click();
  await page.getByLabel('Speaker 1', { exact: true }).fill('Dr. Example');
  await page.getByRole('button', { name: 'Save transcript', exact: true }).click();
  await page.getByText('Dr. Example', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Generate notes', exact: true }).click();
  await page.getByRole('heading', { name: 'Key takeaways', exact: true }).waitFor({ timeout: 20000 });
  await page.locator('.katex').first().waitFor();
  await page.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await page.getByLabel('Your notes', { exact: true }).fill('Remember to check SI units.');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await page.getByText('Remember to check SI units.', { exact: true }).waitFor();
  await page.locator('.mermaid svg').waitFor();
  assert.match(await page.locator('.mermaid').textContent(), /Mass/);
  assert.match(await page.locator('.mermaid').textContent(), /Speed squared/);
  assert.ok(await page.locator('.mermaid .node').evaluateAll(nodes => nodes.every(node => {
    const box = node.querySelector('.label-container').getBoundingClientRect();
    const text = node.querySelector('text').getBoundingClientRect();
    return text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom;
  })), 'Diagram labels must fit inside their nodes');
  await screenshot('notes-desktop');
  await fits();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'What happens when speed doubles?' }).click();
  await page.getByText('Energy quadruples.', { exact: true }).waitFor();
  const downloadWait = page.waitForEvent('download');
  await page.getByLabel('Export lecture', { exact: true }).selectOption('pdf');
  const download = await downloadWait;
  await download.saveAs(`${output}/lecture.pdf`);
  assert.equal((await fs.readFile(`${output}/lecture.pdf`)).subarray(0, 5).toString(), '%PDF-');
  await page.getByRole('navigation').getByRole('link', { name: 'Search', exact: true }).click();
  const searchBox = page.locator('main input[type="search"],main input[placeholder*="Search"]').first();
  await searchBox.fill('velocity');
  await searchBox.press('Enter');
  await page.getByText(/velocity squared/).first().waitFor();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Chunk length (minutes)', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  assert.equal((await (await page.request.get(`${base}/api/settings`)).json()).chunk_minutes, 6);
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('settings-mobile');
  await fits();
  await page.goto(`${base}/#/lecture/${lectureId}`);
  await page.getByRole('heading', { name: 'Key takeaways', exact: true }).waitFor();
  assert.ok(await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right <= 0), 'Closed mobile sidebar must not cover notes');
  await screenshot('notes-mobile');
  await fits();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Record', exact: true }).click();
  await page.getByRole('heading', { name: /Record/ }).first().waitFor();
  await screenshot('record-mobile');
  await fits();
  if (microphone) {
    await page.getByLabel('Recording title', { exact: true }).fill(`Recorded verification ${suffix}`);
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await page.getByRole('button', { name: 'Stop & save', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.record-time')?.textContent === '0:16', null, { timeout: 25000 });
    const waveHasSignal = await page.locator('canvas').evaluate(canvas => {
      const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return values.some((value, index) => index % 4 === 3 && value > 0);
    });
    assert.equal(waveHasSignal, true);
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('link', { name: /Recording in progress/ }).click();
    await page.getByRole('button', { name: 'Stop & save', exact: true }).click();
    await page.getByRole('button', { name: 'Record another lecture', exact: true }).waitFor({ timeout: 20000 });
    await page.getByRole('link', { name: 'Open lecture', exact: true }).click();
    await page.getByRole('heading', { name: 'Key takeaways', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(await page.locator('audio').count(), 1);
    await screenshot('recorded-lecture-mobile');
    await fits();
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(JSON.stringify({ status: 'passed', lectureId, screenshots: output, checks: ['course creation', 'transcript import', 'speaker edit', 'notes generation fixture', 'math', 'personal notes', 'review answer', 'PDF export', 'search', 'settings', 'desktop/mobile layouts'] }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  console.error((await page.locator('body').innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser.close();
}
