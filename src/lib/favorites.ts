import { GEO_PLACE_ID, type Place } from "./geocoding";

const KEY = "weather:favorites";
export const MAX_FAVORITES = 5;

export function isPlace(value: unknown): value is Place {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const place = value as Partial<Place>;
  return (
    typeof place.id === "number" && Number.isFinite(place.id) &&
    (place.providerId === undefined ||
      (Number.isSafeInteger(place.providerId) && place.providerId > 0 && place.providerId === place.id)) &&
    typeof place.name === "string" && place.name.trim() !== "" &&
    typeof place.latitude === "number" && Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90 &&
    typeof place.longitude === "number" && Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180 &&
    typeof place.country === "string" &&
    typeof place.countryCode === "string" &&
    (place.admin1 === undefined || typeof place.admin1 === "string")
  );
}

function readFavorites(): { list: Place[]; canWrite: boolean; needsPrune: boolean } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return { list: [], canWrite: false, needsPrune: false };
    const valid = value.filter(isPlace);
    const list = valid.filter((place) => place.id !== GEO_PLACE_ID).slice(0, MAX_FAVORITES);
    return { list, canWrite: valid.length === value.length, needsPrune: list.length !== valid.length };
  } catch {
    return { list: [], canWrite: false, needsPrune: false };
  }
}

export function getFavorites(): Place[] {
  return readFavorites().list;
}

// Nur ein verlässlich gelesener Stand darf Grundlage einer Änderung sein.
export function readFavoritesForMutation(): Place[] | null {
  const result = readFavorites();
  return result.canWrite ? result.list : null;
}

export function isFavorite(id: number): boolean {
  return getFavorites().some((p) => p.id === id);
}

export function addFavorite(place: Place): Place[] | null {
  // Geolocation-Ort nie persistieren (Datenschutzzusage); UI blendet den
  // Stern bereits aus, das hier ist die zweite Verteidigungslinie.
  if (place.id === GEO_PLACE_ID) return getFavorites();
  const current = readFavoritesForMutation();
  if (current === null) return null;
  if (!current.some((p) => p.id === place.id) && current.length >= MAX_FAVORITES) return current;
  const next = [...current.filter((p) => p.id !== place.id), place].slice(0, MAX_FAVORITES);
  return persist(next) ? next : null;
}

// Entfernt Altlasten: früher konnte "Mein Standort" favorisiert werden und
// lag damit samt Koordinaten in localStorage. Einmal beim App-Start aufrufen.
export function pruneGeoFavorites(): void {
  const result = readFavorites();
  if (result.canWrite && result.needsPrune) persist(result.list);
}

export function removeFavorite(id: number): Place[] | null {
  const current = readFavoritesForMutation();
  if (current === null) return null;
  const next = current.filter((p) => p.id !== id);
  return persist(next) ? next : null;
}

// Fügt einen Favoriten an einer bestimmten Position wieder ein (Rückgängig nach
// Entfernen: die alte Reihenfolge bleibt erhalten). Gleiche Guards wie
// addFavorite: Geo-Ort nie, Limit respektieren; Index defensiv klemmen.
export function insertFavorite(place: Place, index: number): Place[] | null {
  if (place.id === GEO_PLACE_ID) return getFavorites();
  const saved = readFavoritesForMutation();
  if (saved === null) return null;
  const current = saved.filter((p) => p.id !== place.id);
  if (current.length >= MAX_FAVORITES) return current;
  const i = Math.max(0, Math.min(index, current.length));
  const next = [...current.slice(0, i), place, ...current.slice(i)];
  return persist(next) ? next : null;
}

// Verschiebt einen Favoriten um eine Position (Tausch mit dem Nachbarn). Die
// Reihenfolge IST die Array-Reihenfolge, daher genügt ein Swap + persist. Liest
// frisch (mehrfache schnelle Klicks bleiben konsistent). Defensive: id unbekannt
// oder schon am Rand → unverändert, kein Out-of-bounds.
export function moveFavorite(id: number, dir: "up" | "down"): Place[] | null {
  const list = readFavoritesForMutation();
  if (list === null) return null;
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) return list;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return persist(next) ? next : null;
}

function persist(list: Place[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
