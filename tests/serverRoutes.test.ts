import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { blockUnexpectedNetwork, createResponseDouble, loadBundledModule } from './testHarness.ts';

type Handler = (request: {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}, response: ReturnType<typeof createResponseDouble>['response']) => Promise<void>;

interface RouteModule {
  weatherHandler: Handler;
  geocodingHandler: Handler;
  pollenHandler: Handler;
  favoritesHandler: Handler;
  fetchFavoritesWeather(places: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    country: string;
    countryCode: string;
  }>): Promise<Map<number, unknown>>;
  WeatherService: {
    getForecast(latitude: number, longitude: number): Promise<unknown>;
    searchPlaces(query: string, language: string): Promise<unknown[]>;
    getPollen(latitude: number, longitude: number): Promise<unknown>;
    getCurrentBatch(places: Array<{ id: number; latitude: number; longitude: number }>): Promise<Map<number, unknown>>;
  };
}

const routes = await loadBundledModule<RouteModule>(`
  export { default as weatherHandler } from './api/weather.ts';
  export { default as geocodingHandler } from './api/geocoding.ts';
  export { default as pollenHandler } from './api/pollen.ts';
  export { default as favoritesHandler } from './api/favorites-weather.ts';
  export { fetchFavoritesWeather } from './src/lib/favoritesWeather.ts';
  export { WeatherService } from './src/server/weather/WeatherService.ts';
`);

const originalService = {
  getForecast: routes.WeatherService.getForecast,
  searchPlaces: routes.WeatherService.searchPlaces,
  getPollen: routes.WeatherService.getPollen,
  getCurrentBatch: routes.WeatherService.getCurrentBatch,
};

let restoreNetwork: () => void;

beforeEach(() => {
  restoreNetwork = blockUnexpectedNetwork();
});

afterEach(() => {
  Object.assign(routes.WeatherService, originalService);
  restoreNetwork();
});

function request(query: Record<string, string | string[] | undefined>, method = 'GET') {
  return { method, query, headers: { 'x-forwarded-for': '192.0.2.10' } };
}

test('weather route returns the service forecast for valid coordinates', async () => {
  const forecast = { current: { temperature: 18 }, providerInternal: undefined };
  let received: [number, number] | null = null;
  routes.WeatherService.getForecast = async (latitude, longitude) => {
    received = [latitude, longitude];
    return forecast;
  };
  const { response, state } = createResponseDouble();

  await routes.weatherHandler(request({ lat: '48.37', lon: '10.89' }), response);

  assert.deepEqual(received, [48.37, 10.89]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, forecast);
});

test('weather route rejects missing, nonnumeric and out-of-range coordinates', async () => {
  let calls = 0;
  routes.WeatherService.getForecast = async () => {
    calls++;
    return {};
  };
  const invalidQueries = [
    { lon: '10' },
    { lat: '48', lon: 'not-a-number' },
    { lat: '91', lon: '10' },
    { lat: '48', lon: '-181' },
  ];

  for (const query of invalidQueries) {
    const { response, state } = createResponseDouble();
    await routes.weatherHandler(request(query), response);
    assert.equal(state.statusCode, 400);
    assert.deepEqual(state.body, { error: 'Invalid or missing lat/lon' });
  }
  assert.equal(calls, 0);
});

test('weather route hides provider errors and secret-like details', async () => {
  routes.WeatherService.getForecast = async () => {
    throw new Error('upstream failed with route-dummy-secret-value');
  };
  const { response, state } = createResponseDouble();

  await routes.weatherHandler(request({ lat: '48', lon: '10' }), response);

  assert.equal(state.statusCode, 502);
  assert.deepEqual(state.body, { error: 'Weather provider request failed' });
  assert.doesNotMatch(JSON.stringify(state.body), /route-dummy-secret-value/);
});

test('server route guards reject unsupported methods before service access', async () => {
  let calls = 0;
  routes.WeatherService.getForecast = async () => {
    calls++;
    return {};
  };
  const { response, state } = createResponseDouble();

  await routes.weatherHandler(request({ lat: '48', lon: '10' }, 'POST'), response);

  assert.equal(calls, 0);
  assert.equal(state.statusCode, 405);
  assert.deepEqual(state.body, { error: 'Method not allowed' });
});

test('geocoding route forwards query and language and returns empty results unchanged', async () => {
  const calls: Array<[string, string]> = [];
  routes.WeatherService.searchPlaces = async (query, language) => {
    calls.push([query, language]);
    return [];
  };
  const { response, state } = createResponseDouble();

  await routes.geocodingHandler(request({ q: 'Berlin', lang: 'en' }), response);

  assert.deepEqual(calls, [['Berlin', 'en']]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, []);
});

test('geocoding route rejects an empty query without provider access', async () => {
  let calls = 0;
  routes.WeatherService.searchPlaces = async () => {
    calls++;
    return [];
  };
  const { response, state } = createResponseDouble();

  await routes.geocodingHandler(request({ q: '   ' }), response);

  assert.equal(calls, 0);
  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, { error: 'Missing q' });
});

test('geocoding route converts provider failures to a bounded 502 response', async () => {
  routes.WeatherService.searchPlaces = async () => {
    throw new Error('provider response body must stay private');
  };
  const { response, state } = createResponseDouble();

  await routes.geocodingHandler(request({ q: 'Berlin' }), response);

  assert.equal(state.statusCode, 502);
  assert.deepEqual(state.body, { error: 'Geocoding provider request failed' });
});

test('pollen route returns both real levels and the valid empty null result', async () => {
  const values = [{ alder: 12 }, null];
  routes.WeatherService.getPollen = async () => values.shift() ?? null;

  const first = createResponseDouble();
  await routes.pollenHandler(request({ lat: '48', lon: '10' }), first.response);
  assert.equal(first.state.statusCode, 200);
  assert.deepEqual(first.state.body, { alder: 12 });

  const second = createResponseDouble();
  await routes.pollenHandler(request({ lat: '48.1', lon: '10.1' }), second.response);
  assert.equal(second.state.statusCode, 200);
  assert.equal(second.state.body, null);
});

test('pollen route rejects invalid parameters before provider access', async () => {
  let calls = 0;
  routes.WeatherService.getPollen = async () => {
    calls++;
    return null;
  };
  const { response, state } = createResponseDouble();

  await routes.pollenHandler(request({ lat: '-91', lon: '10' }), response);

  assert.equal(calls, 0);
  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, { error: 'Invalid or missing lat/lon' });
});

test('pollen route safely bounds an unexpected service error', async () => {
  routes.WeatherService.getPollen = async () => {
    throw new Error('unexpected pollen provider detail');
  };
  const { response, state } = createResponseDouble();

  await routes.pollenHandler(request({ lat: '48', lon: '10' }), response);

  assert.equal(state.statusCode, 502);
  assert.deepEqual(state.body, { error: 'Pollen provider request failed' });
});

test('favorites route parses valid places and exposes only the public weather shape', async () => {
  let received: unknown;
  routes.WeatherService.getCurrentBatch = async (places) => {
    received = places;
    return new Map([
      [1, { temp: 20, code: 2, isDay: true, providerOnly: 'hidden' }],
      [2, { temp: 11, code: 61, isDay: false, providerOnly: 'hidden' }],
    ]);
  };
  const places = [
    { id: 1, latitude: 48, longitude: 10 },
    { id: 2, latitude: 49, longitude: 11 },
  ];
  const { response, state } = createResponseDouble();

  await routes.favoritesHandler(request({ places: JSON.stringify(places) }), response);

  assert.deepEqual(received, places);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, [
    { id: 1, temp: 20, code: 2, isDay: true },
    { id: 2, temp: 11, code: 61, isDay: false },
  ]);
  assert.doesNotMatch(JSON.stringify(state.body), /providerOnly/);
});

test('favorites route rejects empty, malformed, oversized and invalid place lists', async () => {
  let calls = 0;
  routes.WeatherService.getCurrentBatch = async () => {
    calls++;
    return new Map();
  };
  const oversized = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    latitude: 48,
    longitude: 10,
  }));
  const invalidValues = [
    '[]',
    '{bad json',
    JSON.stringify(oversized),
    JSON.stringify([{ id: 1, latitude: 91, longitude: 10 }]),
  ];

  for (const places of invalidValues) {
    const { response, state } = createResponseDouble();
    await routes.favoritesHandler(request({ places }), response);
    assert.equal(state.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('favorites route keeps successful entries when the service returns a partial batch', async () => {
  routes.WeatherService.getCurrentBatch = async () => new Map([
    [2, { temp: 14, code: 3, isDay: true }],
  ]);
  const places = [
    { id: 1, latitude: 48, longitude: 10 },
    { id: 2, latitude: 49, longitude: 11 },
  ];
  const { response, state } = createResponseDouble();

  await routes.favoritesHandler(request({ places: JSON.stringify(places) }), response);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, [{ id: 2, temp: 14, code: 3, isDay: true }]);
});

test('favorites route converts an overall provider failure to a bounded 502 response', async () => {
  routes.WeatherService.getCurrentBatch = async () => {
    throw new Error('batch provider detail');
  };
  const { response, state } = createResponseDouble();

  await routes.favoritesHandler(request({
    places: JSON.stringify([{ id: 1, latitude: 48, longitude: 10 }]),
  }), response);

  assert.equal(state.statusCode, 502);
  assert.deepEqual(state.body, { error: 'Favorites weather provider request failed' });
});

test('empty client favorites return an empty map without any network attempt', async () => {
  const result = await routes.fetchFavoritesWeather([]);
  assert.equal(result.size, 0);
});
