import { setLang } from "../src/i18n/ui.ts";
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
const originalNow = Date.now;
const stamp = (offset = 0) => new Date(NOW + offset).toISOString();
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
  Date.now = () => NOW;
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
});

afterEach(() => {
  Date.now = originalNow;
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
    sourceFetchedAt: "2099-07-15T12:00:00.000Z", savedAt: "2099-07-15T12:00:00.000Z",
  };

  writeFavWeatherCache(new Map([[7, entry]]));

  assert.deepEqual(readFavWeatherCache().get(7), entry);
});

test("detects fresh, expired and invalid cache entries", () => {
  const now = Date.parse("2099-07-15T12:00:00.000Z");
  const entry = (savedAt: string): FavWeatherEntry => ({ temp: 18, code: 2, isDay: true, sourceFetchedAt: savedAt, savedAt, snapshotVersion: 1 });

  assert.equal(isFavWeatherStale(entry(new Date(now - (FAV_WEATHER_TTL_MIN - 1) * 60_000).toISOString()), now), false);
  assert.equal(isFavWeatherStale(entry(new Date(now - (FAV_WEATHER_TTL_MIN + 1) * 60_000).toISOString()), now), true);
  assert.equal(isFavWeatherStale(entry("invalid"), now), true);
  assert.equal(isFavWeatherStale(undefined, now), true);
});

test("treats corrupted localStorage data as an empty cache", () => {
  storage.setItem(CACHE_KEY, "{not-json");

  assert.equal(readFavWeatherCache().size, 0);
});

test("legacy local savedAt cannot establish provider age", () => {
  storage.setItem(CACHE_KEY, JSON.stringify({ 7: { temp: 17, code: 3, savedAt: stamp() } }));
  assert.equal(readFavWeatherCache().size, 0);
  assert.deepEqual(JSON.parse(storage.getItem(CACHE_KEY)!), {});
});

test("a new snapshot clears unconfirmed optional values instead of keeping older values", () => {
  writeFavWeatherCache(new Map([[7, {
    temp: 17,
    code: 3,
    isDay: true,
    rainChance: 48,
    hasAlert: true,
    sourceFetchedAt: "2099-07-15T12:00:00.000Z", savedAt: "2099-07-15T12:00:00.000Z",
  }]]));

  cacheFavoriteWeather(7, { sourceFetchedAt: stamp(), temp: 20, code: 2, isDay: false }, "2099-07-15T12:05:00.000Z");

  const updated = readFavWeatherCache().get(7);
  assert.equal(updated?.temp, 20);
  assert.equal(updated?.code, 2);
  assert.equal(updated?.isDay, false);
  assert.equal(updated?.rainChance, null);
  assert.equal(updated?.hasAlert, false);
  assert.equal(updated?.savedAt, stamp());
  assert.equal(updated?.snapshotVersion, 1);
});

// ── Sofortige Werte fuer einen neu hinzugefuegten Favoriten ────────────────

const NOW = Date.parse("2099-07-15T12:00:00.000Z");

function forecastFixture(overrides: Record<string, unknown> = {}): Forecast {
  return {
    sourceFetchedAt: stamp(),
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
    sourceFetchedAt: stamp(),
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

  const mirror = mirrorForNewFavorite(forecastFixture({ sourceFetchedAt: updatedAt }), updatedAt, NOW);

  assert.equal(mirror.needsFetch, false, "kein zusaetzlicher Providerabruf bei frischen Daten");
  assert.equal(mirror.entry?.temp, 21.4);
  assert.equal(mirror.entry?.savedAt, updatedAt, "der echte Stand, nicht jetzt");
});

test("ein veralteter Stand wird zwar gezeigt, loest aber das Nachladen aus", () => {
  // Quelle darf auch der Forecast-Cache sein (Sofortanzeige "Stand HH:MM").
  // Der Chip zeigt sofort etwas, der Wert wird aber nicht als frisch verkauft.
  const updatedAt = new Date(NOW - (FAV_WEATHER_TTL_MIN + 1) * 60_000).toISOString();

  const mirror = mirrorForNewFavorite(forecastFixture({ sourceFetchedAt: updatedAt }), updatedAt, NOW);

  assert.equal(mirror.entry?.savedAt, updatedAt);
  assert.equal(mirror.needsFetch, true);
});

test("ohne verwertbare Daten bleibt der bestehende Abrufpfad zustaendig", () => {
  assert.deepEqual(mirrorForNewFavorite(null, new Date(NOW).toISOString(), NOW), { entry: null, needsFetch: true });
  assert.deepEqual(mirrorForNewFavorite(forecastFixture({ sourceFetchedAt: undefined }), "", NOW), { entry: null, needsFetch: true });
  assert.deepEqual(mirrorForNewFavorite(forecastFixture({ sourceFetchedAt: "kein-datum" }), "kein-datum", NOW), { entry: null, needsFetch: true });
});

test("der gespiegelte Eintrag landet mit dem echten Stand im Cache", () => {
  const updatedAt = new Date(NOW - 120_000).toISOString();
  const mirror = mirrorForNewFavorite(forecastFixture({ sourceFetchedAt: updatedAt }), updatedAt, NOW);

  cacheFavoriteWeather(7, mirror.entry!, mirror.entry!.savedAt);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4,
    code: 61,
    isDay: true,
    rainChance: 64,
    hasAlert: false,
    sourceFetchedAt: updatedAt, savedAt: updatedAt,
    snapshotVersion: 1,
  });
  assert.equal(isFavWeatherStale(readFavWeatherCache().get(7), NOW), false);
});

test("without provider provenance no timestamp is invented", () => {

  cacheFavoriteWeather(7, { temp: 20, code: 2, isDay: false });

  assert.equal(readFavWeatherCache().get(7), undefined);
});

test("[REGRESSION A2] refresh preserves fresh rain chance and alert status", async () => {
  writeFavWeatherCache(new Map([[7, {
    temp: 15,
    code: 3,
    isDay: true,
    rainChance: 5,
    hasAlert: false,
    sourceFetchedAt: "2000-01-01T00:00:00.000Z", savedAt: "2000-01-01T00:00:00.000Z",
  }]]));
  globalThis.fetch = async () => Response.json([{
    id: 7,
    sourceFetchedAt: stamp(),
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
const OLD_STAMP = "2099-07-15T11:40:00.000Z";
const NEW_STAMP = "2099-07-15T12:00:00.000Z";

function seedOldSnapshot(): void {
  writeFavWeatherCache(new Map([[7, {
    temp: 15, code: 3, isDay: false, rainChance: 90, hasAlert: true, sourceFetchedAt: OLD_STAMP, savedAt: OLD_STAMP,
  }]]));
}

test("A: full forecast with missing optional fields cannot redate older rain or alerts", () => {
  seedOldSnapshot();
  const forecast = forecastFixture({ daily: [], alerts: undefined });
  globalThis.fetch = async () => { throw new Error("snapshot mirroring must not fetch"); };

  cacheFavoriteForecast(7, forecast, NEW_STAMP);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4, code: 61, isDay: true, rainChance: null, hasAlert: false,
    sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1,
  });
});

test("B/C: full forecast replaces all values together, including zero rain and cleared alert", () => {
  seedOldSnapshot();
  const forecast = forecastFixture({ daily: [{ precipitationProbabilityMax: 0 }] });

  cacheFavoriteForecast(7, forecast, NEW_STAMP);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4, code: 61, isDay: true, rainChance: 0, hasAlert: false,
    sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1,
  });
});

test("D: full forecast adds newly available rain and alerts to a legacy entry", () => {
  storage.setItem(CACHE_KEY, JSON.stringify({ 7: { temp: 15, code: 3, sourceFetchedAt: OLD_STAMP, savedAt: OLD_STAMP } }));
  const forecast = forecastFixture({ alerts: [{ event: "Wind", headline: "Wind", expires: null }] });

  cacheFavoriteForecast(7, forecast, NEW_STAMP);

  assert.deepEqual(readFavWeatherCache().get(7), {
    temp: 21.4, code: 61, isDay: true, rainChance: 64, hasAlert: true,
    sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1,
  });
});

test("legacy snapshotVersion without source time is discarded", () => {
  storage.setItem(CACHE_KEY, JSON.stringify({ 7: {
    temp: 15, code: 3, isDay: false, rainChance: 90, hasAlert: true, savedAt: NEW_STAMP, snapshotVersion: 1,
  } }));
  assert.equal(readFavWeatherCache().size, 0);
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
      return Response.json([{ id: 7, sourceFetchedAt: stamp(), temp: 20, code: 2, isDay: true, ...optional }]);
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
  globalThis.fetch = async () => Response.json([{ id: 8, sourceFetchedAt: stamp(), temp: 20, code: 2, isDay: true, rainChance: 10, hasAlert: false }]);

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
  replies[1](Response.json([{ id: 7, sourceFetchedAt: stamp(), temp: 22, code: 2, isDay: true }]));
  await newer;
  const newerStamp = readFavWeatherCache().get(7)?.savedAt;
  replies[0](Response.json([{ id: 7, sourceFetchedAt: stamp(), temp: 11, code: 3, isDay: true }]));
  await older;

  assert.equal(readFavWeatherCache().get(7)?.temp, 22);
  assert.equal(readFavWeatherCache().get(7)?.savedAt, newerStamp);
});

test("an older batch preserves newly added and directly refreshed favorite entries", async () => {
  let reply!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>((resolve) => { reply = resolve; });

  const older = refreshFavoritesWeather([PLACE]);
  cacheFavoriteWeather(7, { sourceFetchedAt: stamp(), temp: 25, code: 2, isDay: true });
  cacheFavoriteWeather(8, { sourceFetchedAt: stamp(), temp: 18, code: 3, isDay: true });
  reply(Response.json([{ id: 7, sourceFetchedAt: stamp(), temp: 11, code: 3, isDay: true }]));
  await older;

  assert.equal(readFavWeatherCache().get(7)?.temp, 25);
  assert.equal(readFavWeatherCache().get(8)?.temp, 18);
});

test("removing a favorite invalidates its pending batch even without a cache entry", async () => {
  let reply!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>((resolve) => { reply = resolve; });

  const older = refreshFavoritesWeather([PLACE]);
  pruneFavWeatherCache([]);
  reply(Response.json([{ id: 7, sourceFetchedAt: stamp(), temp: 11, code: 3, isDay: true }]));
  await older;

  assert.equal(readFavWeatherCache().has(7), false);
});

test("next expiry schedules both the 15 and 60 minute boundaries", () => {
  const entry: FavWeatherEntry = { temp: 20, code: 2, isDay: true, sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1 };
  const boundary = NOW + 15 * 60_000;

  assert.equal(nextFavWeatherExpiry([entry], NOW), boundary + 1);
  assert.equal(isFavWeatherStale(entry, boundary), false);
  assert.equal(isFavWeatherStale(entry, boundary + 1), true);
  assert.equal(nextFavWeatherExpiry([entry], boundary + 1), NOW + 60 * 60_000 + 1);
  assert.equal(nextFavWeatherExpiry([{ ...entry, sourceFetchedAt: undefined }], NOW), null);
  assert.equal(nextFavWeatherExpiry([{ ...entry, sourceFetchedAt: "invalid", savedAt: "invalid" }], NOW), null);
  assert.equal(nextFavWeatherExpiry([], NOW), null);
  assert.equal(nextFavWeatherExpiry([entry, { ...entry, sourceFetchedAt: new Date(NOW - 60_000).toISOString(), savedAt: new Date(NOW - 60_000).toISOString() }], NOW), boundary - 60_000 + 1);
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
    [7, { temp: 30, code: 3, isDay: true, rainChance: 0, hasAlert: true, sourceFetchedAt: OLD_STAMP, savedAt: OLD_STAMP, snapshotVersion: 1 }],
    [8, { temp: 20, code: 2, isDay: true, rainChance: 50, hasAlert: false, sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1 }],
  ]));

  assert.match(markup, /class="fav-row-sub fav-row-sub--status">Stand .* · älter ·/);
  assert.match(markup, /aria-label="[^"]*Stand .* · älter/);
  assert.doesNotMatch(markup, /Warnung vorhanden|triangle-alert/);
  assert.doesNotMatch(markup, /class="fav-compare"/);
  assert.match(markup, /30°/);
});

test("fresh comparisons stay available, then disappear with age without changing persisted values", () => {
  const weather = new Map<number, FavWeatherEntry>([
    [7, { temp: 30, code: 3, isDay: true, rainChance: 0, sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1 }],
    [8, { temp: 20, code: 2, isDay: true, rainChance: 50, sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1 }],
  ]);

  const fresh = renderFavoritesMarkup(weather);
  assert.match(fresh, /Wärmster Ort: <strong>Fixture City/);
  assert.match(fresh, /Geringste Regenchance: <strong>Fixture City/);
  assert.doesNotMatch(fresh, /Älterer Stand/);
  const aged = renderFavoritesMarkup(weather, NOW + 15 * 60_000 + 1);
  assert.doesNotMatch(aged, /class="fav-compare"/);
  assert.match(aged, /Stand .* · älter/);
  assert.equal(weather.get(7)?.savedAt, NEW_STAMP);
});

test("legacy values are not rendered even when passed directly to the component", () => {
  const markup = renderFavoritesMarkup(new Map([[7, {
    temp: 30, code: 3, isDay: true, rainChance: 0, savedAt: NEW_STAMP,
  }]]));
  assert.match(markup, /Keine aktuellen Wetterdaten/);
  assert.doesNotMatch(markup, /30°|0 % Regen|fav-row-wx-ico/);
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
    [7, { temp: 20, code: 3, isDay: true, rainChance: null, sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1 }],
    [8, { temp: 20, code: 2, isDay: true, rainChance: 50, sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1 }],
  ]));

  assert.doesNotMatch(markup, /Geringste Regenchance/);
  assert.match(markup, /class="fav-row-sub">Bedeckt<\/span>/);
  assert.match(markup, /class="fav-row-sub">Teilweise bewölkt · 50 % Regen<\/span>/);
});

test("old forecast-derived favorite weather is invalidated without deleting favorite identities or settings", () => {
  storage.setItem("weather:weatherapi:favorites-weather", JSON.stringify({ 7: { temp: 20, code: 3, isDay: true, rainChance: 0, sourceFetchedAt: NEW_STAMP, savedAt: NEW_STAMP, snapshotVersion: 1 } }));
  const userValues = { "weather:favorites": "favorite fixture", "weather:last-place": "last place fixture", "weather:theme": "dark", "weather:lang": "tr" };
  for (const [key, value] of Object.entries(userValues)) storage.setItem(key, value);

  assert.equal(readFavWeatherCache().size, 0);
  assert.equal(storage.getItem("weather:weatherapi:favorites-weather"), null);
  for (const [key, value] of Object.entries(userValues)) assert.equal(storage.getItem(key), value);
});

// F06: absolute Grenzen, keine lokale Neudatierung und keine Wiederbelebung.
for (const [minutes, extraMs, expected] of [[0, 0, "fresh"], [15, 0, "fresh"], [15, 1, "stale"], [60, 0, "stale"], [60, 1, "expired"], [4320, 0, "expired"]] as const) {
  test(`F06 snapshot at ${minutes} minutes + ${extraMs} ms is ${expected}`, () => {
    const entry: FavWeatherEntry = { sourceFetchedAt: stamp(), savedAt: stamp(), snapshotVersion: 1, temp: 31, code: 61, isDay: true, rainChance: 87, hasAlert: true };
    const now = NOW + minutes * 60_000 + extraMs;
    storage.setItem(CACHE_KEY, JSON.stringify({ 7: entry }));
    assert.equal(readFavWeatherCache(now).has(7), expected !== "expired");
    const html = renderFavoritesMarkup(new Map([[7, entry]]), now);
    assert.equal(html.includes("31°"), expected !== "expired");
    assert.equal(html.includes("87 % Regen"), expected !== "expired");
    assert.equal(html.includes("fav-row-wx-ico"), expected !== "expired");
    assert.equal(html.includes("triangle-alert"), expected === "fresh");
    assert.equal(html.includes("· älter"), expected === "stale");
    if (expected === "expired") assert.deepEqual(JSON.parse(storage.getItem(CACHE_KEY)!), {});
  });
}

test("F06 future, invalid and missing source time fail closed even with a fresh local savedAt", () => {
  for (const sourceFetchedAt of [stamp(1), "invalid", undefined]) {
    const entry = { sourceFetchedAt, savedAt: stamp(), snapshotVersion: 1 as const, temp: 31, code: 61, isDay: true };
    storage.setItem(CACHE_KEY, JSON.stringify({ 7: entry }));
    assert.equal(readFavWeatherCache(NOW).size, 0);
    assert.equal(mirrorForNewFavorite(forecastFixture({ sourceFetchedAt }), stamp(), NOW).entry, null);
    assert.doesNotMatch(renderFavoritesMarkup(new Map([[7, entry]])), /31°|fav-row-wx-ico/);
  }
});

test("F06 copy at minute 59 preserves original age and cannot be reused at minute 60 plus 1", () => {
  const sourceFetchedAt = stamp(-59 * 60_000);
  const forecast = forecastFixture({ sourceFetchedAt });
  const mirror = mirrorForNewFavorite(forecast, stamp(), NOW);
  assert.equal(mirror.entry?.sourceFetchedAt, sourceFetchedAt);
  assert.equal(mirror.entry?.savedAt, sourceFetchedAt);
  assert.equal(mirror.needsFetch, true);
  cacheFavoriteForecast(7, forecast, stamp(), NOW);
  assert.equal(readFavWeatherCache(NOW).get(7)?.sourceFetchedAt, sourceFetchedAt);
  assert.equal(readFavWeatherCache(NOW + 60_000 + 1).size, 0);
  assert.equal(mirrorForNewFavorite(forecast, stamp(), NOW + 60_000 + 1).entry, null);
});

test("F06 storage cleanup failure cannot expose expired values or delete favorite identities", () => {
  const entry = { sourceFetchedAt: stamp(-60 * 60_000 - 1), savedAt: stamp(), temp: 31, code: 61, isDay: true, hasAlert: true };
  storage.setItem(CACHE_KEY, JSON.stringify({ 7: entry }));
  storage.setItem("weather:favorites", JSON.stringify([PLACE]));
  storage.setItem = () => { throw new Error("storage blocked"); };
  assert.equal(readFavWeatherCache(NOW).size, 0);
  assert.match(storage.getItem(CACHE_KEY)!, /31/); // Kein falscher Löschbeweis.
  assert.doesNotMatch(renderFavoritesMarkup(new Map([[7, entry]])), /31°|triangle-alert/);
  assert.equal(JSON.parse(storage.getItem("weather:favorites")!)[0].id, 7);
});

test("F06 a failed request crossing 60 minutes cannot retain the old fallback", async () => {
  let now = NOW;
  const sourceFetchedAt = stamp(-59 * 60_000);
  cacheFavoriteWeather(7, { sourceFetchedAt, temp: 31, code: 61, isDay: true });
  globalThis.fetch = async () => { now += 60_000 + 1; throw new Error("provider failed"); };
  assert.equal((await refreshFavoritesWeather([PLACE], () => now)).size, 0);
});

test("F06 late expired provider response is discarded, a later online success restores weather", async () => {
  const sourceFetchedAt = stamp();
  globalThis.fetch = async () => Response.json([{ id: 7, sourceFetchedAt, temp: 31, code: 61, isDay: true }]);
  assert.equal((await refreshFavoritesWeather([PLACE], () => NOW + 60 * 60_000 + 1)).size, 0);
  globalThis.fetch = async () => Response.json([{ id: 7, sourceFetchedAt: stamp(61 * 60_000), temp: 22, code: 2, isDay: true }]);
  const restored = await refreshFavoritesWeather([PLACE], () => NOW + 61 * 60_000);
  assert.equal(restored.get(7)?.temp, 22);
});

test("F06 remove then readd or undo cannot accept the response from before removal", async () => {
  const replies: Array<(response: Response) => void> = [];
  globalThis.fetch = () => new Promise<Response>((resolve) => replies.push(resolve));
  const removedRequest = refreshFavoritesWeather([PLACE]);
  pruneFavWeatherCache([]);
  const restoredRequest = refreshFavoritesWeather([PLACE]);
  replies[0](Response.json([{ id: 7, sourceFetchedAt: stamp(), temp: 31, code: 61, isDay: true }]));
  await removedRequest;
  assert.equal(readFavWeatherCache().size, 0);
  replies[1](Response.json([{ id: 7, sourceFetchedAt: stamp(), temp: 22, code: 2, isDay: true }]));
  await restoredRequest;
  assert.equal(readFavWeatherCache().get(7)?.temp, 22);
});

test("F06 different favorites expire independently and never borrow another place's age", () => {
  const entry = { temp: 31, code: 61, isDay: true, hasAlert: true, snapshotVersion: 1 as const };
  storage.setItem(CACHE_KEY, JSON.stringify({
    7: { ...entry, sourceFetchedAt: stamp(-60 * 60_000 - 1), savedAt: stamp() },
    8: { ...entry, sourceFetchedAt: stamp(-20 * 60_000), savedAt: stamp() },
    9: { ...entry, sourceFetchedAt: stamp(), savedAt: stamp() },
  }));
  const cache = readFavWeatherCache(NOW);
  assert.deepEqual([...cache.keys()], [8, 9]);
  assert.equal(isFavWeatherStale(cache.get(8), NOW), true);
  assert.equal(isFavWeatherStale(cache.get(9), NOW), false);
});


test("F06 age and missing data labels render in DE EN TR including the offline state", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: {}, querySelectorAll: () => [], dispatchEvent: () => {} } });
  try {
    for (const [lang, stale, offline] of [["de", "älter", "Offline"], ["en", "older data", "Offline"], ["tr", "eski veriler", "Çevrimdışı"]] as const) {
      setLang(lang);
      const entry = { sourceFetchedAt: OLD_STAMP, savedAt: OLD_STAMP, temp: 31, code: 61, isDay: true, snapshotVersion: 1 as const };
      assert.ok(renderFavoritesMarkup(new Map([[7, entry]])).includes(stale));
      const el = { innerHTML: "", closest: () => null, querySelectorAll: () => [] };
      renderFavoritesList(el as unknown as HTMLElement, [PLACE], 7, { offline: true, onSelect() {}, onRemove() {}, onMove() {} }, new Map(), NOW);
      assert.ok(el.innerHTML.includes(offline));
      assert.doesNotMatch(el.innerHTML, /fav-row-wx-ico|triangle-alert|31°/);
    }
  } finally {
    setLang("de");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete (globalThis as { document?: unknown }).document;
  }
});
