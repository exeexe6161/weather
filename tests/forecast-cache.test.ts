import { createWeatherClock, weatherAge } from "../src/lib/weatherAge.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { MAX_FAVORITES } from "../src/lib/favorites.ts";
import { GEO_PLACE_ID, type Place } from "../src/lib/geocoding.ts";
import { findLocalProviderPlace } from "../src/app.ts";
import { readPlaceLink } from "../src/lib/linkResolution.ts";
import type { Forecast } from "../src/lib/weather.ts";
import { localDateAt, isForecastForCurrentLocalDay } from "../src/lib/forecastDay.ts";
import {
  MAX_FORECAST_CACHE_AGE_MS,
  MAX_FORECAST_CACHE_ENTRIES,
  getUsableForecast,
  getRecentForecast,
  forecastCacheState,
  pruneExpiredForecasts,
  pruneForecastCache,
  putForecast,
  readForecastCache,
  writeForecastCache,
  type ForecastCacheEntry,
} from "../src/lib/forecastCache.ts";

const CACHE_KEY = "weather:weatherapi:forecasts:rain-v2";
const LEGACY_KEY = "weather:weatherapi:last-forecast";
const OLDER_LEGACY_KEY = "weather:last-forecast";

const originalNow = Date.now;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

class MemoryStorage {
  private values = new Map<string, string>();
  // Simuliert eine volle oder gesperrte Ablage (Quota, privater Modus).
  failOnWrite = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error("QuotaExceededError");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

let storage: MemoryStorage;

// Fester Bezugspunkt, damit die TTL-Prüfungen nicht von der echten Uhr abhängen.
const NOW = Date.parse("2099-07-15T12:00:00.000Z");
const stamp = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

function forecast(temperature: number): Forecast {
  return {
    sourceFetchedAt: stamp(0),
    current: {
      time: "2099-07-15T12:00",
      temperature,
      apparentTemperature: temperature + 1,
      humidity: 50,
      windSpeed: 10,
      weatherCode: 1000,
      isDay: true,
    },
    hourly: [],
    daily: [{ date: "2099-07-15", tempMax: 25, tempMin: 15, weatherCode: 1000, precipitationProbabilityMax: null, sunrise: null, sunset: null, uvIndexMax: null }],
    timezone: "Europe/Berlin",
    yesterdayTempMax: temperature - 2,
  };
}

function seed(id: number, savedAt: string, temperature = 20): void {
  putForecast(id, 52.52, 13.405, { ...forecast(temperature), sourceFetchedAt: savedAt }, savedAt);
}

function linkedPlace(id: number): Place {
  return { id, providerId: id, name: "Köln", latitude: 52.52, longitude: 13.405, country: "Deutschland", countryCode: "DE" };
}

test("provider link reaches only a fresh forecast for its locally known place", () => {
  const link = readPlaceLink("?stadt=K%C3%B6ln&placeId=17");
  const local = findLocalProviderPlace(link, linkedPlace(17), [linkedPlace(28)]);
  assert.equal(local?.id, 17);
  seed(17, stamp(0), 21);
  seed(28, stamp(0), 15);
  assert.equal(getUsableForecast(local!.id, NOW)?.forecast.current.temperature, 21);
});

test("foreign, missing and expired forecasts cannot fill a provider link", () => {
  const link = readPlaceLink("?stadt=K%C3%B6ln&placeId=17");
  const local = findLocalProviderPlace(link, linkedPlace(17), []);
  assert.equal(local?.id, 17);
  assert.equal(getUsableForecast(local!.id, NOW), null);
  seed(28, stamp(0), 15);
  assert.equal(getUsableForecast(local!.id, NOW), null);
  seed(17, stamp(-MAX_FORECAST_CACHE_AGE_MS - 1000), 21);
  assert.equal(getUsableForecast(local!.id, NOW), null);
});

test("forecast cache alone cannot supply an unknown provider linked place", () => {
  seed(17, stamp(0), 21);
  const link = readPlaceLink("?stadt=K%C3%B6ln&placeId=17");
  assert.equal(findLocalProviderPlace(link, null, [linkedPlace(28)]), null);
});

test("missing and real zero rain probabilities survive the forecast storage round trip", () => {
  const data = forecast(20);
  data.hourly = [{ time: "2099-07-15T12:00", temperature: 20, apparentTemperature: 21, weatherCode: 2, precipitationProbability: null }];
  data.daily = [{ date: "2099-07-15", tempMax: 25, tempMin: 15, weatherCode: 2, precipitationProbabilityMax: null, sunrise: null, sunset: null, uvIndexMax: null }];
  putForecast(7, 50, 8, data, stamp(0));
  assert.equal(getUsableForecast(7, NOW)?.forecast.hourly[0].precipitationProbability, null);
  assert.equal(getUsableForecast(7, NOW)?.forecast.daily[0].precipitationProbabilityMax, null);
  data.hourly[0].precipitationProbability = 0;
  data.daily[0].precipitationProbabilityMax = 0;
  putForecast(7, 50, 8, data, stamp(0));
  assert.equal(getUsableForecast(7, NOW)?.forecast.hourly[0].precipitationProbability, 0);
  assert.equal(getUsableForecast(7, NOW)?.forecast.daily[0].precipitationProbabilityMax, 0);
});

test("provider ID keeps the existing internal forecast cache key", () => {
  const providerId = 2801268;
  seed(providerId, stamp(0));
  assert.equal(getUsableForecast(providerId, NOW)?.placeId, providerId);
  assert.equal(readForecastCache().has(providerId), true);
});

test("snow probabilities remain optional in old forecasts and preserve zero in new forecasts", () => {
  const data = forecast(20);
  data.hourly = [{ time: "2099-07-15T12:00", temperature: 20, apparentTemperature: 21, weatherCode: 0, precipitationProbability: 0 }];
  data.daily = [{ date: "2099-07-15", tempMax: 20, tempMin: 10, weatherCode: 0, precipitationProbabilityMax: 0, sunrise: null, sunset: null, uvIndexMax: null }];
  putForecast(7, 50, 8, data, stamp(0));
  assert.equal(getUsableForecast(7, NOW)?.forecast.hourly[0].snowProbability, undefined);
  assert.equal(getUsableForecast(7, NOW)?.forecast.daily[0].snowProbabilityMax, undefined);
  data.hourly[0].snowProbability = 0;
  data.daily[0].snowProbabilityMax = 65;
  putForecast(7, 50, 8, data, stamp(0));
  assert.equal(getUsableForecast(7, NOW)?.forecast.hourly[0].snowProbability, 0);
  assert.equal(getUsableForecast(7, NOW)?.forecast.daily[0].snowProbabilityMax, 65);
});

test("only the ambiguous legacy weather cache is invalidated, user choices remain intact", () => {
  const userValues = { "weather:favorites": "favorite fixture", "weather:last-place": "last place fixture", "weather:theme": "dark", "weather:lang": "tr" };
  for (const [key, value] of Object.entries(userValues)) storage.setItem(key, value);
  const old = forecast(20);
  storage.setItem("weather:weatherapi:forecasts", JSON.stringify({ 7: { placeId: 7, latitude: 50, longitude: 8, savedAt: stamp(0), forecast: old } }));

  assert.equal(getUsableForecast(7, NOW), null);
  assert.equal(storage.has("weather:weatherapi:forecasts"), false);
  for (const [key, value] of Object.entries(userValues)) assert.equal(storage.getItem(key), value);
});

beforeEach(() => {
  Date.now = () => NOW;
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
});

after(() => {
  Date.now = originalNow;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
});

test("stores several places side by side and reads each one back", () => {
  seed(1, stamp(0), 21);
  seed(2, stamp(0), 15);
  seed(3, stamp(0), 30);

  const cache = readForecastCache();
  assert.equal(cache.size, 3);
  assert.equal(cache.get(1)?.forecast.current.temperature, 21);
  assert.equal(cache.get(2)?.forecast.current.temperature, 15);
  assert.equal(cache.get(3)?.forecast.current.temperature, 30);
  assert.equal(cache.get(2)?.latitude, 52.52);
  assert.equal(cache.get(2)?.longitude, 13.405);
});

// Der eigentliche Befund: vorher überschrieb jeder Ortswechsel den einen
// Einzeleintrag, sodass der Rückweg wieder im Ladeskelett landete.
test("keeps the entry for place A usable after place B was stored", () => {
  seed(1, stamp(0), 21);
  seed(2, stamp(0), 15);

  const a = getUsableForecast(1, NOW);
  assert.notEqual(a, null);
  assert.equal(a?.forecast.current.temperature, 21);
  assert.equal(getUsableForecast(2, NOW)?.forecast.current.temperature, 15);
});

test("returns null for an entry older than the 60 minute limit", () => {
  seed(1, stamp(-MAX_FORECAST_CACHE_AGE_MS - 1000));
  seed(2, stamp(-MAX_FORECAST_CACHE_AGE_MS + 1000));

  assert.equal(getUsableForecast(1, NOW), null);
  assert.notEqual(getUsableForecast(2, NOW), null);
  assert.equal(MAX_FORECAST_CACHE_AGE_MS, 60 * 60 * 1000);
});

test("discards entries with an unparseable timestamp", () => {
  const broken: ForecastCacheEntry = {
    placeId: 1,
    latitude: 52.52,
    longitude: 13.405,
    savedAt: "irgendwann",
    forecast: forecast(20),
  };
  storage.setItem(CACHE_KEY, JSON.stringify({ 1: broken }));

  assert.equal(getUsableForecast(1, NOW), null);
  assert.equal(readForecastCache().size, 0);
});

test("never stores the geolocation place", () => {
  seed(GEO_PLACE_ID, stamp(0));

  assert.equal(readForecastCache().size, 0);
  assert.equal(storage.getItem(CACHE_KEY), null);
});

// Zweite Verteidigungslinie: selbst eine Altlast aus einer früheren Version
// darf den Standort nicht zurück in die Anzeige bringen.
test("never returns the geolocation place, even from a pre-existing entry", () => {
  storage.setItem(CACHE_KEY, JSON.stringify({
    [GEO_PLACE_ID]: {
      placeId: GEO_PLACE_ID,
      latitude: 52.52,
      longitude: 13.405,
      savedAt: stamp(0),
      forecast: forecast(20),
    },
    7: { placeId: 7, latitude: 40, longitude: 9, savedAt: stamp(0), forecast: forecast(25) },
  }));

  assert.equal(getUsableForecast(GEO_PLACE_ID, NOW), null);
  const cache = readForecastCache();
  assert.equal(cache.has(GEO_PLACE_ID), false);
  // Der fremde Eintrag fällt raus, der gültige bleibt erhalten.
  assert.equal(cache.size, 1);
  assert.equal(cache.get(7)?.forecast.current.temperature, 25);
});

test("holds at most MAX_FAVORITES + 1 entries", () => {
  assert.equal(MAX_FORECAST_CACHE_ENTRIES, MAX_FAVORITES + 1);
  for (let i = 1; i <= MAX_FORECAST_CACHE_ENTRIES + 3; i++) seed(i, stamp((i - 10) * 1000));

  assert.equal(readForecastCache().size, MAX_FORECAST_CACHE_ENTRIES);
});

test("drops the oldest entry when the limit is exceeded", () => {
  for (let i = 1; i <= MAX_FORECAST_CACHE_ENTRIES; i++) seed(i, stamp((i - 10) * 1000));
  // Ort 1 ist der älteste Stand und muss dem neuen Ort weichen.
  seed(99, stamp(0));

  const cache = readForecastCache();
  assert.equal(cache.size, MAX_FORECAST_CACHE_ENTRIES);
  assert.equal(cache.has(1), false);
  assert.equal(cache.has(2), true);
  assert.equal(cache.has(99), true);
});

test("prune removes orphaned places and keeps the listed ones", () => {
  seed(1, stamp(0));
  seed(2, stamp(0));
  seed(3, stamp(0));

  const kept = pruneForecastCache([1, 3]);

  assert.deepEqual([...kept.keys()].sort((a, b) => a - b), [1, 3]);
  assert.deepEqual([...readForecastCache().keys()].sort((a, b) => a - b), [1, 3]);
});

test("prune with an empty list clears the cache", () => {
  seed(1, stamp(0));

  assert.equal(pruneForecastCache([]).size, 0);
  assert.equal(readForecastCache().size, 0);
});

test("treats corrupted localStorage data as an empty cache", () => {
  storage.setItem(CACHE_KEY, "{not-json");

  assert.equal(readForecastCache().size, 0);
  assert.equal(getUsableForecast(1, NOW), null);
});

test("rejects valid JSON with an unusable forecast shape", () => {
  const envelope = { placeId: 1, latitude: 52.52, longitude: 13.405, savedAt: stamp(0) };
  storage.setItem(CACHE_KEY, JSON.stringify({ 1: { ...envelope, forecast: {} } }));
  assert.equal(getUsableForecast(1, NOW), null);
  storage.setItem(CACHE_KEY, JSON.stringify({ 1: { ...envelope, forecast: { current: {}, hourly: [], daily: [] } } }));
  assert.equal(getUsableForecast(1, NOW), null);
  storage.setItem(CACHE_KEY, JSON.stringify({ 1: { ...envelope, forecast: { ...forecast(20), hourly: [null] } } }));
  assert.equal(getUsableForecast(1, NOW), null);
});

test("accepts the minimal rendered forecast shape without newer optional fields", () => {
  const minimal = {
    sourceFetchedAt: stamp(0),
    current: {
      time: "2099-07-15T12:00", temperature: 20, apparentTemperature: 21,
      humidity: 50, windSpeed: 10, weatherCode: 1000, isDay: true,
    },
    hourly: [],
    daily: [{ date: "2099-07-15", tempMax: 25, tempMin: 15, weatherCode: 1000 }],
  };
  storage.setItem(CACHE_KEY, JSON.stringify({
    1: { placeId: 1, latitude: 52.52, longitude: 13.405, savedAt: stamp(0), forecast: minimal },
  }));
  assert.equal(getUsableForecast(1, NOW), null);
  assert.equal(getRecentForecast(1, NOW)?.forecast.current.temperature, 20);
  assert.equal(getRecentForecast(1, NOW)?.forecast.current.lastUpdatedEpoch, undefined);
});

test("same day cached forecast remains fresh for its exact place", () => {
  seed(17, stamp(-30 * 60_000));
  const entry = getRecentForecast(17, NOW)!;
  assert.equal(forecastCacheState(entry, NOW), "fresh");
  assert.equal(getUsableForecast(17, NOW)?.placeId, 17);
  assert.equal(getUsableForecast(18, NOW), null);
});

test("Tokyo midnight changes calendar validity without extending the 60 minute cache", () => {
  const saved = Date.parse("2099-07-15T14:40:00Z"); // 23:40 in Tokyo
  const now = Date.parse("2099-07-15T15:10:00Z"); // 00:10 next day in Tokyo
  Date.now = () => now;
  const data = { ...forecast(20), sourceFetchedAt: new Date(saved).toISOString(), timezone: "Asia/Tokyo" };
  putForecast(7, 35.7, 139.7, data, new Date(saved).toISOString());
  const entry = getRecentForecast(7, now)!;
  assert.equal(localDateAt(data.timezone, saved), "2099-07-15");
  assert.equal(localDateAt(data.timezone, now), "2099-07-16");
  assert.equal(forecastCacheState(entry, now), "calendar-stale");
  assert.equal(getUsableForecast(7, now), null);
  assert.equal(getRecentForecast(7, now)?.placeId, 7);
  assert.equal(getRecentForecast(7, saved + MAX_FORECAST_CACHE_AGE_MS + 1), null);
  assert.equal(forecastCacheState(entry, saved + MAX_FORECAST_CACHE_AGE_MS + 1), "expired");
});

test("Los Angeles and Tokyo calendar days ignore the device calendar", () => {
  const berlinMidnight = Date.parse("2099-07-15T22:10:00Z");
  assert.equal(localDateAt("Europe/Berlin", berlinMidnight), "2099-07-16");
  assert.equal(localDateAt("America/Los_Angeles", berlinMidnight), "2099-07-15");
  assert.equal(localDateAt("Asia/Tokyo", berlinMidnight), "2099-07-16");
  assert.equal(isForecastForCurrentLocalDay({ ...forecast(20), timezone: "America/Los_Angeles" }, berlinMidnight), true);
  assert.equal(isForecastForCurrentLocalDay({ ...forecast(20), timezone: "Asia/Tokyo" }, berlinMidnight), false);
  assert.equal(localDateAt("invalid/timezone", berlinMidnight), null);
});

test("removes the old single forecast keys on read", () => {
  storage.setItem(LEGACY_KEY, JSON.stringify({ placeId: 1, savedAt: stamp(0), forecast: forecast(20) }));
  storage.setItem(OLDER_LEGACY_KEY, JSON.stringify({ placeId: 1, savedAt: stamp(0) }));

  readForecastCache();

  assert.equal(storage.has(LEGACY_KEY), false);
  assert.equal(storage.has(OLDER_LEGACY_KEY), false);
});

test("survives a failing localStorage write without throwing", () => {
  storage.failOnWrite = true;

  assert.doesNotThrow(() => seed(1, stamp(0)));
  assert.doesNotThrow(() => writeForecastCache(new Map()));
  assert.doesNotThrow(() => pruneForecastCache([]));
  assert.equal(getUsableForecast(1, NOW), null);
});

test("prunes expired entries and keeps the still valid ones", () => {
  seed(1, stamp(-MAX_FORECAST_CACHE_AGE_MS - 1000));
  seed(2, stamp(-1000));

  const kept = pruneExpiredForecasts(NOW);

  assert.deepEqual([...kept.keys()], [2]);
  assert.deepEqual([...readForecastCache().keys()], [2]);
});

test("F06 receiving a 14 minute server cache hit does not restart its forecast lifetime", () => {
  const sourceFetchedAt = stamp(-14 * 60_000);
  putForecast(7, 50, 8, { ...forecast(20), sourceFetchedAt }, stamp(0));
  assert.equal(getRecentForecast(7, NOW)?.savedAt, sourceFetchedAt);
  assert.ok(getRecentForecast(7, NOW + 46 * 60_000));
  assert.equal(getRecentForecast(7, NOW + 46 * 60_000 + 1), null);
  assert.equal(readForecastCache(NOW + 46 * 60_000 + 1).size, 0);
});

test("F06 forecast legacy and future provenance cannot be replaced by local savedAt", () => {
  for (const sourceFetchedAt of [undefined, "invalid", stamp(1)]) {
    storage.setItem(CACHE_KEY, JSON.stringify({ 7: { placeId: 7, latitude: 50, longitude: 8, savedAt: stamp(0), forecast: { ...forecast(20), sourceFetchedAt } } }));
    assert.equal(getRecentForecast(7, NOW), null);
  }
});

test("F06 failed storage cleanup does not make an expired forecast usable", () => {
  seed(7, stamp(-60 * 60_000));
  storage.failOnWrite = true;
  assert.equal(getRecentForecast(7, NOW + 1), null);
  assert.match(storage.getItem(CACHE_KEY)!, /sourceFetchedAt/);
  assert.equal(readForecastCache(NOW + 1).size, 0);
});


test("F06 wall clock rollback never extends lifetime within an open app session", () => {
  let wall = NOW;
  let elapsed = 0;
  const clock = createWeatherClock(() => wall, () => elapsed);
  const source = stamp(0);
  assert.equal(weatherAge(source, clock()), "fresh");
  elapsed += 16 * 60_000;
  wall -= 24 * 60 * 60_000;
  assert.equal(weatherAge(source, clock()), "stale");
  elapsed += 44 * 60_000 + 1;
  assert.equal(weatherAge(source, clock()), "expired");
  wall = NOW + 3 * 24 * 60 * 60_000;
  assert.equal(weatherAge(source, clock()), "expired");
  wall = NOW;
  assert.equal(weatherAge(source, clock()), "expired");
});

test("F06 UTC elapsed age is independent of DST and offset notation", () => {
  const source = "2026-10-25T02:30:00+02:00";
  assert.equal(weatherAge(source, Date.parse("2026-10-25T02:30:00+01:00")), "stale");
  assert.equal(weatherAge(source, Date.parse("2026-10-25T02:30:00.001+01:00")), "expired");
  assert.equal(weatherAge(source, Date.parse("2026-10-25T00:45:00Z")), "fresh");
});
