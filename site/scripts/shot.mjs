/**
 * Screenshot tool for checking the site, over the Chrome DevTools Protocol.
 *
 * Why not the browser's own `--screenshot` flag (measured on this machine):
 *   - `URL#section` with `--screenshot` does not scroll to the section. The
 *     picture is taken from the top of the page and looks like a correct one.
 *   - A very tall `--window-size` hangs the process.
 *   - The theme lives in localStorage, so it has to be set from outside.
 *
 * Uses Node's built-in WebSocket, so there is no puppeteer dependency.
 *
 * Usage:
 *   1) start a headless browser in another terminal:
 *      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
 *        --headless=new --disable-gpu --hide-scrollbars \
 *        --remote-debugging-port=9222 --user-data-dir=/tmp/edge-shot
 *   2) node scripts/shot.mjs <url> <out.png> [width] [theme] [#selector]
 *
 * Examples:
 *   node scripts/shot.mjs http://localhost:4321/helsa/ /tmp/home.png 1440 dark
 *   node scripts/shot.mjs http://localhost:4321/helsa/ /tmp/home-sm.png 390 light
 *   node scripts/shot.mjs http://localhost:4321/helsa/api/ /tmp/docs.png 1440 dark "#_top"
 */
import { writeFileSync } from 'node:fs';

const [url, out, widthArg = '1440', theme, selector] = process.argv.slice(2);

if (!url || !out) {
  console.error('Usage: node scripts/shot.mjs <url> <out.png> [width] [theme] [#selector]');
  process.exit(1);
}

const width = Number(widthArg);

const target = await (
  await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })
).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));

let nextId = 0;
const pending = new Map();

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // Print console errors: a blank page explains itself here rather than by guesswork.
  if (message.method === 'Runtime.exceptionThrown') {
    console.error('EXCEPTION', JSON.stringify(message.params.exceptionDetails).slice(0, 600));
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    console.error('CONSOLE ERROR', message.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
};

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: width < 500,
});

await send('Page.navigate', { url });
await sleep(1800);

// Both shells read the theme from this one key; see src/layouts/BaseLayout.astro.
if (theme) {
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('starlight-theme', ${JSON.stringify(theme)}); location.reload()`,
  });
  await sleep(2000);
}

let clip;
if (selector) {
  await send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior:'instant',block:'start'})`,
  });
  await sleep(700);
} else {
  const metrics = await send('Page.getLayoutMetrics');
  const size = metrics.cssContentSize ?? metrics.contentSize;
  clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 30000), scale: 1 };
}

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  ...(clip ? { clip, captureBeyondViewport: true } : {}),
});

writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`${out} written`);

ws.close();
process.exit(0);
