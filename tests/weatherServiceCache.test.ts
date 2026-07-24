import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { blockUnexpectedNetwork, loadBundledModule } from './testHarness.ts';

interface ServiceModule {
  WeatherService: {
    getForecast(latitude: number, longitude: number): Promise<unknown>;
    getPollen(latitude: number, longitude: number): Promise<unknown>;
    searchPlaces(query: string, language: string): Promise<unknown[]>;
    getCurrentBatch(places: Array<{ id: number; latitude: number; longitude: number }>): Promise<Map<number, unknown>>;
  };
  weatherApiProvider: {
    getForecast(latitude: number, longitude: number): Promise<unknown>;
    getPollen(latitude: number, longitude: number): Promise<unknown>;
    searchPlaces(query: string, language: string): Promise<unknown[]>;
    getCurrentBatch(places: Array<{ id: number; latitude: number; longitude: number }>): Promise<Map<number, unknown>>;
  };
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  getOrSet<T>(key: string, ttlMs: number, load: () => Promise<T>, shouldCache?: (value: T) => boolean): Promise<T>;
  buildCacheKey(providerId: string, parts: Array<string | number>): string;
}

const service = await loadBundledModule<ServiceModule>(`
  export { WeatherService } from './src/server/weather/WeatherService.ts';
  export { weatherApiProvider } from './src/server/weather/providers/WeatherApiProvider.ts';
  export { get, set, getOrSet, buildCacheKey } from './src/server/weather/cache.ts';
`);

const originalProvider = {
  getForecast: service.weatherApiProvider.getForecast,
  getPollen: service.weatherApiProvider.getPollen,
  searchPlaces: service.weatherApiProvider.searchPlaces,
  getCurrentBatch: service.weatherApiProvider.getCurrentBatch,
};
const originalDateNow = Date.now;
let restoreNetwork: () => void;

beforeEach(() => {
  restoreNetwork = blockUnexpectedNetwork();
});

afterEach(() => {
  Object.assign(service.weatherApiProvider, originalProvider);
  Date.now = originalDateNow;
  restoreNetwork();
});

test('cache reports a miss, reuses a fresh value and expires at the real boundary', async () => {
  let now = 1_000_000;
  Date.now = () => now;
  let loads = 0;
  const key = 'test:cache:expiry';
  const load = async () => ({ sequence: ++loads });

  const first = await service.getOrSet(key, 1_000, load);
  const cached = await service.getOrSet(key, 1_000, load);
  now += 1_000;
  const expired = await service.getOrSet(key, 1_000, load);

  assert.deepEqual(first, { sequence: 1 });
  assert.strictEqual(cached, first);
  assert.deepEqual(expired, { sequence: 2 });
  assert.equal(loads, 2);
});

test('cache deduplicates concurrent misses on the same key', async () => {
  let loads = 0;
  const key = 'test:cache:inflight';
  let release!: (value: string) => void;
  const gate = new Promise<string>((resolve) => { release = resolve; });
  const loader = () => { loads++; return gate; };

  const first = service.getOrSet(key, 10_000, loader);
  const second = service.getOrSet(key, 10_000, loader);
  release('shared');

  assert.equal(await first, 'shared');
  assert.equal(await second, 'shared');
  assert.equal(loads, 1);
  assert.equal(await service.getOrSet(key, 10_000, loader), 'shared');
  assert.equal(loads, 1);
});

test('cache shares an in-flight rejection but loads fresh afterwards', async () => {
  let attempts = 0;
  const key = 'test:cache:inflight-reject';
  let fail!: (error: Error) => void;
  const gate = new Promise<string>((_resolve, reject) => { fail = reject; });
  const loader = async () => {
    attempts++;
    return attempts === 1 ? gate : 'recovered';
  };

  const first = service.getOrSet(key, 10_000, loader);
  const second = service.getOrSet(key, 10_000, loader);
  fail(new Error('temporary in-flight failure'));

  await assert.rejects(first, /temporary in-flight failure/);
  await assert.rejects(second, /temporary in-flight failure/);
  assert.equal(await service.getOrSet(key, 10_000, loader), 'recovered');
  assert.equal(attempts, 2);
});

test('cache keeps different keys and parameters isolated', () => {
  Date.now = () => 2_000_000;
  const firstKey = service.buildCacheKey('WEATHER_API', ['forecast', 48.1, 10.1]);
  const secondKey = service.buildCacheKey('WEATHER_API', ['forecast', 48.2, 10.1]);

  service.set(firstKey, { city: 'first' }, 10_000);
  service.set(secondKey, { city: 'second' }, 10_000);

  assert.deepEqual(service.get(firstKey), { city: 'first' });
  assert.deepEqual(service.get(secondKey), { city: 'second' });
});

test('cache never stores thrown loader errors', async () => {
  let attempts = 0;
  const key = 'test:cache:throw';
  const loader = async () => {
    attempts++;
    if (attempts === 1) throw new Error('temporary provider failure');
    return 'recovered';
  };

  await assert.rejects(service.getOrSet(key, 10_000, loader), /temporary provider failure/);
  assert.equal(await service.getOrSet(key, 10_000, loader), 'recovered');
  assert.equal(attempts, 2);
});

test('cache respects shouldCache for valid empty provider results', async () => {
  let loads = 0;
  const key = 'test:cache:not-cacheable';
  const loader = async () => {
    loads++;
    return null;
  };

  assert.equal(await service.getOrSet(key, 10_000, loader, (value) => value !== null), null);
  assert.equal(await service.getOrSet(key, 10_000, loader, (value) => value !== null), null);
  assert.equal(loads, 2);
});

test('forecast service normalizes cache coordinates and avoids duplicate provider calls', async () => {
  const calls: Array<[number, number]> = [];
  const forecast = { current: { temperature: 17 } };
  service.weatherApiProvider.getForecast = async (latitude, longitude) => {
    calls.push([latitude, longitude]);
    return forecast;
  };

  const first = await service.WeatherService.getForecast(48.121, 10.451);
  const sameRoundedCell = await service.WeatherService.getForecast(48.124, 10.454);
  await service.WeatherService.getForecast(48.136, 10.466);

  assert.strictEqual(first, forecast);
  assert.strictEqual(sameRoundedCell, forecast);
  assert.deepEqual(calls, [[48.121, 10.451], [48.136, 10.466]]);
});

test('forecast service does not cache a provider rejection', async () => {
  let calls = 0;
  service.weatherApiProvider.getForecast = async () => {
    calls++;
    if (calls === 1) throw new Error('temporary forecast failure');
    return { recovered: true };
  };

  await assert.rejects(service.WeatherService.getForecast(41.111, 9.111), /temporary forecast failure/);
  assert.deepEqual(await service.WeatherService.getForecast(41.111, 9.111), { recovered: true });
  assert.equal(calls, 2);
});

test('geocoding service normalizes query and unsupported language before provider access', async () => {
  const calls: Array<[string, string]> = [];
  service.weatherApiProvider.searchPlaces = async (query, language) => {
    calls.push([query, language]);
    return [];
  };

  await service.WeatherService.searchPlaces('  Berlin  ', 'FR');

  assert.deepEqual(calls, [['berlin', 'de']]);
});

test('pollen service does not freeze null provider results in the cache', async () => {
  let calls = 0;
  service.weatherApiProvider.getPollen = async () => {
    calls++;
    return calls === 1 ? null : { alder: 5 };
  };

  assert.equal(await service.WeatherService.getPollen(40.111, 8.111), null);
  assert.deepEqual(await service.WeatherService.getPollen(40.111, 8.111), { alder: 5 });
  assert.equal(calls, 2);
});

test('favorites service caches per coordinate and preserves partial provider success', async () => {
  const batches: Array<Array<{ id: number; latitude: number; longitude: number }>> = [];
  service.weatherApiProvider.getCurrentBatch = async (places) => {
    batches.push(places);
    return new Map(places.flatMap((place) => place.id === 2
      ? []
      : [[place.id, { temp: 10 + place.id, code: 2, isDay: true }]]));
  };
  const firstPlaces = [
    { id: 1, latitude: 35.111, longitude: 7.111 },
    { id: 2, latitude: 35.222, longitude: 7.222 },
  ];

  const first = await service.WeatherService.getCurrentBatch(firstPlaces);
  const second = await service.WeatherService.getCurrentBatch([
    ...firstPlaces,
    { id: 3, latitude: 35.333, longitude: 7.333 },
  ]);

  assert.deepEqual([...first.keys()], [1]);
  assert.deepEqual([...second.keys()], [1, 3]);
  assert.deepEqual(batches, [
    firstPlaces,
    [
      { id: 2, latitude: 35.222, longitude: 7.222 },
      { id: 3, latitude: 35.333, longitude: 7.333 },
    ],
  ]);
});
