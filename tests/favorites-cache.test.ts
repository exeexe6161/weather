import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import {
  FAV_WEATHER_TTL_MIN,
  cacheFavoriteWeather,
  favWeatherFromForecast,
  isFavWeatherStale,
  mirrorForNewFavorite,
  readFavWeatherCache,
  refreshFavoritesWeather,
  writeFavWeatherCache,
  type FavWeatherEntry,
} from "../src/lib/favoritesWeather.ts";
import type { Forecast } from "../src/lib/weather.ts";

const CACHE_KEY = "weather:weatherapi:favorites-weather";
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
});

test("writes and reads all favorites weather values", () => {
  const entry: FavWeatherEntry = {
    temp: 18,
    code: 61,
    isDay: false,
    rainChance: 72,
    hasAlert: true,
    savedAt: "2099-07-15T12:00:00.000Z",
  };

  writeFavWeatherCache(new Map([[7, entry]]));

  assert.deepEqual(readFavWeatherCache().get(7), entry);
});

test("detects fresh, expired and invalid cache entries", () => {
  const now = Date.parse("2099-07-15T12:00:00.000Z");
  const entry = (savedAt: string): FavWeatherEntry => ({ temp: 18, code: 2, isDay: true, savedAt });

  assert.equal(isFavWeatherStale(entry(new Date(now - (FAV_WEATHER_TTL_MIN - 1) * 60_000).toISOString()), now), false);
  assert.equal(isFavWeatherStale(entry(new Date(now - (FAV_WEATHER_TTL_MIN + 1) * 60_000).toISOString()), now), true);
  assert.equal(isFavWeatherStale(entry("invalid"), now), true);
  assert.equal(isFavWeatherStale(undefined, now), true);
});

test("treats corrupted localStorage data as an empty cache", () => {
  storage.setItem(CACHE_KEY, "{not-json");

  assert.equal(readFavWeatherCache().size, 0);
});

test("reads old cache entries with safe defaults", () => {
  storage.setItem(CACHE_KEY, JSON.stringify({
    7: { temp: 17, code: 3, savedAt: "2099-07-15T12:00:00.000Z" },
  }));

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 17,
    code: 3,
    isDay: true,
    rainChance: null,
    hasAlert: false,
    savedAt: "2099-07-15T12:00:00.000Z",
  });
});

test("preserves existing optional values during a partial cache update", () => {
  writeFavWeatherCache(new Map([[7, {
    temp: 17,
    code: 3,
    isDay: true,
    rainChance: 48,
    hasAlert: true,
    savedAt: "2099-07-15T12:00:00.000Z",
  }]]));

  cacheFavoriteWeather(7, { temp: 20, code: 2, isDay: false });

  const updated = readFavWeatherCache().get(7);
  assert.equal(updated?.temp, 20);
  assert.equal(updated?.code, 2);
  assert.equal(updated?.isDay, false);
  assert.equal(updated?.rainChance, 48);
  assert.equal(updated?.hasAlert, true);
});

// ── Sofortige Werte fuer einen neu hinzugefuegten Favoriten ────────────────

const NOW = Date.parse("2099-07-15T12:00:00.000Z");

function forecastFixture(overrides: Record<string, unknown> = {}): Forecast {
  return {
    current: { time: "2099-07-15T12:00", temperature: 21.4, apparentTemperature: 20, humidity: 55, windSpeed: 9, weatherCode: 61, isDay: true },
    hourly: [],
    daily: [{ date: "2099-07-15", weatherCode: 61, tempMax: 24, tempMin: 14, precipitationProbabilityMax: 64, sunrise: null, sunset: null, uvIndexMax: null }],
    timezone: "Europe/Berlin",
    alerts: [],
    yesterdayTempMax: 20,
    ...overrides,
  } as Forecast;
}

test("ein vorhandener Forecast liefert alle Chip-Werte ohne Netzzugriff", () => {
  assert.deepEqual(favWeatherFromForecast(forecastFixture()), {
    temp: 21.4,
    code: 61,
    isDay: true,
    rainChance: 64,
    hasAlert: false,
  });
});

test("eine vorhandene Warnung wird uebernommen", () => {
  const withAlert = forecastFixture({ alerts: [{ event: "Sturm", headline: "Sturmboeen", expires: null }] });

  assert.equal(favWeatherFromForecast(withAlert)?.hasAlert, true);
});

test("fehlende Felder bleiben undefined statt eine Aussage zu erfinden", () => {
  // Ein Forecast aus der Zeit vor den Warnungen kennt `alerts` nicht. Daraus
  // false zu machen waere eine Entwarnung, die niemand geprueft hat.
  const old = forecastFixture({ alerts: undefined, daily: [{ date: "2099-07-15", weatherCode: 3, tempMax: 24, tempMin: 14, sunrise: null, sunset: null, uvIndexMax: null }] });
  const mapped = favWeatherFromForecast(old);

  assert.equal(mapped?.hasAlert, undefined);
  assert.equal(mapped?.rainChance, undefined);
});

test("ein unbrauchbarer Forecast liefert null statt eines leeren Chips", () => {
  assert.equal(favWeatherFromForecast(null), null);
  assert.equal(favWeatherFromForecast(undefined), null);
  assert.equal(favWeatherFromForecast({} as Forecast), null);
  assert.equal(favWeatherFromForecast(forecastFixture({ current: { temperature: Number.NaN, weatherCode: 61, isDay: true } })), null);
  assert.equal(favWeatherFromForecast(forecastFixture({ current: { temperature: 12, weatherCode: null, isDay: true } })), null);
});

test("ein frischer Hauptkarten-Forecast wird gespiegelt und braucht keinen Abruf", () => {
  const updatedAt = new Date(NOW - 60_000).toISOString();

  const mirror = mirrorForNewFavorite(forecastFixture(), updatedAt, NOW);

  assert.equal(mirror.needsFetch, false, "kein zusaetzlicher Providerabruf bei frischen Daten");
  assert.equal(mirror.entry?.temp, 21.4);
  assert.equal(mirror.entry?.savedAt, updatedAt, "der echte Stand, nicht jetzt");
});

test("ein veralteter Stand wird zwar gezeigt, loest aber das Nachladen aus", () => {
  // Quelle darf auch der Forecast-Cache sein (Sofortanzeige "Stand HH:MM").
  // Der Chip zeigt sofort etwas, der Wert wird aber nicht als frisch verkauft.
  const updatedAt = new Date(NOW - (FAV_WEATHER_TTL_MIN + 1) * 60_000).toISOString();

  const mirror = mirrorForNewFavorite(forecastFixture(), updatedAt, NOW);

  assert.equal(mirror.entry?.savedAt, updatedAt);
  assert.equal(mirror.needsFetch, true);
});

test("ohne verwertbare Daten bleibt der bestehende Abrufpfad zustaendig", () => {
  assert.deepEqual(mirrorForNewFavorite(null, new Date(NOW).toISOString(), NOW), { entry: null, needsFetch: true });
  assert.deepEqual(mirrorForNewFavorite(forecastFixture(), "", NOW), { entry: null, needsFetch: true });
  assert.deepEqual(mirrorForNewFavorite(forecastFixture(), "kein-datum", NOW), { entry: null, needsFetch: true });
});

test("der gespiegelte Eintrag landet mit dem echten Stand im Cache", () => {
  const updatedAt = new Date(NOW - 120_000).toISOString();
  const mirror = mirrorForNewFavorite(forecastFixture(), updatedAt, NOW);

  cacheFavoriteWeather(7, mirror.entry!, mirror.entry!.savedAt);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4,
    code: 61,
    isDay: true,
    rainChance: 64,
    hasAlert: false,
    savedAt: updatedAt,
  });
  assert.equal(isFavWeatherStale(readFavWeatherCache().get(7), NOW), false);
});

test("ohne Zeitstempel bleibt cacheFavoriteWeather beim bisherigen Verhalten", () => {
  const before = Date.now();

  cacheFavoriteWeather(7, { temp: 20, code: 2, isDay: false });

  const savedMs = Date.parse(readFavWeatherCache().get(7)!.savedAt);
  assert.ok(savedMs >= before && savedMs <= Date.now());
});

test("[REGRESSION A2] refresh preserves fresh rain chance and alert status", async () => {
  writeFavWeatherCache(new Map([[7, {
    temp: 15,
    code: 3,
    isDay: true,
    rainChance: 5,
    hasAlert: false,
    savedAt: "2000-01-01T00:00:00.000Z",
  }]]));
  globalThis.fetch = async () => Response.json([{
    id: 7,
    temp: 21,
    code: 61,
    isDay: true,
    rainChance: 64,
    hasAlert: true,
  }]);

  const result = await refreshFavoritesWeather([{
    id: 7,
    name: "Fixture City",
    latitude: 50,
    longitude: 8,
    country: "Fixture Country",
    countryCode: "FC",
  }]);

  const updated = result.get(7);
  assert.deepEqual(
    { rainChance: updated?.rainChance, hasAlert: updated?.hasAlert },
    { rainChance: 64, hasAlert: true },
  );
});
