// Photographs of the ABCode page itself (not part of node --test).
// Usage: node test/visual/shoot.mjs [port] [name,name,...]   (server must be running; use a spare port, never 4600)

if (process.env.ABCODE_VISUAL !== '1') {
  console.log('Skipped: set ABCODE_VISUAL=1 to run this script (it needs a running server and a browser).');
  process.exit(0);
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// puppeteer-core is an optional development dependency (npm i --no-save puppeteer-core).
// CHROME_PATH points at a Chrome or Chromium executable.
const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error('Set CHROME_PATH to a Chrome or Chromium executable.');
const { default: puppeteer } = await import('puppeteer-core');

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'photos');
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[2] || '4611';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const base = `http://127.0.0.1:${port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
const problems = [];

async function scene(name, { width = 1440, height = 900, scheme = 'light', hash, wait = 2500, run }) {
  if (only && !only.includes(name)) return;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${name}: console ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await page.goto(base + hash, { waitUntil: 'load' });
  await sleep(wait);
  if (run) await run(page);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('shot', name);
  await ctx.close();
}

const click = async (page, text, sel = 'button, a, label, [role=tab]') => {
  const handle = await page.evaluateHandle((t, s) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t) && e.offsetParent !== null), text, sel);
  const el = handle.asElement();
  if (!el) throw new Error(`no element "${text}"`);
  await el.click();
};

await scene('01-live-phone', { hash: '#/b/example/g/button-style?o=filled&v=phone&m=live&l=one' });
await scene('02-photos-side-phone', { hash: '#/b/example/g/button-style?o=filled&v=phone&m=shots&l=side&s=' + encodeURIComponent('Pointer over it') });
await scene('04-summary', { hash: '#/b/example/summary', wait: 800 });
await scene('05-example-dead', { hash: '#/b/example/g/button-style?o=filled&m=live', wait: 1500 });
await scene('06-help', { hash: '#/b/example/g/button-style?o=filled&v=phone&m=live', wait: 2000, run: async (page) => { await page.keyboard.press('?'); await sleep(300); } });
await scene('07-dark-photos', { scheme: 'dark', hash: '#/b/example/g/button-style?o=outline&m=shots&v=desktop&l=one', wait: 800 });
await scene('08-narrow-drawer', {
  width: 1100,
  height: 800,
  hash: '#/b/example/g/button-style?o=outline&v=phone&m=live',
  wait: 2500,
  run: async (page) => { await click(page, 'Details and notes'); await sleep(500); },
});
await scene('09-example-side-live', { hash: '#/b/example/g/button-style?o=filled&v=phone&m=live&l=side', wait: 4000 });
await scene('10-desktop-live', { hash: '#/b/example/g/button-style?o=outline&v=desktop&m=live&l=one', wait: 2500 });
await scene('11-example-photos', { hash: '#/b/example/g/button-style?o=filled&m=shots&v=both&l=side', wait: 800 });
await scene('12-narrow-live', { width: 1100, height: 800, hash: '#/b/example/g/button-style?o=filled&v=desktop&m=live', wait: 2500 });

await scene('13-summary-example', { hash: '#/b/example/summary', wait: 800 });
await scene('14-example-photos-both-dark', { scheme: 'dark', hash: '#/b/example/g/empty-state?m=shots&v=phone&l=side', wait: 800 });

await browser.close();
if (problems.length) { console.log('PROBLEMS'); problems.forEach((p) => console.log(' ', p)); }
