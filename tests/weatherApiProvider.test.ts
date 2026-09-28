import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { blockUnexpectedNetwork, loadBundledModule } from './testHarness.ts';
import { formatObservationStampInZone, formatStampInZone } from '../src/lib/format.ts';

interface ProviderModule {
  weatherApiProvider: {
    getForecast(latitude: number, longitude: number): Promise<Record<string, unknown>>;
    getPollen(latitude: number, longitude: number): Promise<Record<string, number | null> | null>;
    searchPlaces(query: string, language: string): Promise<Array<Record<string, unknown>>>;
    getCurrentBatch(places: Array<{ id: number; latitude: number; longitude: number }>): Promise<Map<number, unknown>>;
  };
  setQuotaReservationAdapterForTesting(adapter: QuotaReservationAdapter | null | undefined): void;
}

interface QuotaReservationRequest {
  month: string;
}

interface QuotaReservationAdapter {
  reserve(request: QuotaReservationRequest, signal?: AbortSignal): Promise<unknown>;
}

const providerModule = await loadBundledModule<ProviderModule>(`
  export { weatherApiProvider } from './src/server/weather/providers/WeatherApiProvider.ts';
  export { setQuotaReservationAdapterForTesting } from './src/server/weather/quotaGuard.ts';
`);
const provider = providerModule.weatherApiProvider;

const DUMMY_KEY = 'weather-test-key';
const originalKey = process.env.WEATHERAPI_KEY;
const originalSetTimeout = globalThis.setTimeout;
let restoreNetwork: () => void;
let reservationRequests: QuotaReservationRequest[];

beforeEach(() => {
  process.env.WEATHERAPI_KEY = DUMMY_KEY;
  reservationRequests = [];
  providerModule.setQuotaReservationAdapterForTesting({
    async reserve(request) {
      reservationRequests.push(request);
      return {
        status: 'reserved',
        burstRemaining: 299,
        monthlyRemaining: 1_999_999,
        month: request.month,
      };
    },
  });
  restoreNetwork = blockUnexpectedNetwork();
});

afterEach(() => {
  providerModule.setQuotaReservationAdapterForTesting(null);
  if (originalKey === undefined) delete process.env.WEATHERAPI_KEY;
  else process.env.WEATHERAPI_KEY = originalKey;
  globalThis.setTimeout = originalSetTimeout;
  restoreNetwork();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function useFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): string[] {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url, init);
  };
  return calls;
}

function captureHistoryBudget(): () => void {
  let expire: (() => void) | undefined;
  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    if (ms === 3_000) {
      expire = callback;
      return 0 as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(callback, ms);
  }) as typeof setTimeout;
  return () => {
    assert.ok(expire, 'history budget timer was started');
    expire();
  };
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

test('provider observation 13:45 remains distinct from browser fetch time 14:10', async () => {
  const payload = forecastFixture();
  (payload.current as Record<string, unknown>).last_updated_epoch = Date.parse('2026-07-15T11:45:00Z') / 1000;
  useFetch((url) => url.includes('history.json')
    ? jsonResponse({ forecast: { forecastday: [{ day: { maxtemp_c: 24 } }] } })
    : jsonResponse(payload));
  const result = await provider.getForecast(48, 10);
  const current = result.current as Record<string, unknown>;
  const fetchedAt = '2026-07-15T12:10:00Z';
  assert.equal(current.lastUpdatedEpoch, Date.parse('2026-07-15T11:45:00Z') / 1000);
  assert.equal(formatObservationStampInZone(current.lastUpdatedEpoch, result.timezone, 'de-DE', Date.parse(fetchedAt)), '13:45');
  assert.equal(formatStampInZone(result.timezone, 'de-DE', new Date(fetchedAt), new Date(fetchedAt)), '14:10');
  assert.equal(formatObservationStampInZone(undefined, result.timezone), null);
});

test('forecast keeps epoch identity across repeated local hour and stops after 25 relevant hours', async () => {
  const payload = forecastFixture();
  const location = payload.location as Record<string, unknown>;
  const base = 1_792_886_400;
  location.localtime = '2026-10-25 02:30';
  location.localtime_epoch = base + 5_400;
  const day = ((payload.forecast as Record<string, unknown>).forecastday as Array<Record<string, unknown>>)[0];
  const template = (day.hour as Array<Record<string, unknown>>)[0];
  day.date = '2026-10-25';
  day.hour = Array.from({ length: 27 }, (_, index) => ({
    ...template,
    time: index < 2 ? '2026-10-25 02:00' : new Date(Date.UTC(2026, 9, 25, index + 1)).toISOString().slice(0, 16).replace('T', ' '),
    time_epoch: base + index * 3_600,
    temp_c: 10 + index,
  }));
  (day.hour as Array<Record<string, unknown>>)[26].time = 'invalid late hour';
  useForecastPayload(payload);
  const forecast = await provider.getForecast(50, 8);
  const current = forecast.current as Record<string, unknown>;
  const hourly = forecast.hourly as Array<Record<string, unknown>>;
  assert.equal(current.timeEpoch, base + 5_400);
  assert.equal(forecast.timezone, 'Europe/Berlin');
  assert.equal(hourly.length, 25);
  assert.equal(hourly[0].timeEpoch, base + 3_600);
  assert.equal(hourly[0].time, '2026-10-25T02:00');
  assert.equal(hourly[24].timeEpoch, base + 25 * 3_600);
});

function forecastWindowFixture(): {
  payload: Record<string, unknown>;
  hours: Array<Record<string, unknown>>;
  days: Array<Record<string, unknown>>;
} {
  const payload = forecastFixture();
  const template = ((payload.forecast as Record<string, unknown>).forecastday as Array<Record<string, unknown>>)[0];
  const hours = Array.from({ length: 60 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 6, 15, 12 + index)).toISOString().slice(0, 16).replace('T', ' '),
    temp_c: 20 + index,
    humidity: 50,
    wind_kph: 10,
    chance_of_rain: 0,
    chance_of_snow: 0,
    precip_mm: 0,
    condition: { code: 1000 },
  }));
  const days = ['2026-07-15', '2026-07-16', '2026-07-17'].map((date) => ({
    ...structuredClone(template),
    date,
    hour: hours.filter((hour) => hour.time.startsWith(date)),
  }));
  (payload.forecast as Record<string, unknown>).forecastday = days;
  return { payload, hours, days };
}

function useForecastPayload(payload: Record<string, unknown>): string[] {
  return useFetch((url) => jsonResponse(url.includes('history.json')
    ? { forecast: { forecastday: [{ day: { maxtemp_c: 24 } }] } }
    : payload));
}

test('missing server key fails before fetch with a bounded configuration error', async () => {
  delete process.env.WEATHERAPI_KEY;

  await assert.rejects(provider.searchPlaces('Berlin', 'de'), (error: Error) => {
    assert.equal(error.message, 'WeatherAPI is not configured');
    assert.doesNotMatch(error.message, /key=/i);
    return true;
  });
  assert.equal(reservationRequests.length, 0);
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
    providerId: 1,
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

test('geocoding keeps a local ID without claiming provider provenance when Search has no ID', async () => {
  useFetch(() => jsonResponse([{ name: 'Fallback', lat: 48, lon: 10, country: 'Germany' }]));
  const [place] = await provider.searchPlaces('Fallback', 'de');
  assert.equal(Number.isFinite(place.id), true);
  assert.equal(place.name, 'Fallback');
  assert.equal(Object.hasOwn(place, 'providerId'), false);
});

test('geocoding passes a documented provider ID query and preserves the returned ID', async () => {
  const calls = useFetch(() => jsonResponse([{ id: 2801268, name: 'İstanbul', lat: 41.01, lon: 28.98, country: 'Turkey' }]));
  const [place] = await provider.searchPlaces('id:2801268', 'tr');
  assert.equal(place.id, 2801268);
  assert.equal(place.providerId, 2801268);
  assert.match(calls[0], /q=id%3A2801268/);
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

test('pollen reicht technische Fehler durch, statt sie als Leerzustand auszugeben', async () => {
  // Frueher lieferten Zeitueberschreitung, defektes JSON und ein Providerstatus
  // allesamt `null`, also dasselbe Ergebnis wie eine erfolgreiche Antwort ohne
  // Pollenobjekt. Die Route antwortete daraufhin mit 200 und die Oberflaeche
  // behauptete eine regionale Abdeckungsluecke, die es nicht gab. `null` ist
  // jetzt ausschliesslich die echte Nichtverfuegbarkeit.
  const timeout = () => { throw new DOMException('timed out', 'AbortError'); };
  useFetch(timeout);
  await assert.rejects(provider.getPollen(40, 8), (err: Error) => err.name === 'AbortError');

  useFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid json'); } }) as Response);
  await assert.rejects(provider.getPollen(41, 9), SyntaxError);

  useFetch(() => jsonResponse({}, 503));
  await assert.rejects(provider.getPollen(42, 10), (err: Error & { status?: number }) => {
    assert.equal(err.name, 'ProviderHttpError');
    assert.equal(err.status, 503);
    return true;
  });
});

test('ein Providerfehler traegt den Status als Eigenschaft und nie die Anfrage URL', async () => {
  // Der Status muss auswertbar bleiben, damit errorMapping ihn nicht aus einem
  // Meldungstext zurueckgewinnen muss. Die Anfrage URL darf nirgends auftauchen:
  // sie traegt den WeatherAPI Schluessel als Query Parameter.
  useFetch(() => jsonResponse({}, 502));

  await assert.rejects(provider.getForecast(48, 10), (err: Error & { status?: number }) => {
    assert.equal(err.name, 'ProviderHttpError');
    assert.equal(err.status, 502);
    assert.doesNotMatch(err.message, /api\.weatherapi\.com/);
    assert.doesNotMatch(err.message, new RegExp(DUMMY_KEY));
    assert.doesNotMatch(err.message, /key=/);
    return true;
  });
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
  assert.equal(reservationRequests.length, 2);
});

test('slow history transport aborts within its budget and returns the complete main forecast', async () => {
  const expire = captureHistoryBudget();
  let historyStarted!: (signal: AbortSignal) => void;
  const started = new Promise<AbortSignal>((resolve) => { historyStarted = resolve; });
  let transportAborted = false;
  const calls = useFetch((url, init) => {
    if (!url.includes('history.json')) return jsonResponse(forecastFixture());
    const signal = init?.signal;
    assert.ok(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        transportAborted = true;
        reject(new DOMException('history aborted', 'AbortError'));
      }, { once: true });
      historyStarted(signal);
    });
  });

  const pending = provider.getForecast(48, 10);
  const signal = await started;
  expire();
  const forecast = await pending;

  assert.equal(signal.aborted, true);
  assert.equal(transportAborted, true);
  assert.equal(forecast.yesterdayTempMax, null);
  assert.equal((forecast.daily as unknown[]).length, 1);
  assert.equal(calls.length, 2);
  assert.equal(reservationRequests.length, 2);
});

test('history budget also ends a pending quota reservation without a history fetch', async () => {
  const expire = captureHistoryBudget();
  let quotaStarted!: (signal: AbortSignal) => void;
  const started = new Promise<AbortSignal>((resolve) => { quotaStarted = resolve; });
  let quotaAborted = false;
  let reservations = 0;
  providerModule.setQuotaReservationAdapterForTesting({
    reserve(request, signal) {
      reservations++;
      if (reservations === 1) return Promise.resolve({ status: 'reserved', burstRemaining: 299, monthlyRemaining: 1_999_999, month: request.month });
      assert.ok(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          quotaAborted = true;
          reject(new DOMException('quota aborted', 'AbortError'));
        }, { once: true });
        quotaStarted(signal);
      });
    },
  });
  const calls = useFetch(() => jsonResponse(forecastFixture()));

  const pending = provider.getForecast(48, 10);
  const signal = await started;
  expire();
  const forecast = await pending;

  assert.equal(signal.aborted, true);
  assert.equal(quotaAborted, true);
  assert.equal(forecast.yesterdayTempMax, null);
  assert.equal(reservations, 2);
  assert.equal(calls.length, 1);
});

test('late quota approval after the history budget cannot start a provider request', async () => {
  const expire = captureHistoryBudget();
  let quotaStarted!: () => void;
  const started = new Promise<void>((resolve) => { quotaStarted = resolve; });
  let approveQuota!: (decision: unknown) => void;
  let reservations = 0;
  let historyMonth = '';
  providerModule.setQuotaReservationAdapterForTesting({
    reserve(request) {
      reservations++;
      if (reservations === 1) return Promise.resolve({ status: 'reserved', burstRemaining: 299, monthlyRemaining: 1_999_999, month: request.month });
      historyMonth = request.month;
      return new Promise((resolve) => {
        approveQuota = resolve;
        quotaStarted();
      });
    },
  });
  const calls = useFetch(() => jsonResponse(forecastFixture()));

  const pending = provider.getForecast(48, 10);
  await started;
  expire();
  const forecast = await pending;
  approveQuota({ status: 'reserved', burstRemaining: 298, monthlyRemaining: 1_999_998, month: historyMonth });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(forecast.yesterdayTempMax, null);
  assert.equal(reservations, 2);
  assert.equal(calls.length, 1);
});

test('history budget covers response reading and cannot commit a late value', async () => {
  const expire = captureHistoryBudget();
  let bodyStarted!: (signal: AbortSignal) => void;
  const started = new Promise<AbortSignal>((resolve) => { bodyStarted = resolve; });
  let finishBody!: (value: unknown) => void;
  const calls = useFetch((url, init) => {
    if (!url.includes('history.json')) return jsonResponse(forecastFixture());
    const signal = init?.signal;
    assert.ok(signal);
    return {
      ok: true,
      status: 200,
      json: () => new Promise((resolve) => {
        finishBody = resolve;
        bodyStarted(signal);
      }),
    } as Response;
  });

  const pending = provider.getForecast(48, 10);
  const signal = await started;
  expire();
  const forecast = await pending;
  finishBody({ forecast: { forecastday: [{ day: { maxtemp_c: 99 } }] } });
  await Promise.resolve();

  assert.equal(signal.aborted, true);
  assert.equal(forecast.yesterdayTempMax, null);
  assert.equal(calls.length, 2);
});

test('history HTTP and network failures leave the main forecast intact', async () => {
  for (const outcome of ['http', 'network']) {
    const calls = useFetch((url) => {
      if (!url.includes('history.json')) return jsonResponse(forecastFixture());
      if (outcome === 'http') return jsonResponse({}, 503);
      throw new TypeError('history network failure');
    });
    const forecast = await provider.getForecast(48, 10);
    assert.equal(forecast.yesterdayTempMax, null);
    assert.equal((forecast.hourly as unknown[]).length, 2);
    assert.equal(calls.length, 2);
  }
});

test('missing and invalid history maximum remain unknown', async () => {
  for (const maximum of [undefined, 'invalid']) {
    useFetch((url) => jsonResponse(url.includes('history.json')
      ? { forecast: { forecastday: [{ day: { maxtemp_c: maximum } }] } }
      : forecastFixture()));
    const forecast = await provider.getForecast(48, 10);
    assert.equal(forecast.yesterdayTempMax, null);
  }
});

test('history quota failure returns null without an unprotected history fetch', async () => {
  let reservations = 0;
  providerModule.setQuotaReservationAdapterForTesting({
    async reserve(request) {
      reservations++;
      if (reservations === 2) throw new Error('quota unavailable');
      return { status: 'reserved', burstRemaining: 299, monthlyRemaining: 1_999_999, month: request.month };
    },
  });
  const calls = useFetch(() => jsonResponse(forecastFixture()));

  const forecast = await provider.getForecast(48, 10);
  assert.equal(forecast.yesterdayTempMax, null);
  assert.equal(reservations, 2);
  assert.equal(calls.length, 1);
});

test('failed main forecast never starts optional history', async () => {
  const calls = useFetch(() => jsonResponse({}, 502));
  await assert.rejects(provider.getForecast(48, 10), (error: Error) => error.name === 'ProviderHttpError');
  assert.equal(calls.length, 1);
  assert.equal(reservationRequests.length, 1);
});

test('forecast ignores invalid required weather data in an earlier hour', async () => {
  const { payload, days } = forecastWindowFixture();
  (days[0].hour as Array<Record<string, unknown>>).unshift({ time: '2026-07-15 11:00', humidity: 50, wind_kph: 10, condition: { code: 1000 } });
  useForecastPayload(payload);

  const forecast = await provider.getForecast(48, 10);
  const hourly = forecast.hourly as Array<Record<string, unknown>>;
  assert.equal(hourly.length, 25);
  assert.equal(hourly[0].time, '2026-07-15T12:00');
  assert.equal(hourly[24].time, '2026-07-16T12:00');
});

test('forecast ignores invalid required weather data after the first 25 hours', async () => {
  const { payload, hours } = forecastWindowFixture();
  delete hours[25].temp_c;
  useForecastPayload(payload);

  const forecast = await provider.getForecast(48, 10);
  const hourly = forecast.hourly as Array<Record<string, unknown>>;
  assert.equal(hourly.length, 25);
  assert.equal(hourly[24].time, '2026-07-16T12:00');
  assert.equal(hourly[24].temperature, 44);
});

test('forecast rejects required weather errors among the first 25 instead of replacing that hour', async () => {
  for (const [field, expected] of [
    ['temp_c', 'hour.temp_c'],
    ['humidity', 'hour.humidity'],
    ['wind_kph', 'hour.wind_kph'],
    ['condition', 'condition.code'],
  ]) {
    const { payload, hours } = forecastWindowFixture();
    if (field === 'condition') hours[4].condition = { code: 'invalid' };
    else delete hours[4][field];
    const calls = useForecastPayload(payload);

    await assert.rejects(provider.getForecast(48, 10), (error: Error) => {
      assert.match(error.message, new RegExp(expected.replace('.', '\\.')));
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(hours[25].time, '2026-07-16 13:00');
  }
});

test('forecast keeps optional unknown values and genuine zero in needed hours', async () => {
  const { payload, hours } = forecastWindowFixture();
  hours[0].chance_of_rain = 'invalid';
  hours[0].chance_of_snow = 'invalid';
  hours[0].precip_mm = 'invalid';
  hours[0].condition = { code: 9999 };
  hours[1].chance_of_rain = 0;
  hours[1].chance_of_snow = 0;
  hours[1].precip_mm = 0;
  useForecastPayload(payload);

  const forecast = await provider.getForecast(48, 10);
  const hourly = forecast.hourly as Array<Record<string, unknown>>;
  assert.equal(hourly[0].precipitationProbability, null);
  assert.equal(hourly[0].snowProbability, null);
  assert.equal(hourly[0].precipitation, undefined);
  assert.equal(hourly[0].weatherCode, -1);
  assert.equal(hourly[1].precipitationProbability, 0);
  assert.equal(hourly[1].snowProbability, 0);
  assert.equal(hourly[1].precipitation, 0);
});

test('forecast rejects an unclassifiable time before the first 25 hours are selected', async () => {
  for (const time of [undefined, '2026-02-30 13:00', 'not a time']) {
    const { payload, hours } = forecastWindowFixture();
    hours[4].time = time;
    const calls = useForecastPayload(payload);

    await assert.rejects(provider.getForecast(48, 10), /hour\.time/);
    assert.equal(calls.length, 1);
  }
});

test('forecast leaves later hour time untouched after selecting 25 valid hours', async () => {
  const { payload, hours } = forecastWindowFixture();
  hours[25].time = undefined;
  delete hours[25].temp_c;
  useForecastPayload(payload);

  const forecast = await provider.getForecast(48, 10);
  assert.equal((forecast.hourly as unknown[]).length, 25);
});

test('forecast preserves daily data when a later day has an invalid unused hour', async () => {
  const { payload, days } = forecastWindowFixture();
  delete (days[2].hour as Array<Record<string, unknown>>)[0].temp_c;
  useForecastPayload(payload);

  const forecast = await provider.getForecast(48, 10);
  const daily = forecast.daily as Array<Record<string, unknown>>;
  assert.equal((forecast.hourly as unknown[]).length, 25);
  assert.deepEqual(daily.map((day) => day.date), ['2026-07-15', '2026-07-16', '2026-07-17']);
  assert.equal(daily[2].tempMax, 25);
});

test('forecast still rejects an invalid required daily value after valid hour selection', async () => {
  const { payload, days } = forecastWindowFixture();
  delete (days[2].day as Record<string, unknown>).maxtemp_c;
  useForecastPayload(payload);

  await assert.rejects(provider.getForecast(48, 10), /day\.maxtemp_c/);
});

test('forecast keeps the existing order and values with a fully valid 25 hour window', async () => {
  const { payload, hours } = forecastWindowFixture();
  const calls = useForecastPayload(payload);

  const forecast = await provider.getForecast(48, 10);
  const hourly = forecast.hourly as Array<Record<string, unknown>>;
  const daily = forecast.daily as Array<Record<string, unknown>>;
  assert.equal(hourly.length, 25);
  assert.deepEqual(hourly.map((hour) => hour.time), hours.slice(0, 25).map((hour) => String(hour.time).replace(' ', 'T')));
  assert.deepEqual(hourly.map((hour) => hour.temperature), Array.from({ length: 25 }, (_, index) => 20 + index));
  assert.deepEqual(hourly.map((hour) => [hour.windSpeed, hour.relativeHumidity, hour.weatherCode, hour.precipitationProbability, hour.snowProbability, hour.precipitation]),
    Array.from({ length: 25 }, () => [10, 50, 0, 0, 0, 0]));
  assert.deepEqual(daily.map((day) => day.date), ['2026-07-15', '2026-07-16', '2026-07-17']);
  assert.deepEqual(daily.map((day) => [day.tempMax, day.tempMin, day.weatherCode, day.precipitationProbabilityMax]),
    [[25, 14, 0, 20], [25, 14, 0, 20], [25, 14, 0, 20]]);
  assert.equal(calls.length, 2);
});

test('exhausted provider budget blocks fetch without exposing counter details', async () => {
  providerModule.setQuotaReservationAdapterForTesting({
    async reserve(request) {
      return {
        status: 'monthly_exhausted',
        burstRemaining: 200,
        monthlyRemaining: 0,
        month: request.month,
      };
    },
  });
  const calls = useFetch(() => jsonResponse([]));

  await assert.rejects(provider.searchPlaces('Berlin', 'de'), (error: Error) => {
    assert.equal(error.message, 'Weather service is temporarily unavailable');
    assert.doesNotMatch(error.message, /monthly|counter|redis|upstash/i);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('counter failures fail closed before provider fetch', async () => {
  providerModule.setQuotaReservationAdapterForTesting({
    async reserve() {
      throw new Error('simulated counter failure');
    },
  });
  const calls = useFetch(() => jsonResponse([]));

  await assert.rejects(provider.searchPlaces('Berlin', 'de'), (error: Error) => {
    assert.equal(error.message, 'Weather service is temporarily unavailable');
    assert.doesNotMatch(error.message, /simulated|counter|redis|upstash/i);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('missing global adapter fails closed before provider fetch', async () => {
  providerModule.setQuotaReservationAdapterForTesting(null);
  const calls = useFetch(() => jsonResponse([]));

  await assert.rejects(provider.searchPlaces('Berlin', 'de'), (error: Error) => {
    assert.equal(error.message, 'Weather service is temporarily unavailable');
    return true;
  });
  assert.equal(calls.length, 0);
});

test('provider failure keeps the successful reservation consumed', async () => {
  let reservations = 0;
  let rollbacks = 0;
  providerModule.setQuotaReservationAdapterForTesting({
    async reserve(request) {
      reservations++;
      return {
        status: 'reserved',
        burstRemaining: 299,
        monthlyRemaining: 1_999_999,
        month: request.month,
      };
    },
    rollback() {
      rollbacks++;
    },
  } as QuotaReservationAdapter);
  useFetch(async () => {
    throw new Error('simulated provider failure');
  });

  await assert.rejects(provider.searchPlaces('Berlin', 'de'), /simulated provider failure/);
  assert.equal(reservations, 1);
  assert.equal(rollbacks, 0);
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

  // Ohne forecast/alerts im Mock fallen die neuen Batch Felder kontrolliert
  // auf rainChance null und hasAlert false zurück.
  assert.deepEqual([...result.entries()], [[1, { temp: 19, code: 2, isDay: true, rainChance: null, hasAlert: false }]]);
  assert.equal(calls.length, 2);
  assert.equal(reservationRequests.length, 2);
});

test('favorites batch meldet einen Totalausfall, statt ihn als leeren Erfolg auszugeben', async () => {
  // Teilerfolg bleibt Teilerfolg (Test darueber). Scheitert dagegen JEDER Ort,
  // ist ein leeres Ergebnis keine Aussage ueber das Wetter, sondern ein
  // verschleierter Fehlschlag: die Route antwortete darauf frueher mit 200 und
  // einem leeren Array, und ein geschlossener Kontingentschutz blieb lautlos.
  const quota = new Error('Weather service is temporarily unavailable');
  quota.name = 'WeatherQuotaProtectionError';
  useFetch(() => { throw quota; });

  await assert.rejects(
    provider.getCurrentBatch([
      { id: 1, latitude: 48, longitude: 10 },
      { id: 2, latitude: 49, longitude: 11 },
    ]),
    (err: Error) => err.name === 'WeatherQuotaProtectionError',
  );
});

test('favorites batch ohne Orte bleibt ein leeres Ergebnis ohne Fehler', async () => {
  useFetch(() => { throw new Error('darf nicht aufgerufen werden'); });

  const result = await provider.getCurrentBatch([]);

  assert.equal(result.size, 0);
});

test('favorites batch: unbrauchbare Nutzlast bleibt ein leeres Ergebnis, kein Fehler', async () => {
  // Der Anbieter hat erfolgreich geantwortet, die Nutzlast trug nur keinen
  // Wettercode. Das ist eine ehrliche Aussage ueber die Daten und kein
  // gescheiterter Abruf, deshalb faellt der Ort still heraus — auch als
  // einziger. Nur ein gescheiterter ABRUF wird zum Fehler.
  useFetch(() => jsonResponse({ current: { temp_c: 19, condition: {}, is_day: 1 } }));

  const result = await provider.getCurrentBatch([{ id: 1, latitude: 48, longitude: 10 }]);

  assert.equal(result.size, 0);
});
