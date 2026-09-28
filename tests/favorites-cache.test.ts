import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import {
  FAV_WEATHER_TTL_MIN,
  cacheFavoriteWeather,
  cacheFavoriteForecast,
  favWeatherFromForecast,
  isFavWeatherStale,
  mirrorForNewFavorite,
  nextFavWeatherExpiry,
  pruneFavWeatherCache,
  readFavWeatherCache,
  refreshFavoritesWeather,
  writeFavWeatherCache,
  type FavWeatherEntry,
} from "../src/lib/favoritesWeather.ts";
import type { Forecast } from "../src/lib/weather.ts";
import { renderFavoritesList } from "../src/components/FavoritesList.ts";

const CACHE_KEY = "weather:weatherapi:favorites-weather:rain-v2";
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
  const entry = (savedAt: string): FavWeatherEntry => ({ temp: 18, code: 2, isDay: true, savedAt, snapshotVersion: 1 });

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

test("a new snapshot clears unconfirmed optional values instead of keeping older values", () => {
  writeFavWeatherCache(new Map([[7, {
    temp: 17,
    code: 3,
    isDay: true,
    rainChance: 48,
    hasAlert: true,
    savedAt: "2099-07-15T12:00:00.000Z",
  }]]));

  cacheFavoriteWeather(7, { temp: 20, code: 2, isDay: false }, "2099-07-15T12:05:00.000Z");

  const updated = readFavWeatherCache().get(7);
  assert.equal(updated?.temp, 20);
  assert.equal(updated?.code, 2);
  assert.equal(updated?.isDay, false);
  assert.equal(updated?.rainChance, null);
  assert.equal(updated?.hasAlert, false);
  assert.equal(updated?.savedAt, "2099-07-15T12:05:00.000Z");
  assert.equal(updated?.snapshotVersion, 1);
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
    snapshotVersion: 1,
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

const PLACE = { id: 7, name: "Fixture City", latitude: 50, longitude: 8, country: "Fixture Country", countryCode: "FC" };
const OLD_STAMP = "2000-01-01T00:00:00.000Z";
const NEW_STAMP = "2099-07-15T12:00:00.000Z";

function seedOldSnapshot(): void {
  writeFavWeatherCache(new Map([[7, {
    temp: 15, code: 3, isDay: false, rainChance: 90, hasAlert: true, savedAt: OLD_STAMP,
  }]]));
}

test("A: full forecast with missing optional fields cannot redate older rain or alerts", () => {
  seedOldSnapshot();
  const forecast = forecastFixture({ daily: [], alerts: undefined });
  globalThis.fetch = async () => { throw new Error("snapshot mirroring must not fetch"); };

  cacheFavoriteForecast(7, forecast, NEW_STAMP);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4, code: 61, isDay: true, rainChance: null, hasAlert: false,
    savedAt: NEW_STAMP, snapshotVersion: 1,
  });
});

test("B/C: full forecast replaces all values together, including zero rain and cleared alert", () => {
  seedOldSnapshot();
  const forecast = forecastFixture({ daily: [{ precipitationProbabilityMax: 0 }] });

  cacheFavoriteForecast(7, forecast, NEW_STAMP);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4, code: 61, isDay: true, rainChance: 0, hasAlert: false,
    savedAt: NEW_STAMP, snapshotVersion: 1,
  });
});

test("D: full forecast adds newly available rain and alerts to a legacy entry", () => {
  storage.setItem(CACHE_KEY, JSON.stringify({ 7: { temp: 15, code: 3, savedAt: OLD_STAMP } }));
  const forecast = forecastFixture({ alerts: [{ event: "Wind", headline: "Wind", expires: null }] });

  cacheFavoriteForecast(7, forecast, NEW_STAMP);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4, code: 61, isDay: true, rainChance: 64, hasAlert: true,
    savedAt: NEW_STAMP, snapshotVersion: 1,
  });
});

test("E: legacy snapshots remain readable but are unconfirmed even with a recent timestamp", () => {
  storage.setItem(CACHE_KEY, JSON.stringify({ 7: {
    temp: 15, code: 3, isDay: false, rainChance: 90, hasAlert: true, savedAt: NEW_STAMP,
  } }));

  const entry = readFavWeatherCache().get(7)!;

  assert.equal(entry.temp, 15);
  assert.equal(entry.rainChance, 90);
  assert.equal(entry.hasAlert, true);
  assert.equal(entry.savedAt, NEW_STAMP);
  assert.equal(isFavWeatherStale(entry, NOW), true);
});

test("invalid full forecast does not change the previous snapshot or its timestamp", () => {
  seedOldSnapshot();

  cacheFavoriteForecast(7, {} as Forecast, NEW_STAMP);

  assert.equal(readFavWeatherCache().get(7)?.savedAt, OLD_STAMP);
  assert.equal(readFavWeatherCache().get(7)?.temp, 15);
});

for (const optional of [
  {},
  { rainChance: null },
  { rainChance: 0, hasAlert: false },
  { rainChance: 30, hasAlert: true },
]) {
  test(`batch replaces one complete snapshot without inheriting old optional values: ${JSON.stringify(optional)}`, async () => {
    seedOldSnapshot();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json([{ id: 7, temp: 20, code: 2, isDay: true, ...optional }]);
    };
    const before = Date.now();

    const result = await refreshFavoritesWeather([PLACE]);

    const entry = result.get(7)!;
    assert.deepEqual({ temp: entry.temp, code: entry.code, isDay: entry.isDay, rainChance: entry.rainChance, hasAlert: entry.hasAlert }, {
      temp: 20, code: 2, isDay: true, rainChance: "rainChance" in optional ? optional.rainChance : null,
      hasAlert: "hasAlert" in optional ? optional.hasAlert : false,
    });
    const savedMs = Date.parse(entry.savedAt);
    assert.ok(savedMs >= before && savedMs <= Date.now());
    assert.equal(entry.snapshotVersion, 1);
    assert.equal(calls, 1);
  });
}

test("failed batch keeps the old timestamp and values marked stale", async () => {
  seedOldSnapshot();
  globalThis.fetch = async () => { throw new Error("offline fixture"); };

  const entry = (await refreshFavoritesWeather([PLACE])).get(7)!;

  assert.equal(entry.savedAt, OLD_STAMP);
  assert.equal(entry.rainChance, 90);
  assert.equal(entry.hasAlert, true);
  assert.equal(isFavWeatherStale(entry), true);
});

test("partial batch success leaves the missing place on its original stale snapshot", async () => {
  seedOldSnapshot();
  globalThis.fetch = async () => Response.json([{ id: 8, temp: 20, code: 2, isDay: true, rainChance: 10, hasAlert: false }]);

  const result = await refreshFavoritesWeather([PLACE, { ...PLACE, id: 8 }]);

  assert.equal(result.get(7)?.savedAt, OLD_STAMP);
  assert.equal(result.get(7)?.rainChance, 90);
  assert.equal(isFavWeatherStale(result.get(7)), true);
  assert.equal(result.get(8)?.rainChance, 10);
  assert.equal(isFavWeatherStale(result.get(8)), false);
});

test("an older favorite batch cannot replace a newer batch for the same place", async () => {
  const replies: Array<(response: Response) => void> = [];
  globalThis.fetch = () => new Promise<Response>((resolve) => { replies.push(resolve); });

  const older = refreshFavoritesWeather([PLACE]);
  const newer = refreshFavoritesWeather([PLACE]);
  assert.equal(replies.length, 2);
  replies[1](Response.json([{ id: 7, temp: 22, code: 2, isDay: true }]));
  await newer;
  const newerStamp = readFavWeatherCache().get(7)?.savedAt;
  replies[0](Response.json([{ id: 7, temp: 11, code: 3, isDay: true }]));
  await older;

  assert.equal(readFavWeatherCache().get(7)?.temp, 22);
  assert.equal(readFavWeatherCache().get(7)?.savedAt, newerStamp);
});

test("an older batch preserves newly added and directly refreshed favorite entries", async () => {
  let reply!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>((resolve) => { reply = resolve; });

  const older = refreshFavoritesWeather([PLACE]);
  cacheFavoriteWeather(7, { temp: 25, code: 2, isDay: true });
  cacheFavoriteWeather(8, { temp: 18, code: 3, isDay: true });
  reply(Response.json([{ id: 7, temp: 11, code: 3, isDay: true }]));
  await older;

  assert.equal(readFavWeatherCache().get(7)?.temp, 25);
  assert.equal(readFavWeatherCache().get(8)?.temp, 18);
});

test("removing a favorite invalidates its pending batch even without a cache entry", async () => {
  let reply!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>((resolve) => { reply = resolve; });

  const older = refreshFavoritesWeather([PLACE]);
  pruneFavWeatherCache([]);
  reply(Response.json([{ id: 7, temp: 11, code: 3, isDay: true }]));
  await older;

  assert.equal(readFavWeatherCache().has(7), false);
});

test("next expiry follows the existing TTL boundary and ignores already stale snapshots", () => {
  const entry: FavWeatherEntry = { temp: 20, code: 2, isDay: true, savedAt: NEW_STAMP, snapshotVersion: 1 };
  const boundary = NOW + 15 * 60_000;

  assert.equal(nextFavWeatherExpiry([entry], NOW), boundary + 1);
  assert.equal(isFavWeatherStale(entry, boundary), false);
  assert.equal(isFavWeatherStale(entry, boundary + 1), true);
  assert.equal(nextFavWeatherExpiry([entry], boundary + 1), null);
  assert.equal(nextFavWeatherExpiry([{ ...entry, snapshotVersion: undefined }], NOW), null);
  assert.equal(nextFavWeatherExpiry([{ ...entry, savedAt: "invalid" }], NOW), null);
  assert.equal(nextFavWeatherExpiry([], NOW), null);
  assert.equal(nextFavWeatherExpiry([entry, { ...entry, savedAt: new Date(NOW - 60_000).toISOString() }], NOW), boundary - 60_000 + 1);
});

// Enges Render-Double: prüft den wirklichen Komponentenoutput ohne Browser
// oder GUI. Layout und Screenreader-Laufzeit werden dadurch nicht bewiesen.
function renderFavoritesMarkup(weather: Map<number, FavWeatherEntry>, now = NOW): string {
  const el = { innerHTML: "", closest: () => ({ hidden: false }), querySelectorAll: () => [] };
  renderFavoritesList(el as unknown as HTMLElement, [PLACE, { ...PLACE, id: 8, name: "Second City" }], 7, {
    onSelect() {}, onRemove() {}, onMove() {},
  }, weather, now);
  return el.innerHTML;
}

test("stale favorite values have visible and accessible age labels and cannot win comparisons", () => {
  const markup = renderFavoritesMarkup(new Map([
    [7, { temp: 30, code: 3, isDay: true, rainChance: 0, hasAlert: true, savedAt: OLD_STAMP, snapshotVersion: 1 }],
    [8, { temp: 20, code: 2, isDay: true, rainChance: 50, hasAlert: false, savedAt: NEW_STAMP, snapshotVersion: 1 }],
  ]));

  assert.match(markup, /class="fav-row-sub">Älterer Stand ·/);
  assert.match(markup, /aria-label="[^"]*Älterer Stand[^"]*Warnung vorhanden/);
  assert.doesNotMatch(markup, /class="fav-compare"/);
  assert.match(markup, /30°/);
});

test("fresh comparisons stay available, then disappear with age without changing persisted values", () => {
  const weather = new Map<number, FavWeatherEntry>([
    [7, { temp: 30, code: 3, isDay: true, rainChance: 0, savedAt: NEW_STAMP, snapshotVersion: 1 }],
    [8, { temp: 20, code: 2, isDay: true, rainChance: 50, savedAt: NEW_STAMP, snapshotVersion: 1 }],
  ]);

  const fresh = renderFavoritesMarkup(weather);
  assert.match(fresh, /Wärmster Ort: <strong>Fixture City/);
  assert.match(fresh, /Geringste Regenchance: <strong>Fixture City/);
  assert.doesNotMatch(fresh, /Älterer Stand/);
  const aged = renderFavoritesMarkup(weather, NOW + 15 * 60_000 + 1);
  assert.doesNotMatch(aged, /class="fav-compare"/);
  assert.match(aged, /Älterer Stand/);
  assert.equal(weather.get(7)?.savedAt, NEW_STAMP);
});

test("legacy values with a recent timestamp are visibly marked as older data", () => {
  const markup = renderFavoritesMarkup(new Map([[7, {
    temp: 30, code: 3, isDay: true, rainChance: 0, savedAt: NEW_STAMP,
  }]]));

  assert.match(markup, /class="fav-row-sub">Älterer Stand ·/);
  assert.match(markup, /aria-label="[^"]*Älterer Stand/);
});

test("a null daily rain value never inherits an older favorite probability", () => {
  seedOldSnapshot();
  const forecast = forecastFixture({ daily: [{ precipitationProbabilityMax: null }] });

  cacheFavoriteForecast(7, forecast, NEW_STAMP);

  assert.equal(readFavWeatherCache().get(7)?.rainChance, null);
  assert.equal(readFavWeatherCache().get(7)?.savedAt, NEW_STAMP);
  const markup = renderFavoritesMarkup(readFavWeatherCache());
  assert.doesNotMatch(markup, /0 % Regen|90 % Regen/);
});

test("unknown favorite rain cannot win the driest comparison against a known probability", () => {
  const markup = renderFavoritesMarkup(new Map([
    [7, { temp: 20, code: 3, isDay: true, rainChance: null, savedAt: NEW_STAMP, snapshotVersion: 1 }],
    [8, { temp: 20, code: 2, isDay: true, rainChance: 50, savedAt: NEW_STAMP, snapshotVersion: 1 }],
  ]));

  assert.doesNotMatch(markup, /Geringste Regenchance/);
  assert.match(markup, /class="fav-row-sub">Bedeckt<\/span>/);
  assert.match(markup, /class="fav-row-sub">Teilweise bewölkt · 50 % Regen<\/span>/);
});

test("old forecast-derived favorite weather is invalidated without deleting favorite identities or settings", () => {
  storage.setItem("weather:weatherapi:favorites-weather", JSON.stringify({ 7: { temp: 20, code: 3, isDay: true, rainChance: 0, savedAt: NEW_STAMP, snapshotVersion: 1 } }));
  const userValues = { "weather:favorites": "favorite fixture", "weather:last-place": "last place fixture", "weather:theme": "dark", "weather:lang": "tr" };
  for (const [key, value] of Object.entries(userValues)) storage.setItem(key, value);

  assert.equal(readFavWeatherCache().size, 0);
  assert.equal(storage.getItem("weather:weatherapi:favorites-weather"), null);
  for (const [key, value] of Object.entries(userValues)) assert.equal(storage.getItem(key), value);
});
