// Run with a local Vite server. Set PLAYWRIGHT_MODULE if using a bundled Playwright installation.
// Only external services are fixtures; navigation, storage, chat UI, and itinerary generation run normally.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
const attractions = Array.from({ length: 18 }, (_, i) => ({ name: `History Sight ${i + 1}`, category: 'Architecture', description: `Prague landmark ${i + 1}.`, typical_visit_duration_minutes: 60, why_visit: 'History', lat: 50.087 + i * 0.001, lon: 14.421 + i * 0.001 }));
let activePage;
async function setup() {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  activePage = page;
  const errors = [];
  const emails = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const json = data => route.fulfill({ json: data });
    if (url.hostname === 'api.emailjs.com') {
      emails.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, body: 'OK' });
    }
    if (url.hostname === 'api.open-meteo.com') {
      const time = Array.from({ length: 16 }, (_, i) => {
        const date = new Date(); date.setDate(date.getDate() + i);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      });
      return json({ daily: { time, weather_code: time.map(() => 0), temperature_2m_max: time.map((_, i) => 25 + i), temperature_2m_min: time.map(() => 12) } });
    }
    if (url.pathname === '/api/deepseek/trip-chat') {
      const { current } = route.request().postDataJSON();
      return json({ intent: 'other', assistantMessage: 'How many days?', data: { ...current, destination: 'Prague' }, complete: false, missing: ['tripLength'] });
    }
    if (url.pathname === '/api/deepseek/attractions') return json({ attractions });
    if (url.origin === base) return route.continue();
    if (url.hostname.includes('nominatim')) return json(url.pathname.includes('reverse') ? { display_name: 'History Hotel, Prague' } : [{ lat: '50.087', lon: '14.421', name: 'Prague', display_name: 'Prague, Czechia', type: 'city', address: { city: 'Prague' } }]);
    if (url.hostname.includes('photon')) return json({ features: [{ geometry: { coordinates: [14.421, 50.087] }, properties: { name: url.pathname.includes('reverse') ? 'History Hotel' : url.searchParams.get('q'), city: 'Prague', osm_key: 'tourism', osm_value: 'museum', type: 'city' } }] });
    if (url.hostname.includes('geoapify')) return json({ features: [] });
    if (url.hostname.includes('overpass')) return json({ elements: [] });
    if (url.hostname.includes('osrm')) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return json({ routes: [{ distance: 1000, duration: 180 }] }).catch(() => {});
    }
    if (url.hostname.includes('wikidata')) return json({ results: { bindings: [] }, entities: {} });
    if (url.hostname.includes('wikipedia') || url.hostname.includes('wikimedia') || url.hostname.includes('wikivoyage')) return json({ query: { pages: [] }, parse: { wikitext: { '*': '' } } });
    if (url.hostname.includes('openverse')) return json({ results: [] });
    if (url.hostname.includes('pexels')) return json({ photos: [] });
    return route.abort();
  });
  await page.goto(base);
  return { page, context, errors, emails };
}
async function step(page, expected) {
  await page.waitForFunction(expected => history.state?.step === expected, expected);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => history.state.step), expected);
}
async function back(page, expected) { await page.goBack(); await step(page, expected); console.log(`Back -> ${expected}`); }
async function forward(page, expected) { await page.goForward(); await step(page, expected); }
async function state(page) {
  return page.evaluate(() => ({ app: JSON.parse(sessionStorage.getItem('travel-agent-app-v1')), question: JSON.parse(sessionStorage.getItem('travel-agent-questions-v1')), trip: JSON.parse(sessionStorage.getItem('travel-agent-trip-v1')) }));
}
async function answer(page, text) {
  await page.getByRole('textbox', { name: 'Your answer' }).fill(text);
  await page.getByRole('button', { name: 'Send answer' }).click();
  await page.waitForTimeout(150);
}
try {
  const { page, context, errors, emails } = await setup();
  await page.getByRole('button', { name: 'I know where', exact: true }).click();
  await step(page, 'chat');
  await page.getByRole('textbox', { name: 'Your answer' }).fill('Prague');
  await page.reload();
  await step(page, 'chat');
  assert.equal(await page.getByRole('textbox', { name: 'Your answer' }).inputValue(), 'Prague');
  await answer(page, 'Prague');
  await answer(page, '4');
  await answer(page, 'yes');
  await answer(page, '50.087, 14.421');
  await page.getByRole('button', { name: 'Yes', exact: true }).waitFor();
  await page.reload();
  await step(page, 'chat');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByText('What exact date would you like to start your trip?', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Ready to choose places' }).count(), 0);
  await page.reload();
  await step(page, 'chat');
  await answer(page, 'tomorrow');
  await page.getByRole('button', { name: 'Ready to choose places' }).click();
  await step(page, 'places');
  await page.getByRole('button', { name: 'History Sight 1 Architecture', exact: false }).first().waitFor();
  const cards = page.locator('.place-pick-card').filter({ hasText: 'History Sight' });
  await cards.nth(0).getByRole('button', { name: 'Add', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: 'Add', exact: true }).click();
  const selection = (await state(page)).question.selectedPlaces;
  assert.equal(selection.length, 2);
  const detailButton = cards.nth(8).locator('.place-pick-open');
  await detailButton.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const scroll = await page.evaluate(() => scrollY);
  assert(scroll > 200);
  await detailButton.click();
  await step(page, 'place-detail');
  const detailName = (await state(page)).question.viewingPlace.name;
  await page.reload();
  await step(page, 'place-detail');
  assert.equal((await state(page)).question.viewingPlace.name, detailName);
  await back(page, 'places');
  await page.waitForFunction(y => Math.abs(scrollY - y) < 3, scroll);
  assert.deepEqual((await state(page)).question.selectedPlaces, selection);
  await forward(page, 'place-detail');
  await page.getByRole('button', { name: 'Back to places', exact: true }).click();
  await step(page, 'places');
  await page.getByRole('button', { name: 'Organize by day', exact: true }).click();
  await step(page, 'processing');
  await page.reload();
  await step(page, 'itinerary');
  await page.getByRole('heading', { name: '4-day plan in Prague' }).waitFor();
  const generated = (await state(page)).app.output;
  assert.equal(generated.itinerary.length, 4);
  assert.equal((await state(page)).app.input.dates_flexible, false);
  assert.equal(generated.itinerary[0].weather.maxTemp, 26);
  assert.equal(generated.itinerary[3].weather.maxTemp, 29);
  assert.equal(await page.locator('.day-weather').count(), 4);
  assert.match(await page.locator('.day-weather').first().innerText(), /Clear sky.*12 to 26°C/s);
  assert.equal((await state(page)).app.input.accommodation.address.includes('History Hotel'), true);
  await page.reload();
  await step(page, 'itinerary');
  assert.deepEqual((await state(page)).app.output, generated);
  await page.locator('.cluster-place-card .breakfast-card-cta').first().click();
  await step(page, 'itinerary-detail');
  await page.reload();
  await step(page, 'itinerary-detail');
  await back(page, 'itinerary');
  await page.locator('.cluster-place-remove').first().click();
  await page.waitForTimeout(100);
  const draftItinerary = (await state(page)).trip.itinerary;
  assert.equal((await state(page)).trip.dirty, true);
  await page.reload();
  await step(page, 'itinerary');
  assert.deepEqual((await state(page)).trip.itinerary, draftItinerary);
  assert.equal((await state(page)).trip.dirty, true);
  await back(page, 'places');
  assert.deepEqual((await state(page)).question.selectedPlaces, selection);
  await back(page, 'chat');
  const restored = await state(page);
  assert.equal(restored.question.chatState.data.destination, 'Prague');
  assert.equal(restored.question.chatState.data.tripLength.days, 4);
  assert(restored.question.chatState.data.accommodation.address.includes('History Hotel'));
  assert.deepEqual(restored.app.output, generated);
  await page.reload();
  await step(page, 'chat');
  await page.getByRole('button', { name: 'Ready to choose places' }).waitFor();
  await back(page, 'home');
  await forward(page, 'chat');
  await forward(page, 'places');
  await forward(page, 'itinerary');
  assert.deepEqual((await state(page)).app.output, generated);
  assert.deepEqual((await state(page)).trip.itinerary, draftItinerary);
  await page.getByRole('button', { name: 'Send plan to email', exact: true }).click();
  await page.locator('#trip-email').fill('history-test@example.test');
  await page.locator('.cluster-email-modal').getByRole('button', { name: 'Send plan to email', exact: true }).click();
  await page.getByText('Plan sent!', { exact: true }).waitFor();
  await step(page, 'home');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].template_params.to_email, 'history-test@example.test');
  assert(emails[0].template_params.trip_html.includes(generated.itinerary[0].date));
  assert.deepEqual(errors, []);
  console.log('PASS dates/weather/email: dates asked after hotel confirmation, exact dates preserved, each forecast matches its day, mocked email succeeds and returns home.');
  console.log('PASS chat flow: home/chat/places/details/itinerary, Back, Forward, refresh, list scroll, destination/days/hotel/picks/itinerary preserved.');
  await context.close();

  const flexible = await setup();
  await flexible.page.getByRole('button', { name: 'I know where', exact: true }).click();
  await answer(flexible.page, 'Prague');
  await answer(flexible.page, '4');
  await answer(flexible.page, 'no');
  await flexible.page.getByText('What exact date would you like to start your trip?', { exact: true }).waitFor();
  assert.equal(await flexible.page.getByRole('button', { name: 'Ready to choose places' }).count(), 0);
  await answer(flexible.page, "I don't know");
  await flexible.page.getByRole('button', { name: 'Ready to choose places' }).waitFor();
  assert.equal((await state(flexible.page)).question.chatState.data.datesStatus, 'flexible');
  await flexible.page.getByRole('button', { name: 'Ready to choose places' }).click();
  await step(flexible.page, 'places');
  await flexible.page.locator('.place-pick-card').filter({ hasText: 'History Sight' }).first().getByRole('button', { name: 'Add', exact: true }).click();
  await flexible.page.getByRole('button', { name: 'Organize by day', exact: true }).click();
  await step(flexible.page, 'itinerary');
  assert.equal(await flexible.page.getByText('Add exact travel dates to see a forecast.', { exact: true }).count(), 1);
  assert.equal(await flexible.page.locator('.day-weather').count(), 0);
  assert.equal(await flexible.page.getByRole('button', { name: 'Commit', exact: true }).count(), 0);
  const beforeDates = (await state(flexible.page)).trip.itinerary;
  await flexible.page.getByRole('button', { name: 'Add dates', exact: true }).click();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const startDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await flexible.page.getByLabel('Trip start date', { exact: true }).fill(startDate);
  await flexible.page.getByRole('button', { name: 'Save dates', exact: true }).click();
  await flexible.page.waitForFunction(() => JSON.parse(sessionStorage.getItem('travel-agent-app-v1')).output.itinerary[0].weather?.maxTemp === 26);
  await flexible.page.reload();
  await step(flexible.page, 'itinerary');
  const afterDates = await state(flexible.page);
  assert.equal(afterDates.app.input.start_date, startDate);
  assert.equal(afterDates.app.input.dates_flexible, false);
  assert.deepEqual(afterDates.trip.itinerary.map(day => day.stops), beforeDates.map(day => day.stops));
  assert.equal(await flexible.page.locator('.day-weather').count(), 4);
  console.log('PASS header dates: one prompt, no Commit button, dates and forecasts save without changing stops and survive refresh.');
  assert.deepEqual(flexible.errors, []);
  console.log('PASS flexible dates: declining accommodation still asks dates; declining dates allows continuation.');
  await flexible.context.close();

  const form = await setup();
  await form.page.getByRole('button', { name: 'I know where', exact: true }).click();
  await step(form.page, 'chat');
  await form.page.getByRole('button', { name: 'Prefer to fill out a form?' }).click();
  await step(form.page, 'destination');
  await form.page.getByLabel('Destination', { exact: true }).fill('Prague');
  await form.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await step(form.page, 'days');
  await form.page.getByLabel('Trip length').fill('5');
  await form.page.reload();
  await step(form.page, 'days');
  assert.equal(await form.page.getByLabel('Trip length').inputValue(), '5');
  await form.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await step(form.page, 'hotel');
  await form.page.getByRole('button', { name: 'Not booked yet', exact: true }).click();
  await step(form.page, 'places');
  await form.page.locator('.place-pick-add-btn').first().click();
  await form.page.getByRole('button', { name: 'Organize by day', exact: true }).click();
  await step(form.page, 'itinerary');
  for (const expected of ['places', 'hotel', 'days', 'destination', 'chat', 'home']) {
    await back(form.page, expected);
    if (expected === 'days') assert.equal(await form.page.getByLabel('Trip length').inputValue(), '5');
    if (expected === 'destination') assert.equal(await form.page.getByLabel('Destination', { exact: true }).inputValue(), 'Prague');
  }
  for (const expected of ['chat', 'destination', 'days', 'hotel', 'places', 'itinerary']) await forward(form.page, expected);
  assert.equal((await state(form.page)).app.input.trip_length_days, 5);
  // Simulate upgrading a saved trip created before history support.
  await form.page.evaluate(() => history.replaceState(null, ''));
  await form.page.reload();
  await step(form.page, 'itinerary');
  await back(form.page, 'places');
  await back(form.page, 'hotel');
  await forward(form.page, 'places');
  await forward(form.page, 'itinerary');
  assert.equal((await state(form.page)).app.input.trip_length_days, 5);
  assert.deepEqual(form.errors, []);
  console.log('PASS form flow: each step traverses independently in both directions without losing answers.');
  await form.context.close();

  const suggestions = await setup();
  await suggestions.page.getByRole('button', { name: 'Show me options', exact: true }).click();
  await step(suggestions.page, 'destinations');
  await suggestions.page.locator('.dest-card').filter({ hasText: 'Prague' }).click();
  await step(suggestions.page, 'destination-preview');
  await suggestions.page.locator('.dest-highlight-card').first().click();
  await step(suggestions.page, 'destination-detail');
  await suggestions.page.reload();
  await step(suggestions.page, 'destination-detail');
  await back(suggestions.page, 'destination-preview');
  await back(suggestions.page, 'destinations');
  await back(suggestions.page, 'home');
  await forward(suggestions.page, 'destinations');
  await forward(suggestions.page, 'destination-preview');
  await forward(suggestions.page, 'destination-detail');
  await suggestions.page.getByRole('button', { name: /Start planning/ }).first().click();
  await step(suggestions.page, 'chat');
  assert.equal((await state(suggestions.page)).question.city, 'Prague');
  await back(suggestions.page, 'destination-detail');
  await forward(suggestions.page, 'chat');
  assert.deepEqual(suggestions.errors, []);
  console.log('PASS suggestions flow: city preview and place detail each have restorable history entries.');
  await suggestions.context.close();
} catch (error) {
  console.error('Failure context:', await activePage.evaluate(() => ({ step: history.state?.step, scrollY, savedScroll: history.state?.scrollY, title: document.querySelector('h1,h2')?.textContent })));
  throw error;
} finally { await browser.close(); }
