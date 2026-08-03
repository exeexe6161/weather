import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { MAX_FAVORITES, addFavorite, getFavorites, insertFavorite, removeFavorite } from "../src/lib/favorites.ts";
import { GEO_PLACE_ID, type Place } from "../src/lib/geocoding.ts";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

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
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
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
  assert.equal(next.some((p) => p.id === removed.id), false);
  assert.equal(getFavorites().some((p) => p.id === removed.id), false);
  assert.equal(getFavorites().length, MAX_FAVORITES);
});

test("Undo stellt die alte Position wieder her, solange Platz ist", () => {
  fillToLimit();
  const removed = place(3, "Ort 3");
  removeFavorite(removed.id);

  const next = insertFavorite(removed, 2);

  assert.equal(next.some((p) => p.id === removed.id), true);
  assert.deepEqual(
    getFavorites().map((p) => p.id),
    [1, 2, 3, 4, 5],
    "der Ort muss an seiner alten Stelle stehen, nicht am Ende"
  );
});

test("insertFavorite klemmt einen Index ausserhalb der Liste", () => {
  addFavorite(place(1, "Ort 1"));
  insertFavorite(place(2, "Ort 2"), 99);
  assert.deepEqual(getFavorites().map((p) => p.id), [1, 2]);
});

test("insertFavorite nimmt den Geo Ort nie auf", () => {
  // Datenschutzzusage: der Standort darf nicht persistiert werden.
  const next = insertFavorite(place(GEO_PLACE_ID, "Mein Standort"), 0);
  assert.equal(next.some((p) => p.id === GEO_PLACE_ID), false);
  assert.equal(getFavorites().length, 0);
});
