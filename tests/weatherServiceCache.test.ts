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
  geocodingCacheQuery(query: string): string;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  getOrSet<T>(key: string, ttlMs: number, load: () => Promise<T>, shouldCache?: (value: T) => boolean): Promise<T>;
  buildCacheKey(providerId: string, parts: Array<string | number>): string;
}

const service = await loadBundledModule<ServiceModule>(`
  export { WeatherService, geocodingCacheQuery } from './src/server/weather/WeatherService.ts';
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

test('geocoding service trims the query and normalizes an unsupported language', async () => {
  const calls: Array<[string, string]> = [];
  service.weatherApiProvider.searchPlaces = async (query, language) => {
    calls.push([query, language]);
    return [];
  };

  await service.WeatherService.searchPlaces('  Berlin  ', 'FR');

  // Der Provider bekommt den getrimmten ORIGINALBEGRIFF. Frueher stand hier
  // 'berlin': die Kleinschreibung ging mit an den Provider und zerlegte dabei
  // das tuerkische grosse I mit Punkt.
  assert.deepEqual(calls, [['Berlin', 'de']]);
});

// ── Block 4A: der Suchbegriff darf den Provider unverfaelscht erreichen ──────
//
// Der Cache lebt modulweit und wird zwischen den Tests NICHT geleert, genau wie
// bei den Forecast Tests weiter oben, die sich dafuer unterschiedliche
// Koordinaten geben. Hier gilt dasselbe: jeder Test benutzt ein eigenes Paar aus
// Begriff und Sprache. Wer einen Test ergaenzt, muss ein neues Paar waehlen,
// sonst misst er einen Cache Treffer statt eines Provideraufrufs.

test('geocoding service leaves the typed query untouched for the provider', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [];
  };

  for (const begriff of ['Berlin', 'München', 'Köln', 'İstanbul', 'İzmir']) {
    await service.WeatherService.searchPlaces(begriff, 'tr');
  }

  // Wortgetreu, inklusive Grossbuchstaben und U+0130. Genau so hat der Provider
  // im direkten Preflight geantwortet.
  assert.deepEqual(calls, ['Berlin', 'München', 'Köln', 'İstanbul', 'İzmir']);
});

test('geocoding service never sends the broken dotted i sequence', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [];
  };

  await service.WeatherService.searchPlaces('İstanbul', 'en');
  await service.WeatherService.searchPlaces('İzmir', 'en');

  // U+0307 ist das kombinierende Punktzeichen, das toLowerCase aus dem
  // tuerkischen İ erzeugt. Es darf in keiner Provideranfrage mehr auftauchen.
  for (const call of calls) {
    assert.equal(call.includes('̇'), false, `U+0307 in Provideranfrage: ${JSON.stringify(call)}`);
  }
  assert.deepEqual([...calls[0]].map((c) => c.codePointAt(0)!.toString(16))[0], '130');
  assert.equal(calls[0], 'İstanbul');
  assert.equal(calls[1], 'İzmir');
});

test('geocoding cache key folds ASCII case and canonicalizes the Turkish dotted I', () => {
  // Gleiche Schreibweise ergibt denselben Schluessel.
  assert.equal(service.geocodingCacheQuery('Berlin'), service.geocodingCacheQuery('Berlin'));
  // Gross und Klein teilen sich den Schluessel, wie schon vor Block 4A.
  assert.equal(service.geocodingCacheQuery('Berlin'), 'berlin');
  assert.equal(service.geocodingCacheQuery('berlin'), 'berlin');
  assert.equal(service.geocodingCacheQuery('BERLIN'), 'berlin');
  assert.equal(service.geocodingCacheQuery('München'), 'münchen');
  assert.equal(service.geocodingCacheQuery('münchen'), 'münchen');
  assert.equal(service.geocodingCacheQuery('Köln'), 'köln');
  assert.equal(service.geocodingCacheQuery('köln'), 'köln');
  // Das tuerkische İ wird GEZIELT auf ASCII abgebildet, damit beide
  // Schreibweisen denselben Eintrag treffen. Beide liefern beim Provider
  // dasselbe Ergebnis, ein gemeinsamer Eintrag spart also einen Aufruf.
  assert.equal(service.geocodingCacheQuery('İstanbul'), 'istanbul');
  assert.equal(service.geocodingCacheQuery('istanbul'), 'istanbul');
  assert.equal(service.geocodingCacheQuery('İzmir'), 'izmir');
  assert.equal(service.geocodingCacheQuery('izmir'), 'izmir');
  // Und zwar OHNE die kaputte Zerlegung in i plus kombinierendes U+0307.
  assert.equal(service.geocodingCacheQuery('İstanbul').includes('̇'), false);
  assert.equal(service.geocodingCacheQuery('İzmir').includes('̇'), false);
  // Gegenprobe zur verworfenen tuerkischen Gebietsschema Variante: das
  // englische I darf nicht zum punktlosen ı werden.
  assert.equal(service.geocodingCacheQuery('Istanbul'), 'istanbul');
  assert.equal(service.geocodingCacheQuery('Istanbul').includes('ı'), false);
  // Keine pauschale Entfernung kombinierender Zeichen: eine bereits zerlegte
  // Eingabe bleibt, wie sie ist, und faellt damit nicht mit den heilen
  // Schreibweisen zusammen.
  assert.equal(service.geocodingCacheQuery('İstanbul'.toLowerCase()).includes('̇'), true);
});

test('geocoding service shares one provider call across ASCII case variants', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [{ id: 1, name: 'Berlin' }];
  };

  const first = await service.WeatherService.searchPlaces('Berlin', 'en');
  const second = await service.WeatherService.searchPlaces('berlin', 'en');

  // Ein Provideraufruf, zweimal dasselbe Ergebnis, und der Aufruf trug die
  // Originalschreibweise.
  assert.deepEqual(calls, ['Berlin']);
  assert.strictEqual(second, first);
});

test('geocoding service shares one cache entry for both Istanbul spellings', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [{ id: 2, name: 'Istanbul' }];
  };

  const dotted = await service.WeatherService.searchPlaces('İstanbul', 'de');
  const ascii = await service.WeatherService.searchPlaces('istanbul', 'de');

  // Genau EIN Provideraufruf, und er trug die Originalschreibweise mit U+0130.
  // Das ist zugleich der Nachweis, dass Provider Query und Cache Schluessel
  // getrennte Werte sind: der Schluessel fuehrt beide Formen zusammen, die
  // Anfrage bleibt die getippte.
  assert.deepEqual(calls, ['İstanbul']);
  assert.strictEqual(ascii, dotted);
});

test('geocoding service shares one cache entry for both Izmir spellings', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [{ id: 3, name: 'Izmir' }];
  };

  const dotted = await service.WeatherService.searchPlaces('İzmir', 'de');
  const ascii = await service.WeatherService.searchPlaces('izmir', 'de');

  assert.deepEqual(calls, ['İzmir']);
  assert.strictEqual(ascii, dotted);
});

test('geocoding service shares one cache entry for Muenchen and Koeln case variants', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [];
  };

  await service.WeatherService.searchPlaces('München', 'de');
  await service.WeatherService.searchPlaces('münchen', 'de');
  await service.WeatherService.searchPlaces('Köln', 'de');
  await service.WeatherService.searchPlaces('köln', 'de');

  assert.deepEqual(calls, ['München', 'Köln']);
});

test('geocoding service passes unsupported exonyms through without alias handling', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return []; // Provider kennt diese Exonyme nicht, live mit 0 Treffern belegt.
  };

  const muenih = await service.WeatherService.searchPlaces('Münih', 'tr');
  const viyana = await service.WeatherService.searchPlaces('Viyana', 'tr');

  // Wortgetreu weitergereicht. Keine Aliastabelle, keine Umschreibung auf
  // München oder Wien, kein erfundener Treffer.
  assert.deepEqual(calls, ['Münih', 'Viyana']);
  assert.deepEqual(muenih, []);
  assert.deepEqual(viyana, []);
});

test('geocoding service handles an already mangled query exactly as before', async () => {
  // Ein geteilter Link aus der Zeit vor dieser Korrektur koennte die zerlegte
  // Form tragen, weil syncCityParam den Ortsnamen kleinschreibt. Frueher machte
  // der Server daraus per toLowerCase denselben String, heute reicht er ihn
  // unveraendert durch. Beide Wege sind identisch, es gibt also keine
  // Regression fuer bestehende Links.
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [];
  };

  const zerlegt = 'İstanbul'.toLowerCase(); // i + U+0307 + stanbul
  await service.WeatherService.searchPlaces(zerlegt, 'en');

  assert.deepEqual(calls, [zerlegt]);
  assert.equal(calls[0], zerlegt.toLowerCase(), 'alter und neuer Weg muessen denselben String senden');
  // Und die zerlegte Form faellt NICHT mit der heilen zusammen, sonst wuerde ihr
  // Leerergebnis die funktionierende Schreibweise miterschlagen.
  assert.notEqual(service.geocodingCacheQuery(zerlegt), service.geocodingCacheQuery('İstanbul'));
});

test('geocoding service returns provider places untouched for favorites and shared links', async () => {
  // Favoriten und geteilte Links haengen an id, Koordinaten und name. Der
  // Service darf an den Ortsobjekten nichts veraendern, sonst wuerden gespeicherte
  // Favoriten doppelt erscheinen oder ein geteilter Link ins Leere laufen.
  const platz = { id: 745042, name: 'Izmit', latitude: 40.77, longitude: 29.92, country: 'Turkey', countryCode: 'TR', admin1: 'Kocaeli' };
  service.weatherApiProvider.searchPlaces = async () => [platz];

  const treffer = await service.WeatherService.searchPlaces('İzmit', 'de');

  assert.deepEqual(treffer, [platz]);
  assert.strictEqual((treffer as typeof platz[])[0], platz);
});

test('geocoding service keeps languages in separate cache entries', async () => {
  const calls: Array<[string, string]> = [];
  service.weatherApiProvider.searchPlaces = async (query, language) => {
    calls.push([query, language]);
    return [];
  };

  await service.WeatherService.searchPlaces('Hamburg', 'de');
  await service.WeatherService.searchPlaces('Hamburg', 'en');
  await service.WeatherService.searchPlaces('Hamburg', 'tr');
  await service.WeatherService.searchPlaces('Hamburg', 'de'); // Cache Treffer

  assert.deepEqual(calls, [['Hamburg', 'de'], ['Hamburg', 'en'], ['Hamburg', 'tr']]);
});

test('geocoding service caps overlong queries without altering the rest', async () => {
  const calls: string[] = [];
  service.weatherApiProvider.searchPlaces = async (query) => {
    calls.push(query);
    return [];
  };

  await service.WeatherService.searchPlaces(`  ${'İ'.repeat(120)}  `, 'tr');

  assert.equal(calls[0].length, 100);
  assert.equal(calls[0], 'İ'.repeat(100));
  assert.equal(calls[0].includes('̇'), false);
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
