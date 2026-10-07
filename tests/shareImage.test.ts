import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import type { Forecast } from '../src/lib/weather.ts';

// Nur im Testbundle die bestehende Share-Orchestrierung zugänglich machen.
// Produktcode benötigt dafür keine zusätzlichen State-/Test-Exports.
const source = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
const bundle = await build({
  stdin: {
    contents: source + `
      export { state, shareCurrentWeather };
      export { renderWeatherCard, weatherCardTimestamp } from './lib/shareImage';
      export { shareText, shareImage } from './lib/share';
    `,
    resolveDir: new URL('../src/', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
});

const BASE = Date.parse('2026-10-07T12:00:00.000Z');
let clock = BASE;
const originalNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
globalThis.setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
  const timer = originalSetTimeout(callback, ms, ...args);
  pendingTimers.add(timer);
  return timer;
}) as typeof setTimeout;
const originals = Object.fromEntries(['document', 'navigator', 'performance', 'Path2D'].map(key =>
  [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const install = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, value });
Date.now = () => clock;
install('performance', { now: () => clock - BASE });
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function forecast(sourceFetchedAt: string | undefined = new Date(clock).toISOString(), timezone = 'Europe/Berlin'): Forecast {
  return {
    sourceFetchedAt, timezone, yesterdayTempMax: null, hourly: [],
    current: { time: '2030-01-01T09:59', temperature: 18, apparentTemperature: 17, humidity: 64, windSpeed: 12, weatherCode: 2, isDay: false },
    daily: ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].map(date => ({
      date, weatherCode: 0, tempMax: 23, tempMin: 12, precipitationProbabilityMax: 0, sunrise: null, sunset: null, uvIndexMax: 2,
    })),
  };
}
const stamp = (f: Forecast, locale = 'de-DE', lang = 'de', now = clock): string | null =>
  mod.weatherCardTimestamp(f, locale, lang, now);

let draws: Array<{ text: string; x: number; y: number }>;
let shared: any[];
let copied: string[];
let downloads: string[];
let fontsLoad: () => Promise<unknown>;
let blobReady: () => void;
let canvasFails: boolean;
let blobFails: boolean;
let elements: Map<string, any>;
let createdCanvases: any[];
function element() {
  return {
    textContent: '', hidden: false, disabled: false, children: [] as any[],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, querySelector: () => null,
    appendChild(child: any) { this.children.push(child); }, remove() {},
    click() { downloads.push((this as any).download); },
  };
}
before(() => {
  install('Path2D', class {});
});
beforeEach(() => {
  draws = []; shared = []; copied = []; downloads = []; elements = new Map(); createdCanvases = [];
  fontsLoad = async () => []; blobReady = () => {}; canvasFails = false; blobFails = false;
  const ctx = new Proxy({
    fillText(text: string, x: number, y: number) { draws.push({ text, x, y }); },
    measureText: (text: string) => ({ width: text.length * 18 }),
  }, { get(target, key) { return key in target ? (target as any)[key] : () => {}; } });
  install('document', {
    title: '', body: element(),
    fonts: { load: () => fontsLoad(), ready: Promise.resolve() },
    getElementById(id: string) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement(tag: string) {
      if (tag !== 'canvas') return element();
      const canvas = {
        width: 0, height: 0, getContext: () => canvasFails ? null : ctx,
        toBlob(callback: (blob: Blob | null) => void, type: string) {
          blobReady(); callback(blobFails ? null : new Blob(['synthetic canvas double'], { type }));
        },
      };
      createdCanvases.push(canvas); return canvas;
    },
  });
  install('navigator', {
    onLine: true, canShare: () => true,
    share: async (payload: any) => { shared.push(payload); },
    clipboard: { writeText: async (text: string) => { copied.push(text); } },
  });
  mod.state.place = { id: 1, providerId: 1, name: 'Berlin', latitude: 52.52, longitude: 13.405, country: 'Germany', countryCode: 'DE' };
  mod.state.forecast = forecast();
});
after(() => {
  for (const timer of pendingTimers) clearTimeout(timer);
  globalThis.setTimeout = originalSetTimeout;
  Date.now = originalNow;
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
});

test('PNG timestamp uses sourceFetchedAt instead of location.localtime/current.time', () => {
  assert.equal(stamp(forecast()), 'Mittwoch, 07.10. · Datenstand: 14:00');
});
test('share creation time does not replace the data timestamp', () => {
  const f = forecast();
  assert.equal(stamp(f, 'de-DE', 'de', clock + 20 * 60_000), stamp(f));
});
test('a server cache hit preserves the original age and timestamp', () => {
  const f = forecast(new Date(clock - 40 * 60_000).toISOString());
  const original = JSON.stringify(f);
  assert.match(stamp(f)!, /Datenstand: 13:20$/);
  assert.equal(JSON.stringify(f), original);
  assert.equal(stamp(f, 'de-DE', 'de', clock + 20 * 60_000 + 1), null);
});
for (const [age, allowed] of [[15 * 60_000, true], [15 * 60_000 + 1, true], [60 * 60_000, true], [60 * 60_000 + 1, false]] as const) {
  test(`PNG timestamp age boundary ${age} ms, allowed=${allowed}`, () => {
    assert.equal(stamp(forecast(new Date(clock - age).toISOString())) !== null, allowed);
  });
}
test('missing sourceFetchedAt has no current-time fallback', () => {
  const f = forecast(); delete f.sourceFetchedAt; assert.equal(stamp(f), null);
});
test('invalid and unparseable sourceFetchedAt have no fallback', () => {
  for (const source of ['', 'not a timestamp', '2026-99-99T99:99:99Z']) assert.equal(stamp(forecast(source)), null);
});
test('future sourceFetchedAt is rejected', () => {
  assert.equal(stamp(forecast(new Date(clock + 1).toISOString())), null);
});
test('zone-less sourceFetchedAt cannot become a device-time timestamp', () => {
  assert.equal(stamp(forecast('2026-10-07T12:00:00')), null);
});
test('source is formatted in the location zone, including fractional offsets', () => {
  assert.match(stamp(forecast(undefined, 'Asia/Kathmandu'))!, /17:45$/);
  assert.match(stamp(forecast(undefined, 'America/New_York'))!, /08:00$/);
});
test('missing and invalid location zones do not use the device zone', () => {
  assert.equal(stamp(forecast(undefined, '')), null);
  assert.equal(stamp(forecast(undefined, 'invalid/zone')), null);
});
test('DST spring transition follows the absolute source timestamp', () => {
  for (const [source, expected] of [['2026-03-29T00:59:00Z', '01:59'], ['2026-03-29T01:00:00Z', '03:00']]) {
    assert.ok(stamp(forecast(source), 'de-DE', 'de', Date.parse(source))!.endsWith(expected));
  }
});
test('DST autumn transition follows both occurrences of the local hour', () => {
  for (const source of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
    assert.match(stamp(forecast(source), 'de-DE', 'de', Date.parse(source))!, /02:30$/);
  }
});
test('date and data time remain consistent across local midnight', () => {
  const f = forecast('2026-10-07T21:45:00Z');
  assert.equal(stamp(f, 'de-DE', 'de', Date.parse('2026-10-07T22:05:00Z')), 'Mittwoch, 07.10. · Datenstand: 23:45');
});
for (const [lang, locale, label] of [['de', 'de-DE', 'Datenstand:'], ['en', 'en-GB', 'Data as of:'], ['tr', 'tr-TR', 'Veri zamanı:']]) {
  test(`${lang} uses an explicit localized data timestamp label`, () => {
    assert.ok(stamp(forecast(), locale, lang)!.includes(`${label} 14:00`));
  });
}
test('PNG renderer retains dimensions, forecast days and branding', async () => {
  const f = forecast(); const original = JSON.stringify(f);
  const blob = await mod.renderWeatherCard({ name: 'Berlin', forecast: f, locale: 'de-DE', lang: 'de', now: () => clock });
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([createdCanvases[0].width, createdCanvases[0].height], [1080, 1920]);
  assert.equal(draws.find(d => d.y === 296)?.text, 'Mittwoch, 07.10. · Datenstand: 14:00');
  for (const day of ['Do', 'Fr', 'Sa']) assert.ok(draws.some(d => d.text === day));
  for (const brand of ['weather', 'pure', 'weatherpure.com']) assert.ok(draws.some(d => d.text === brand));
  assert.equal(JSON.stringify(f), original);
});
test('invalid source rejects PNG before canvas creation', async () => {
  const f = forecast(); delete f.sourceFetchedAt;
  assert.equal(await mod.renderWeatherCard({ name: 'Berlin', forecast: f, locale: 'de-DE', lang: 'de' }), null);
  assert.equal(createdCanvases.length, 0);
});
test('expiry while loading fonts rejects PNG', async () => {
  const source = new Date(clock).toISOString();
  fontsLoad = async () => { clock += 60 * 60_000 + 1; };
  assert.equal(await mod.renderWeatherCard({ name: 'Berlin', forecast: forecast(source), locale: 'de-DE', lang: 'de', now: () => clock }), null);
  assert.equal(createdCanvases.length, 0);
});
test('expiry during toBlob rejects the completed data copy', async () => {
  const f = forecast(); blobReady = () => { clock += 60 * 60_000 + 1; };
  assert.equal(await mod.renderWeatherCard({ name: 'Berlin', forecast: f, locale: 'de-DE', lang: 'de', now: () => clock }), null);
});
test('shareflow shares an image with the existing text and city link', async () => {
  await mod.shareCurrentWeather();
  assert.equal(shared.length, 1); assert.equal(shared[0].files[0].type, 'image/png');
  assert.equal(shared[0].text, 'Berlin: 18°, Teilweise bewölkt');
  assert.equal(shared[0].url, 'https://weatherpure.com/?stadt=Berlin&placeId=1');
  assert.equal(elements.get('shareBtn').disabled, false);
});
test('PNG context error retains native text fallback', async () => {
  canvasFails = true; await mod.shareCurrentWeather();
  assert.equal(shared.length, 1); assert.equal(shared[0].files, undefined);
});
test('PNG blob failure retains native text fallback', async () => {
  blobFails = true; await mod.shareCurrentWeather();
  assert.equal(shared.length, 1); assert.equal(shared[0].files, undefined);
});
test('invalid location zone retains safe text fallback with valid source', async () => {
  mod.state.forecast.timezone = ''; await mod.shareCurrentWeather();
  assert.equal(shared.length, 1); assert.equal(shared[0].files, undefined);
});
test('text-only capability skips canvas creation', async () => {
  (navigator as any).canShare = () => false;
  await mod.shareCurrentWeather(); assert.equal(shared.length, 1); assert.equal(createdCanvases.length, 0);
});
test('missing native sharing retains clipboard fallback', async () => {
  (navigator as any).share = undefined;
  await mod.shareCurrentWeather(); assert.equal(copied.length, 1); assert.match(copied[0], /Berlin: 18°/);
});
test('image errors retain retry without URL and image download fallback', async () => {
  (navigator as any).share = async (payload: any) => { shared.push(payload); throw new Error('share failed'); };
  await mod.shareCurrentWeather();
  assert.equal(shared.length, 2); assert.ok(shared[0].url); assert.equal(shared[1].url, undefined);
  assert.deepEqual(downloads, ['weatherpure.png']);
});
test('user cancellation does not retry or download', async () => {
  (navigator as any).share = async (payload: any) => { shared.push(payload); throw new DOMException('cancel', 'AbortError'); };
  await mod.shareCurrentWeather(); assert.equal(shared.length, 1); assert.equal(downloads.length, 0); assert.equal(copied.length, 0);
});
test('text sharing errors retain clipboard fallback', async () => {
  (navigator as any).canShare = () => false;
  (navigator as any).share = async () => { throw new Error('share failed'); };
  await mod.shareCurrentWeather(); assert.equal(copied.length, 1);
});
test('geolocation sharing preserves canonical URL and hides coordinates', async () => {
  mod.state.place.id = -1;
  await mod.shareCurrentWeather(); assert.equal(shared[0].url, 'https://weatherpure.com/');
  assert.match(shared[0].text, /^Mein Standort:/); assert.ok(draws.some(d => d.text === 'Mein Standort'));
  assert.ok(!JSON.stringify(shared[0]).includes('52.52'));
});
for (const age of [15 * 60_000, 15 * 60_000 + 1, 60 * 60_000]) {
  test(`shareflow accepts original data age ${age} ms`, async () => {
    mod.state.forecast = forecast(new Date(clock - age).toISOString());
    await mod.shareCurrentWeather(); assert.equal(shared.length, 1);
  });
}
for (const source of ['expired', 'missing', 'invalid', 'future']) {
  test(`shareflow rejects ${source} source for image and text`, async () => {
    const f = forecast();
    if (source === 'expired') f.sourceFetchedAt = new Date(clock - 60 * 60_000 - 1).toISOString();
    if (source === 'missing') delete f.sourceFetchedAt;
    if (source === 'invalid') f.sourceFetchedAt = 'invalid';
    if (source === 'future') f.sourceFetchedAt = new Date(clock + 1).toISOString();
    mod.state.forecast = f; await mod.shareCurrentWeather();
    assert.equal(shared.length, 0); assert.equal(copied.length, 0); assert.equal(createdCanvases.length, 0);
  });
}
test('expiry during PNG creation also blocks the text fallback', async () => {
  blobReady = () => { clock += 60 * 60_000 + 1; };
  await mod.shareCurrentWeather();
  assert.equal(shared.length, 0); assert.equal(copied.length, 0); assert.equal(downloads.length, 0);
  assert.equal(elements.get('shareBtn').disabled, false);
});
test('real-file capability rejection retains native text fallback', async () => {
  (navigator as any).canShare = ({ files }: { files: File[] }) => files[0].size === 1;
  await mod.shareCurrentWeather();
  assert.equal(createdCanvases.length, 1); assert.equal(shared.length, 1); assert.equal(shared[0].files, undefined);
});
test('cancellation of the second image attempt does not download', async () => {
  (navigator as any).share = async (payload: any) => {
    shared.push(payload);
    throw shared.length === 1 ? new Error('reject URL') : new DOMException('cancel', 'AbortError');
  };
  await mod.shareCurrentWeather(); assert.equal(shared.length, 2); assert.equal(downloads.length, 0);
});
test('text cancellation remains silent without clipboard fallback', async () => {
  (navigator as any).canShare = () => false;
  (navigator as any).share = async () => { throw new DOMException('cancel', 'AbortError'); };
  await mod.shareCurrentWeather(); assert.equal(copied.length, 0);
});
test('unsupported sharing reports failure without generating PNG', async () => {
  (navigator as any).share = undefined; (navigator as any).clipboard = undefined;
  await mod.shareCurrentWeather(); assert.equal(createdCanvases.length, 0); assert.equal(shared.length, 0);
  assert.equal(elements.get('wpToast').children.at(-1).textContent, 'Teilen ist hier nicht möglich');
});
test('clipboard rejection retains the existing failure feedback', async () => {
  (navigator as any).share = undefined;
  (navigator as any).clipboard.writeText = async () => { throw new Error('clipboard unavailable'); };
  await mod.shareCurrentWeather();
  assert.equal(elements.get('wpToast').children.at(-1).textContent, 'Teilen ist hier nicht möglich');
});
test('expiry in the first native image dialog prevents another attempt', async () => {
  (navigator as any).share = async (payload: any) => {
    shared.push(payload); clock += 60 * 60_000 + 1; throw new Error('share failed');
  };
  await mod.shareCurrentWeather();
  assert.equal(shared.length, 1); assert.equal(downloads.length, 0); assert.equal(copied.length, 0);
});
test('expiry in the second native image dialog prevents image download', async () => {
  (navigator as any).share = async (payload: any) => {
    shared.push(payload); if (shared.length === 2) clock += 60 * 60_000 + 1;
    throw new Error('share failed');
  };
  await mod.shareCurrentWeather(); assert.equal(shared.length, 2); assert.equal(downloads.length, 0);
});
test('expiry in a native text dialog prevents clipboard fallback', async () => {
  (navigator as any).canShare = () => false;
  (navigator as any).share = async () => { clock += 60 * 60_000 + 1; throw new Error('share failed'); };
  await mod.shareCurrentWeather(); assert.equal(copied.length, 0);
});
