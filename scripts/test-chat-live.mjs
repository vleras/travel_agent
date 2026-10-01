// Explicit opt-in live API check. Requires the local Vite server and its .env.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

async function loadTypeScript(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { extractTripChat } = await loadTypeScript('../src/services/tripChatExtraction.ts');
const { parseLocationInput } = await loadTypeScript('../src/services/parseLocation.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = (url, options) => realFetch(new URL(url, 'http://127.0.0.1:5173'), options);
const current = {
  destination: 'Matka', tripLength: { days: 4, range: null, flexible: false },
  hasAccommodation: true, accommodationQuery: 'Old hotel', accommodation: null,
  accommodationPreference: 'Old area', interests: [], budget: null,
  travelDates: null, extraPreferences: ['Old destination note'],
};
const cases = [
  ['i want to change place, i want to go to Essen, Germany', 'change_destination'],
  ['actually make it 5 days', 'change_days'],
  ["I haven't booked yet", 'skip_hotel'],
  ['Hotel Essener Hof, Essen', 'hotel_answer'],
  ['51.4556, 7.0116', 'hotel_answer'],
];
let failures = 0;
for (const [message, expected] of cases) {
  try {
    // The final two cases are a separate Essen scenario. Coordinates are sent
    // to DeepSeek for this diagnostic only; the UI normally bypasses it.
    const state = expected === 'hotel_answer' ? { ...current, destination: 'Essen, Germany' } : current;
    const result = await extractTripChat([
      { role: 'assistant', content: 'What’s the name or address of your hotel?' },
      { role: 'user', content: message },
    ], state);
    console.log(JSON.stringify({ message, returnedIntent: result.intent, extractedHotel: result.hotelName, area: result.area }));
    assert.equal(result.intent, expected);
    let action;
    if (expected === 'change_destination') {
      assert.match(result.data.destination, /Essen/i);
      assert.equal(result.data.tripLength.days, 4);
      assert.equal(result.data.accommodationQuery, null);
      assert.equal(result.data.hasAccommodation, null);
      assert.deepEqual(result.data.extraPreferences, []);
      action = 'Extraction switched to Essen, retained 4 days, cleared hotel and city-specific data; UI verifies city before applying.';
    } else if (expected === 'change_days') {
      assert.equal(result.data.tripLength.days, 5);
      assert.equal(result.data.destination, current.destination);
      assert.equal(result.data.accommodationQuery, current.accommodationQuery);
      action = 'Updated to 5 days; kept destination and hotel data.';
    } else if (expected === 'skip_hotel') {
      assert.equal(result.data.hasAccommodation, false);
      assert.equal(result.data.accommodationQuery, null);
      assert.equal(result.complete, true);
      action = 'Cleared hotel and marked trip ready without accommodation.';
    } else if (message.startsWith('51.')) {
      assert.deepEqual(await parseLocationInput(message), { kind: 'coords', lat: 51.4556, lon: 7.0116 });
      action = 'Coordinate parser returned exact pin; UI bypasses DeepSeek, checks distance from Essen, then requests confirmation.';
    } else {
      assert.match(result.data.accommodationQuery, /Essener Hof/i);
      assert.equal(result.data.accommodation, null);
      assert.equal(result.complete, false);
      action = `Queued hotel verification for ${result.data.accommodationQuery}.`;
    }
    console.log(JSON.stringify({ status: 'PASS', action }));
  } catch (error) {
    failures++;
    console.log(JSON.stringify({ message, status: 'FAIL', error: error.message }));
  }
}
console.log(`${cases.length - failures}/${cases.length} live intent/state checks passed.`);
process.exitCode = failures ? 1 : 0;
