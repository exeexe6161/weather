import { GEO_PLACE_ID, type Place } from "./geocoding";

const KEY = "weather:favorites";
export const MAX_FAVORITES = 5;

export function getFavorites(): Place[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.slice(0, MAX_FAVORITES) as Place[] : [];
  } catch {
    return [];
  }
}

export function isFavorite(id: number): boolean {
  return getFavorites().some((p) => p.id === id);
}

export function addFavorite(place: Place): Place[] {
  // Geolocation-Ort nie persistieren (Datenschutzzusage); UI blendet den
  // Stern bereits aus, das hier ist die zweite Verteidigungslinie.
  if (place.id === GEO_PLACE_ID) return getFavorites();
  const current = getFavorites();
  if (!current.some((p) => p.id === place.id) && current.length >= MAX_FAVORITES) return current;
  const next = [...current.filter((p) => p.id !== place.id), place].slice(0, MAX_FAVORITES);
  persist(next);
  return next;
}

// Entfernt Altlasten: früher konnte "Mein Standort" favorisiert werden und
// lag damit samt Koordinaten in localStorage. Einmal beim App-Start aufrufen.
export function pruneGeoFavorites(): void {
  if (typeof localStorage === "undefined") return;
  let all: Place[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    all = Array.isArray(value) ? value as Place[] : [];
  } catch {}
  const next = all.filter((p) => p.id !== GEO_PLACE_ID).slice(0, MAX_FAVORITES);
  if (next.length !== all.length) persist(next);
}

export function removeFavorite(id: number): Place[] {
  const next = getFavorites().filter((p) => p.id !== id);
  persist(next);
  return next;
}

// Verschiebt einen Favoriten um eine Position (Tausch mit dem Nachbarn). Die
// Reihenfolge IST die Array-Reihenfolge, daher genügt ein Swap + persist. Liest
// frisch (mehrfache schnelle Klicks bleiben konsistent). Defensive: id unbekannt
// oder schon am Rand → unverändert, kein Out-of-bounds.
export function moveFavorite(id: number, dir: "up" | "down"): Place[] {
  const list = getFavorites();
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) return list;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  persist(next);
  return next;
}

function persist(list: Place[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
}
