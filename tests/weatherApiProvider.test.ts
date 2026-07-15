import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { blockUnexpectedNetwork, loadBundledModule } from './testHarness.ts';

interface ProviderModule {
  weatherApiProvider: {
    getForecast(latitude: number, longitude: number): Promise<Record<string, unknown>>;
    getPollen(latitude: number, longitude: number): Promise<Record<string, number | null> | null>;
    searchPlaces(query: string, language: string): Promise<Array<Record<string, unknown>>>;
    getCurrentBatch(places: Array<{ id: number; latitude: number; longitude: number }>): Promise<Map<number, unknown>>;
  };
}

const providerModule = await loadBundledModule<ProviderModule>(`
  export { weatherApiProvider } from './src/server/weather/providers/WeatherApiProvider.ts';
`);
const provider = providerModule.weatherApiProvider;

const DUMMY_KEY = 'weather-test-key';
const originalKey = process.env.WEATHERAPI_KEY;
let restoreNetwork: () => void;

beforeEach(() => {
  process.env.WEATHERAPI_KEY = DUMMY_KEY;
  restoreNetwork = blockUnexpectedNetwork();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.WEATHERAPI_KEY;
  else process.env.WEATHERAPI_KEY = originalKey;
  restoreNetwork();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function useFetch(handler: (url: string) => Promise<Response> | Response): string[] {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url);
  };
  return calls;
}

function forecastFixture(): Record<string, unknown> {
  return {
    location: {
      localtime: '2026-07-15 12:30',
      tz_id: 'Europe/Berlin',
      region: 'Bayern',
      country: 'Germany',
    },
    current: {
      temp_c: 20,
      humidity: 50,
      wind_kph: 10,
      condition: { code: 1003, provider_text: 'Partly cloudy' },
      is_day: 1,
      air_quality: { 'us-epa-index': 2, pm2_5: 5, pm10: 9 },
      provider_private_field: 'must-not-leak',
    },
    forecast: {
      forecastday: [{
        date: '2026-07-15',
        day: {
          condition: { code: 1000 },
          maxtemp_c: 25,
          mintemp_c: 14,
          daily_chance_of_rain: 20,
          maxwind_kph: 18,
          totalprecip_mm: 1.2,
          avghumidity: 55,
          uv: 4,
        },
        astro: {
          sunrise: '05:30 AM',
          sunset: '09:00 PM',
          moonrise: '11:00 PM',
          moonset: '08:00 AM',
          moon_phase: 'Full Moon',
          moon_illumination: 99,
        },
        hour: [
          {
            time: '2026-07-15 12:00',
            temp_c: 20,
            humidity: 50,
            wind_kph: 10,
            chance_of_rain: 10,
            condition: { code: 1003 },
          },
          {
            time: '2026-07-15 13:00',
            temp_c: 21,
            humidity: 49,
            wind_kph: 11,
            chance_of_rain: 5,
            condition: { code: 1000 },
          },
        ],
      }],
    },
    alerts: { alert: [] },
    provider_root_field: 'must-not-leak',
  };
}

test('missing server key fails before fetch with a bounded configuration error', async () => {
  delete process.env.WEATHERAPI_KEY;

  await assert.rejects(provider.searchPlaces('Berlin', 'de'), (error: Error) => {
    assert.equal(error.message, 'WeatherAPI is not configured');
    assert.doesNotMatch(error.message, /key=/i);
    return true;
  });
});

test('short geocoding queries return empty without a provider request', async () => {
  const places = await provider.searchPlaces('ab', 'de');
  assert.deepEqual(places, []);
});

test('geocoding normalizes valid provider places, caps results and omits raw fields', async () => {
  const rawPlaces = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    name: `Place ${index + 1}`,
    lat: 48 + index,
    lon: 10 + index,
    country: 'Germany',
    country_code: 'DE',
    region: 'Bayern',
    provider_rank: 100 - index,
  }));
  const calls = useFetch(() => jsonResponse(rawPlaces));

  const places = await provider.searchPlaces('  Berlin  ', 'de');

  assert.equal(places.length, 5);
  assert.deepEqual(places[0], {
    id: 1,
    name: 'Place 1',
    latitude: 48,
    longitude: 10,
    country: 'Germany',
    countryCode: 'DE',
    admin1: 'Bayern',
  });
  assert.doesNotMatch(JSON.stringify(places), /provider_rank/);
  assert.match(calls[0], /search\.json/);
  assert.match(calls[0], /q=Berlin/);
});

test('geocoding returns an empty list for an unexpected non-array response', async () => {
  useFetch(() => jsonResponse({ unexpected: true }));
  assert.deepEqual(await provider.searchPlaces('Berlin', 'de'), []);
});

test('pollen normalizes real fields and returns null for empty provider data', async () => {
  const responses = [
    jsonResponse({ current: { pollen: { alder_pollen: 12, birch: '8', grass_pollen: 0 } } }),
    jsonResponse({ current: {} }),
  ];
  useFetch(() => responses.shift() ?? jsonResponse({}, 500));

  const levels = await provider.getPollen(48, 10);
  const empty = await provider.getPollen(49, 11);

  assert.equal(levels?.alder, 12);
  assert.equal(levels?.birch, 8);
  assert.equal(levels?.grass, 0);
  assert.equal(levels?.ragweed, null);
  assert.equal(empty, null);
});

test('pollen converts timeout, invalid JSON and provider status errors to null', async () => {
  const failures: Array<() => Promise<Response> | Response> = [
    async () => { throw new DOMException('timed out', 'AbortError'); },
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid json'); } }) as Response,
    () => jsonResponse({}, 503),
  ];
  useFetch(() => (failures.shift() ?? (() => jsonResponse({}, 500)))());

  assert.equal(await provider.getPollen(40, 8), null);
  assert.equal(await provider.getPollen(41, 9), null);
  assert.equal(await provider.getPollen(42, 10), null);
});

test('forecast normalizes the provider response and excludes key and raw fields', async () => {
  const calls = useFetch((url) => {
    if (url.includes('history.json')) {
      return jsonResponse({ forecast: { forecastday: [{ day: { maxtemp_c: 24 } }] } });
    }
    return jsonResponse(forecastFixture());
  });

  const forecast = await provider.getForecast(48, 10);
  const serialized = JSON.stringify(forecast);

  assert.deepEqual(forecast.current, {
    time: '2026-07-15T12:30',
    temperature: 20,
    apparentTemperature: 20,
    humidity: 50,
    windSpeed: 10,
    weatherCode: 2,
    isDay: true,
  });
  assert.equal((forecast.hourly as unknown[]).length, 2);
  assert.equal((forecast.daily as unknown[]).length, 1);
  assert.equal(forecast.yesterdayTempMax, 24);
  assert.doesNotMatch(serialized, /provider_private_field|provider_root_field|provider_text/);
  assert.doesNotMatch(serialized, new RegExp(DUMMY_KEY));
  assert.equal(calls.length, 2);
});

test('forecast rejects malformed required provider data without exposing the server key', async () => {
  const malformed = forecastFixture();
  delete (malformed.current as Record<string, unknown>).temp_c;
  useFetch(() => jsonResponse(malformed));

  await assert.rejects(provider.getForecast(48, 10), (error: Error) => {
    assert.match(error.message, /current\.temp_c/);
    assert.doesNotMatch(error.message, new RegExp(DUMMY_KEY));
    return true;
  });
});

test('forecast propagates a simulated network timeout without leaking request credentials', async () => {
  useFetch(async () => {
    throw new DOMException('simulated timeout', 'AbortError');
  });

  await assert.rejects(provider.getForecast(48, 10), (error: Error) => {
    assert.equal(error.name, 'AbortError');
    assert.doesNotMatch(error.message, new RegExp(DUMMY_KEY));
    return true;
  });
});

test('favorites batch preserves successful provider entries when another request fails', async () => {
  const calls = useFetch((url) => {
    if (url.includes('q=48%2C10')) {
      return jsonResponse({
        current: { temp_c: 19, condition: { code: 1003 }, is_day: 1 },
      });
    }
    throw new Error('simulated provider failure');
  });

  const result = await provider.getCurrentBatch([
    { id: 1, latitude: 48, longitude: 10 },
    { id: 2, latitude: 49, longitude: 11 },
  ]);

  assert.deepEqual([...result.entries()], [[1, { temp: 19, code: 2, isDay: true }]]);
  assert.equal(calls.length, 2);
});
