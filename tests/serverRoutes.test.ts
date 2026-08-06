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

  // Ein unbekannter Fehler gilt jetzt als eigener Fehler statt pauschal als
  // Providerfehler. Die Schutzwirkung bleibt unveraendert: fester Text, kein
  // Durchschlagen von Details.
  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { error: 'Internal server error', reason: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(state.body), /route-dummy-secret-value/);
});

test('weather route trennt Kontingentschutz vom Providerfehler', async () => {
  const quota = new Error('Weather service is temporarily unavailable');
  quota.name = 'WeatherQuotaProtectionError';
  routes.WeatherService.getForecast = async () => { throw quota; };
  const busy = createResponseDouble();

  await routes.weatherHandler(request({ lat: '48', lon: '10' }), busy.response);

  assert.equal(busy.state.statusCode, 503);
  assert.deepEqual(busy.state.body, { error: 'Service temporarily unavailable', reason: 'service_busy' });
  assert.equal(busy.state.headers.get('Retry-After'), '60');

  const provider = new Error('WeatherAPI request failed: 500') as Error & { status: number };
  provider.name = 'ProviderHttpError';
  provider.status = 500;
  routes.WeatherService.getForecast = async () => { throw provider; };
  const failed = createResponseDouble();

  await routes.weatherHandler(request({ lat: '48.5', lon: '10.5' }), failed.response);

  assert.equal(failed.state.statusCode, 502);
  assert.deepEqual(failed.state.body, { error: 'Weather provider request failed', reason: 'provider_error' });
  assert.equal(failed.state.headers.get('Retry-After'), undefined);
});

test('weather route meldet eine Zeitueberschreitung des Providers als 504', async () => {
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  routes.WeatherService.getForecast = async () => { throw timeout; };
  const { response, state } = createResponseDouble();

  await routes.weatherHandler(request({ lat: '48', lon: '10' }), response);

  assert.equal(state.statusCode, 504);
  assert.deepEqual(state.body, { error: 'Weather provider timed out', reason: 'provider_timeout' });
});

test('kein Fehlerpfad gibt mehr als error und reason preis', async () => {
  const faelle: Array<{ name?: string; status?: number }> = [
    { name: 'WeatherQuotaProtectionError' },
    { name: 'ProviderHttpError', status: 503 },
    { name: 'TimeoutError' },
    { name: 'AbortError' },
    {},
  ];

  for (const fall of faelle) {
    const err = Object.assign(new Error('interner Text mit key=geheim'), fall);
    routes.WeatherService.getForecast = async () => { throw err; };
    const { response, state } = createResponseDouble();

    await routes.weatherHandler(request({ lat: '48', lon: '10' }), response);

    assert.deepEqual(
      Object.keys(state.body as Record<string, unknown>).sort(),
      ['error', 'reason'],
      `Fall ${fall.name ?? 'unbekannt'}`,
    );
    assert.doesNotMatch(JSON.stringify(state.body), /geheim/, `Fall ${fall.name ?? 'unbekannt'}`);
  }
});

test('server route guards reject unsupported methods before service access', async () => {
  let calls = 0;
  routes.WeatherService.getForecast = async () => {
    calls++;
    return {};
  };
  const { response, state } = createResponseDouble();

  // GET und POST sind seit den POST Weather APIs beide erlaubt; der Method
  // Guard greift bei allen übrigen Verben (POST ohne JSON deckt api-routes ab).
  await routes.weatherHandler(request({ lat: '48', lon: '10' }, 'PUT'), response);

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

test('geocoding route converts provider failures to a bounded response', async () => {
  routes.WeatherService.searchPlaces = async () => {
    throw new Error('provider response body must stay private');
  };
  const { response, state } = createResponseDouble();

  await routes.geocodingHandler(request({ q: 'Berlin' }), response);

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { error: 'Internal server error', reason: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(state.body), /response body must stay private/);
});

test('geocoding route trennt Kontingentschutz ebenfalls ab', async () => {
  // Auch search.json laeuft durch den Kontingentschutz, ein geschlossener Guard
  // legt die Ortssuche also mit still. Sie braucht dieselbe Trennung.
  const quota = new Error('Weather service is temporarily unavailable');
  quota.name = 'WeatherQuotaProtectionError';
  routes.WeatherService.searchPlaces = async () => { throw quota; };
  const { response, state } = createResponseDouble();

  await routes.geocodingHandler(request({ q: 'Berlin' }), response);

  assert.equal(state.statusCode, 503);
  assert.deepEqual(state.body, { error: 'Service temporarily unavailable', reason: 'service_busy' });
  assert.equal(state.headers.get('Retry-After'), '60');
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

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { error: 'Internal server error', reason: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(state.body), /pollen provider detail/);
});

test('pollen: echter Leerzustand bleibt 200 null, ein technischer Fehler wird es nie', async () => {
  // Das ist die Wahrheit aus Block 4B: nur eine ERFOLGREICHE Antwort ohne
  // Pollenobjekt darf als regionale Nichtverfuegbarkeit erscheinen. Frueher
  // verwandelte der Provider auch einen geschlossenen Kontingentschutz in
  // `null`, und die Oberflaeche behauptete dann eine Abdeckungsluecke.
  routes.WeatherService.getPollen = async () => null;
  const leer = createResponseDouble();
  await routes.pollenHandler(request({ lat: '48', lon: '10' }), leer.response);
  assert.equal(leer.state.statusCode, 200);
  assert.equal(leer.state.body, null);

  const quota = new Error('Weather service is temporarily unavailable');
  quota.name = 'WeatherQuotaProtectionError';
  routes.WeatherService.getPollen = async () => { throw quota; };
  const busy = createResponseDouble();
  await routes.pollenHandler(request({ lat: '48.2', lon: '10.2' }), busy.response);
  assert.equal(busy.state.statusCode, 503);
  assert.deepEqual(busy.state.body, { error: 'Service temporarily unavailable', reason: 'service_busy' });
  assert.notEqual(busy.state.statusCode, 200, 'ein technischer Fehler darf nie als Leerzustand erscheinen');
});

test('favorites route parses valid places and exposes only the public weather shape', async () => {
  let received: unknown;
  routes.WeatherService.getCurrentBatch = async (places) => {
    received = places;
    return new Map([
      [1, { temp: 20, code: 2, isDay: true, rainChance: 67, hasAlert: true, providerOnly: 'hidden' }],
      [2, { temp: 11, code: 61, isDay: false, rainChance: 12, hasAlert: false, providerOnly: 'hidden' }],
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
    { id: 1, temp: 20, code: 2, isDay: true, rainChance: 67, hasAlert: true },
    { id: 2, temp: 11, code: 61, isDay: false, rainChance: 12, hasAlert: false },
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
    [2, { temp: 14, code: 3, isDay: true, rainChance: 55, hasAlert: false }],
  ]);
  const places = [
    { id: 1, latitude: 48, longitude: 10 },
    { id: 2, latitude: 49, longitude: 11 },
  ];
  const { response, state } = createResponseDouble();

  await routes.favoritesHandler(request({ places: JSON.stringify(places) }), response);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, [{ id: 2, temp: 14, code: 3, isDay: true, rainChance: 55, hasAlert: false }]);
});

test('favorites route converts an overall provider failure to a bounded response', async () => {
  routes.WeatherService.getCurrentBatch = async () => {
    throw new Error('batch provider detail');
  };
  const { response, state } = createResponseDouble();

  await routes.favoritesHandler(request({
    places: JSON.stringify([{ id: 1, latitude: 48, longitude: 10 }]),
  }), response);

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { error: 'Internal server error', reason: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(state.body), /batch provider detail/);
});

test('favorites route meldet den Kontingentschutz statt eines leeren Erfolgs', async () => {
  const quota = new Error('Weather service is temporarily unavailable');
  quota.name = 'WeatherQuotaProtectionError';
  routes.WeatherService.getCurrentBatch = async () => { throw quota; };
  const { response, state } = createResponseDouble();

  await routes.favoritesHandler(request({
    places: JSON.stringify([{ id: 1, latitude: 48, longitude: 10 }]),
  }), response);

  assert.equal(state.statusCode, 503);
  assert.deepEqual(state.body, { error: 'Service temporarily unavailable', reason: 'service_busy' });
  assert.notDeepEqual(state.body, [], 'ein Totalausfall darf nicht als leerer Erfolg erscheinen');
});

test('empty client favorites return an empty map without any network attempt', async () => {
  const result = await routes.fetchFavoritesWeather([]);
  assert.equal(result.size, 0);
});

test('das lokale Rate Limit bleibt 429 rate_limited mit echter Restzeit', async () => {
  // Eigene Adresse, damit der modulweite Zaehler anderer Tests nicht stoert.
  const eigene = { method: 'GET', query: { lat: '48', lon: '10' }, headers: { 'x-forwarded-for': '198.51.100.77' } };
  routes.WeatherService.getForecast = async () => ({ current: { temperature: 1 } });

  let letzte = createResponseDouble();
  for (let i = 0; i < 121; i++) {
    letzte = createResponseDouble();
    await routes.weatherHandler(eigene, letzte.response);
  }

  assert.equal(letzte.state.statusCode, 429);
  assert.deepEqual(letzte.state.body, { error: 'Too many requests', reason: 'rate_limited' });
  // Anders als beim 503 bleibt hier die ECHTE Restzeit stehen: das Limit gilt
  // nur fuer diesen Aufrufer und verraet nichts ueber den globalen Schutz.
  const retry = Number(letzte.state.headers.get('Retry-After'));
  assert.ok(retry > 0 && retry <= 60, `Retry-After ${retry}`);
  assert.equal(letzte.state.headers.get('RateLimit-Limit'), '120');
  assert.equal(letzte.state.headers.get('RateLimit-Remaining'), '0');
});

test('kein Fehlerpfad schreibt irgendetwas in die Logs', async () => {
  // Haerteste Absicherung gegen ein Schluesselleck: die Anfrage URL des
  // Providers traegt den WeatherAPI Schluessel als Query Parameter, und ein
  // Netzwerkfehler aus fetch fuehrt die Ziel URL je nach Laufzeit in seiner
  // Meldung oder in `cause` mit. Solange auf diesen Pfaden ueberhaupt nichts
  // geloggt wird, kann auch nichts durchsickern.
  const original = { error: console.error, warn: console.warn, log: console.log, info: console.info, debug: console.debug };
  const geschrieben: unknown[] = [];
  const sammeln = (...args: unknown[]): void => { geschrieben.push(args); };
  console.error = sammeln;
  console.warn = sammeln;
  console.log = sammeln;
  console.info = sammeln;
  console.debug = sammeln;

  try {
    const geheim = new Error('https://api.weatherapi.com/v1/forecast.json?key=super-geheim-1234');
    for (const name of ['WeatherQuotaProtectionError', 'ProviderHttpError', 'TimeoutError', 'AbortError', 'Error']) {
      const err = Object.assign(new Error(geheim.message), { name });
      routes.WeatherService.getForecast = async () => { throw err; };
      routes.WeatherService.getPollen = async () => { throw err; };
      routes.WeatherService.searchPlaces = async () => { throw err; };
      routes.WeatherService.getCurrentBatch = async () => { throw err; };

      await routes.weatherHandler(request({ lat: '48', lon: '10' }), createResponseDouble().response);
      await routes.pollenHandler(request({ lat: '48', lon: '10' }), createResponseDouble().response);
      await routes.geocodingHandler(request({ q: 'Berlin' }), createResponseDouble().response);
      await routes.favoritesHandler(
        request({ places: JSON.stringify([{ id: 1, latitude: 48, longitude: 10 }]) }),
        createResponseDouble().response,
      );
    }
  } finally {
    console.error = original.error;
    console.warn = original.warn;
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
  }

  assert.deepEqual(geschrieben, [], 'auf Fehlerpfaden darf nichts geloggt werden');
});
