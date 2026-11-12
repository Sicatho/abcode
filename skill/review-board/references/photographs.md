# Photographs for a board

A board shows each option live and, if you add them, as photographs. Live frames are usually enough. Photographs earn their place in two cases:

- **States a live frame cannot show or reach quickly**: a menu that is open, hover, a touch-only layout (a frame always reports a mouse), dark mode, an error or empty state that needs special data, a first visit, the bottom of a long page.
- **A quick blink comparison.** Photographs of the same state share one scroll position across options, so the user can press ← → and see exactly what moved. Live frames of different origins cannot be scrolled in step.

They cost time to make and they go stale when the site changes, so take them last, right before handing the board over, and retake them after every change to the page they show.

## Naming

Use one file per option, state and size, named so that a listing reads like the board:

```
shots/<option id>-<viewport id>-<state>.png
shots/tabs-phone-menu.png
shots/today-desktop-top.png
```

In `board.json`, give the same state the same `label` in every option (`"Top"`, `"Menu open"`, `"Dark"`). The page's "Photograph" chips (and the `[` `]` keys) are built from the labels, so matching labels are what make the blink work. An option without a photograph of that state shows "No photograph of this state for this option", which is fine and honest.

## Sizes

Take each photograph at the CSS size of the board viewport it belongs to (by default desktop 1440x900 and phone 390x844; use the board's own `viewports` if it has them). With the page's Zoom set to "Fit width" (the default), a photograph is shown no wider than its viewport's width, so a picture taken at another width looks like a different design. A device scale factor of 2 gives sharp pictures at the same CSS width; "100%" then shows them at their pixel size, twice as large. Full-page photographs are fine: the stage scrolls, and the scroll position is shared across options.

Use PNG, JPEG (`.jpg` or `.jpeg`), WebP, AVIF, GIF or SVG; those are the picture types the server serves.

## Make before and after comparable

A blink comparison only shows the change if everything else is equal:

- the same account, the same data, the same page and the same scroll position;
- fonts and pictures fully loaded (wait for `document.fonts.ready` and for every `img` to finish);
- animations finished or turned off, carousels on the same slide, the clock and random content held still where you can;
- cookie banners and one-time hints in the same state in both (dismiss them in both, or in neither).

If a difference you did not make shows up between before and after, find out why before putting it on a board. The user will ask.

## A capture script

This script is not part of Review Board. It needs `puppeteer-core` (install it in a scratch folder, for example `npm i --no-save puppeteer-core`, rather than adding it to the project) and a local Chrome or Chromium, given by `CHROME_PATH`. It takes a desktop and a phone photograph of each address, signs in a local test account by cookie, and waits for fonts and pictures.

```js
// shoot.mjs: node shoot.mjs <out folder>
// Needs puppeteer-core and a local Chrome: CHROME_PATH=/path/to/chrome node shoot.mjs shots
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(out, { recursive: true });

// What to photograph: option id, address, state name, and an optional step before the picture.
const origin = 'http://127.0.0.1:5180';
const shots = [
  { option: 'today', url: `${origin}/?nav=`, state: 'top' },
  { option: 'tabs', url: `${origin}/?nav=tabs`, state: 'top' },
  { option: 'tabs', url: `${origin}/?nav=tabs`, state: 'menu', before: (page) => page.click('[data-test=menu-button]') },
];

// Sizes matching the board's viewports. The phone gets touch, so touch-only CSS and code paths apply.
const sizes = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// A local test account's cookie, read from a file the dev tooling wrote. Never a real account.
const accounts = JSON.parse(fs.readFileSync('.dev/accounts.json', 'utf8'));
const value = accounts.accounts.user.cookie.replace(/^app_session=/, '');
const cookie = { name: 'app_session', value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' };

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  for (const [sizeId, viewport] of Object.entries(sizes)) {
    for (const s of shots) {
      const context = await browser.createBrowserContext(); // a clean browser for every photograph
      const page = await context.newPage();
      await page.setViewport(viewport);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      await page.setCookie(cookie);
      await page.goto(s.url, { waitUntil: 'networkidle0' });
      if (s.before) await s.before(page);
      // fonts, then every picture on the page, then two frames for layout to settle
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const file = path.join(out, `${s.option}-${sizeId}-${s.state}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log('wrote', file);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
```

Adjust the cookie name, the file and its path to the project's own test-account file. The cookie's `domain` must be the host name of the site (127.0.0.1). Use `fullPage: true` for a long page, and `prefers-color-scheme: 'dark'` for a dark-mode state. Images loaded lazily below the fold load only once scrolled into view: scroll there before the wait, or photograph only what is on screen.

Then list the files in the option's `shots` under the matching viewport id, with `src` starting with the asset root name (for example `"shots/tabs-phone-menu.png"` with `"assetRoots": { "shots": "shots" }`), and check that they show with `GET /api/boards/<id>` (each shot gets a `url`, a path on the board server) and by opening `http://127.0.0.1:<port>` plus one of those paths. The board does not check that the files exist, so a wrong file name shows only as a broken picture. Photographs are served with `no-cache`, so a retaken picture with the same name appears when the user reloads the page.
