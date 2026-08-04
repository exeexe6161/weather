import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { MAX_FAVORITES } from "../src/lib/favorites.ts";
import { GEO_PLACE_ID } from "../src/lib/geocoding.ts";
import type { Forecast } from "../src/lib/weather.ts";
import {
  MAX_FORECAST_CACHE_AGE_MS,
  MAX_FORECAST_CACHE_ENTRIES,
  getUsableForecast,
  pruneExpiredForecasts,
  pruneForecastCache,
  putForecast,
  readForecastCache,
  writeForecastCache,
  type ForecastCacheEntry,
} from "../src/lib/forecastCache.ts";

const CACHE_KEY = "weather:weatherapi:forecasts";
const LEGACY_KEY = "weather:weatherapi:last-forecast";
const OLDER_LEGACY_KEY = "weather:last-forecast";

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
    daily: [],
    timezone: "Europe/Berlin",
    yesterdayTempMax: temperature - 2,
  };
}

function seed(id: number, savedAt: string, temperature = 20): void {
  putForecast(id, 52.52, 13.405, forecast(temperature), savedAt);
}

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
});

after(() => {
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
  for (let i = 1; i <= MAX_FORECAST_CACHE_ENTRIES + 3; i++) seed(i, stamp(i * 1000));

  assert.equal(readForecastCache().size, MAX_FORECAST_CACHE_ENTRIES);
});

test("drops the oldest entry when the limit is exceeded", () => {
  for (let i = 1; i <= MAX_FORECAST_CACHE_ENTRIES; i++) seed(i, stamp(i * 1000));
  // Ort 1 ist der älteste Stand und muss dem neuen Ort weichen.
  seed(99, stamp(MAX_FORECAST_CACHE_ENTRIES * 1000 + 1000));

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
