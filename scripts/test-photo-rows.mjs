// Requires a running Vite server and Playwright. All photo lookups/images are fixtures.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
const base = process.env.TEST_BASE_URL || 'http://localhost:5173';
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', error => console.error(error.message));
  await page.clock.install();
  await page.route('**/src/services/placePhotos.ts', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const CARD_PHOTOS = 3;
    window.started = []; window.finish = {}; window.fail = {};
    export function fetchPlacePhotoUrls(name) {
      window.started.push(Number(name));
      return new Promise((resolve, reject) => { window.finish[name] = () => resolve(['data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="teal"/></svg>')]); window.fail[name] = reject; });
    }
  ` }));
  await page.route('**/__photo-rows-test', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="/src/styles/questions.css" /></head><body>
    <div id="root" class="question-card--places"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { OrderedPhotoGrid } from '/src/components/shared/OrderedPhotoGrid.tsx';
      import { PlaceImage } from '/src/components/shared/PlaceImage.tsx';
      const root = ReactDOM.createRoot(document.getElementById('root'));
      window.show = key => root.render(React.createElement(OrderedPhotoGrid, {key, count: 9}, props => Array.from({length: 9}, (_, index) => React.createElement(PlaceImage, {...props(index), key: index, name: String(index), className: 'place-pick-photo'}))));
      window.show('all');
    </script></body></html>
  ` }));
  const started = () => page.evaluate(() => window.started);
  const finish = indices => page.evaluate(indices => indices.forEach(i => window.finish[i]()), indices);
  const waitCount = count => page.waitForFunction(count => window.started?.length === count, count);
  await page.goto(`${base}/__photo-rows-test`);
  await waitCount(4);
  assert.deepEqual(await started(), [0, 1, 2, 3]);
  await finish([0, 1, 2]);
  await page.waitForFunction(() => [...document.images].filter(img => img.complete && img.naturalWidth).length === 3);
  assert.equal((await started()).length, 4, 'The next row must wait for every cover');
  await finish([3]);
  await waitCount(8);
  await page.evaluate(() => window.fail[4](new Error('No photo')));
  await finish([5, 6, 7]);
  await waitCount(9);
  await finish([8]);
  console.log('PASS desktop: four covers per row; incomplete rows wait; failed covers do not block the next row.');

  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => { window.started = []; window.show('filtered'); });
  await waitCount(1);
  await finish([0]);
  await waitCount(2);
  assert.deepEqual(await started(), [0, 1]);
  console.log('PASS mobile/filter: one-column rows restart at the first card.');

  await page.clock.fastForward(31000);
  await waitCount(3);
  await finish([1]);
  await page.getByRole('img', { name: '1', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('img[alt="1"]');
    return image?.complete && image.naturalWidth > 0;
  });
  console.log('PASS slow image: next row starts after the wait, and the late photo still appears.');
} finally { await browser.close(); }
