import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { MAX_FAVORITES, addFavorite, getFavorites, insertFavorite, moveFavorite, removeFavorite } from "../src/lib/favorites.ts";
import { GEO_PLACE_ID, type Place } from "../src/lib/geocoding.ts";
import { findLocalProviderPlace, prepareStoredStart, readStoredLastPlace, removeFavoriteAndPruneWeather } from "../src/app.ts";
import { readFavWeatherCache, writeFavWeatherCache } from "../src/lib/favoritesWeather.ts";
import { readPlaceLink } from "../src/lib/linkResolution.ts";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

class MemoryStorage {
  private values = new Map<string, string>();
  failReadFor = new Set<string>();
  failWriteFor = new Set<string>();
  failRemoveFor = new Set<string>();
  writes = 0;

  getItem(key: string): string | null {
    if (this.failReadFor.has(key)) throw new Error("Storage read denied");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWriteFor.has(key)) throw new Error("Storage write denied");
    this.writes++;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failRemoveFor.has(key)) throw new Error("Storage remove denied");
    this.values.delete(key);
  }

  peek(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

let storage: MemoryStorage;

function place(id: number, name: string): Place {
  return {
    id,
    name,
    latitude: 52.52,
    longitude: 13.405,
    country: "Deutschland",
    countryCode: "DE",
  };
}

function fillToLimit(): void {
  for (let i = 1; i <= MAX_FAVORITES; i++) addFavorite(place(i, `Ort ${i}`));
}

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
});

test("optional legacy removal failure does not stop startup storage preparation", () => {
  storage.failRemoveFor.add("weather:forecast-days");
  assert.doesNotThrow(() => prepareStoredStart());
});

test("old geolocation last place stays inactive when its removal fails", () => {
  storage.setItem("weather:last-place", JSON.stringify(place(GEO_PLACE_ID, "Mein Standort")));
  storage.failRemoveFor.add("weather:last-place");
  assert.equal(prepareStoredStart(), null);
  assert.notEqual(storage.peek("weather:last-place"), null);
});

test("old geolocation favorite stays hidden when startup cleanup write fails", () => {
  storage.setItem("weather:favorites", JSON.stringify([place(GEO_PLACE_ID, "Mein Standort"), place(2, "Ort 2")]));
  storage.failWriteFor.add("weather:favorites");
  assert.doesNotThrow(() => prepareStoredStart());
  assert.deepEqual(getFavorites().map((favorite) => favorite.id), [2]);
  assert.equal(JSON.parse(storage.peek("weather:favorites") ?? "[]").length, 2);
});

test("valid last place is restored, invalid JSON and wrong shapes are ignored", () => {
  storage.setItem("weather:last-place", JSON.stringify(place(7, "Ort 7")));
  assert.equal(readStoredLastPlace()?.id, 7);
  storage.setItem("weather:last-place", "{broken");
  assert.equal(readStoredLastPlace(), null);
  storage.setItem("weather:last-place", "{}");
  assert.equal(readStoredLastPlace(), null);
  storage.setItem("weather:last-place", JSON.stringify({ id: 7, name: "Ort 7", latitude: 52.52 }));
  assert.equal(readStoredLastPlace(), null);
});

test("provider ID survives existing favorite storage and old places stay readable", () => {
  const withProvider = { ...place(17, "İstanbul"), providerId: 17 };
  const legacy = place(28, "Berlin");
  assert.deepEqual(addFavorite(withProvider)?.[0], withProvider);
  assert.deepEqual(addFavorite(legacy)?.map((item) => item.providerId), [17, undefined]);
  assert.deepEqual(getFavorites(), [withProvider, legacy]);
  storage.setItem("weather:last-place", JSON.stringify(withProvider));
  assert.deepEqual(readStoredLastPlace(), withProvider);
  storage.setItem("weather:last-place", JSON.stringify(legacy));
  assert.deepEqual(readStoredLastPlace(), legacy);
});

test("provider link finds the saved last place before a same named favorite", () => {
  const last = { ...place(17, "Köln"), providerId: 17, admin1: "Nordrhein Westfalen" };
  const other = { ...place(28, "Köln"), providerId: 28 };
  storage.setItem("weather:last-place", JSON.stringify(last));
  addFavorite(other);
  const link = readPlaceLink("?stadt=K%C3%B6ln&placeId=17");
  assert.deepEqual(findLocalProviderPlace(link, readStoredLastPlace(), getFavorites()), last);
});

test("provider link finds a saved favorite when the last place has another ID", () => {
  const last = { ...place(28, "Köln"), providerId: 28 };
  const favorite = { ...place(17, "Köln"), providerId: 17 };
  storage.setItem("weather:last-place", JSON.stringify(last));
  addFavorite(favorite);
  const link = readPlaceLink("?stadt=K%C3%B6ln&placeId=17");
  assert.deepEqual(findLocalProviderPlace(link, readStoredLastPlace(), getFavorites()), favorite);
});

test("the complete last place wins when last place and favorite share the provider ID", () => {
  const last = { ...place(17, "Köln"), providerId: 17, admin1: "Letzter Ort" };
  const favorite = { ...place(17, "Köln"), providerId: 17, admin1: "Favorit" };
  storage.setItem("weather:last-place", JSON.stringify(last));
  addFavorite(favorite);
  assert.deepEqual(
    findLocalProviderPlace(readPlaceLink("?stadt=K%C3%B6ln&placeId=17"), readStoredLastPlace(), getFavorites()),
    last,
  );
});

test("same names, hash IDs and legacy links never produce a local provider match", () => {
  const other = { ...place(28, "Köln"), providerId: 28 };
  storage.setItem("weather:last-place", JSON.stringify(other));
  addFavorite(place(17, "Köln"));
  const last = readStoredLastPlace();
  const favorites = getFavorites();
  assert.equal(findLocalProviderPlace(readPlaceLink("?stadt=K%C3%B6ln&placeId=17"), last, favorites), null);
  assert.equal(findLocalProviderPlace(readPlaceLink("?stadt=K%C3%B6ln"), last, favorites), null);
  assert.equal(findLocalProviderPlace(readPlaceLink(""), last, favorites), null);
  assert.equal(findLocalProviderPlace(readPlaceLink("?stadt=K%C3%B6ln&placeId=invalid"), last, favorites), null);
});

test("a failed favorites read cannot overwrite the stored list on add or remove", () => {
  const saved = JSON.stringify([place(1, "Ort 1"), place(2, "Ort 2")]);
  storage.setItem("weather:favorites", saved);
  const savedAt = "2099-07-15T12:00:00.000Z";
  writeFavWeatherCache(new Map([[1, { temp: 18, code: 1, isDay: true, savedAt }]]));
  storage.failReadFor.add("weather:favorites");
  const writes = storage.writes;
  assert.equal(addFavorite(place(3, "Ort 3")), null);
  assert.equal(removeFavoriteAndPruneWeather(1), null);
  assert.equal(storage.writes, writes);
  assert.equal(storage.peek("weather:favorites"), saved);
  assert.deepEqual([...readFavWeatherCache().keys()], [1]);
});

test("malformed favorites JSON is not treated as an empty list for mutations", () => {
  storage.setItem("weather:favorites", "{broken");
  const writes = storage.writes;
  assert.deepEqual(getFavorites(), []);
  assert.equal(addFavorite(place(1, "Ort 1")), null);
  assert.equal(storage.writes, writes);
  assert.equal(storage.peek("weather:favorites"), "{broken");
});

test("a failed favorites read cannot overwrite the list on undo or move", () => {
  const saved = JSON.stringify([place(1, "Ort 1"), place(2, "Ort 2")]);
  storage.setItem("weather:favorites", saved);
  storage.failReadFor.add("weather:favorites");
  const writes = storage.writes;
  assert.equal(insertFavorite(place(3, "Ort 3"), 1), null);
  assert.equal(moveFavorite(1, "down"), null);
  assert.equal(storage.writes, writes);
  assert.equal(storage.peek("weather:favorites"), saved);
});

test("failed favorites writes report failure and leave favorite weather untouched", () => {
  storage.setItem("weather:favorites", JSON.stringify([place(1, "Ort 1")]));
  const savedAt = "2099-07-15T12:00:00.000Z";
  writeFavWeatherCache(new Map([[1, { temp: 18, code: 1, isDay: true, savedAt }]]));
  storage.failWriteFor.add("weather:favorites");
  assert.equal(addFavorite(place(2, "Ort 2")), null);
  assert.equal(removeFavoriteAndPruneWeather(1), null);
  assert.deepEqual(getFavorites().map((favorite) => favorite.id), [1]);
  assert.deepEqual([...readFavWeatherCache().keys()], [1]);
});

test("a throwing localStorage property falls back without stopping startup", () => {
  Object.defineProperty(globalThis, "localStorage", {
    get() { throw new Error("Storage access denied"); },
    configurable: true,
  });
  assert.doesNotThrow(() => prepareStoredStart());
  assert.equal(getFavorites().length, 0);
});

after(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("Favoritenlimit verhindert eine stille Undo Wiedereinfuegung", () => {
  // Der Ablauf des Befundes: Ort entfernen, danach einen anderen hinzufügen,
  // dann Rückgängig. Die Liste ist wieder voll, insertFavorite fügt nicht ein.
  fillToLimit();
  const removed = place(3, "Ort 3");
  removeFavorite(removed.id);
  addFavorite(place(99, "Neuer Ort"));
  assert.equal(getFavorites().length, MAX_FAVORITES);

  const next = insertFavorite(removed, 2);

  // Genau diese Prüfung nutzt der Undo-Rückruf in app.ts, um den Fehlschlag zu
  // melden, statt ihn lautlos zu verschlucken.
  assert.equal(next?.some((p) => p.id === removed.id), false);
  assert.equal(getFavorites().some((p) => p.id === removed.id), false);
  assert.equal(getFavorites().length, MAX_FAVORITES);
});

test("Undo stellt die alte Position wieder her, solange Platz ist", () => {
  fillToLimit();
  const removed = place(3, "Ort 3");
  removeFavorite(removed.id);

  const next = insertFavorite(removed, 2);

  assert.equal(next?.some((p) => p.id === removed.id), true);
  assert.deepEqual(
    getFavorites().map((p) => p.id),
    [1, 2, 3, 4, 5],
    "der Ort muss an seiner alten Stelle stehen, nicht am Ende"
  );
});

test("gemeinsamer Entfernenpfad bereinigt nur das zugehörige Favoritenwetter", () => {
  addFavorite(place(1, "Ort 1"));
  addFavorite(place(2, "Ort 2"));
  const savedAt = "2099-07-15T12:00:00.000Z";
  writeFavWeatherCache(new Map([
    [1, { temp: 18, code: 1, isDay: true, savedAt }],
    [2, { temp: 20, code: 2, isDay: true, savedAt }],
  ]));
  localStorage.setItem("weather:lang", "tr");
  localStorage.setItem("theme", "dark");

  removeFavoriteAndPruneWeather(1);

  assert.deepEqual(getFavorites().map((favorite) => favorite.id), [2]);
  assert.deepEqual([...readFavWeatherCache().keys()], [2]);
  assert.equal(readFavWeatherCache().get(2)?.temp, 20);
  assert.equal(localStorage.getItem("weather:lang"), "tr");
  assert.equal(localStorage.getItem("theme"), "dark");

  removeFavoriteAndPruneWeather(2);
  assert.deepEqual(getFavorites(), []);
  assert.deepEqual([...readFavWeatherCache().keys()], []);
  assert.equal(localStorage.getItem("weather:lang"), "tr");
  assert.equal(localStorage.getItem("theme"), "dark");
});

test("insertFavorite klemmt einen Index ausserhalb der Liste", () => {
  addFavorite(place(1, "Ort 1"));
  insertFavorite(place(2, "Ort 2"), 99);
  assert.deepEqual(getFavorites().map((p) => p.id), [1, 2]);
});

test("insertFavorite nimmt den Geo Ort nie auf", () => {
  // Datenschutzzusage: der Standort darf nicht persistiert werden.
  const next = insertFavorite(place(GEO_PLACE_ID, "Mein Standort"), 0);
  assert.equal(next?.some((p) => p.id === GEO_PLACE_ID), false);
  assert.equal(getFavorites().length, 0);
});
