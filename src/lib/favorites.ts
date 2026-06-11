import { GEO_PLACE_ID, type Place } from "./geocoding";

const KEY = "weather:favorites";

export function getFavorites(): Place[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
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
  const next = [...getFavorites().filter((p) => p.id !== place.id), place];
  persist(next);
  return next;
}

// Entfernt Altlasten: früher konnte "Mein Standort" favorisiert werden und
// lag damit samt Koordinaten in localStorage. Einmal beim App-Start aufrufen.
export function pruneGeoFavorites(): void {
  const all = getFavorites();
  const next = all.filter((p) => p.id !== GEO_PLACE_ID);
  if (next.length !== all.length) persist(next);
}

export function removeFavorite(id: number): Place[] {
  const next = getFavorites().filter((p) => p.id !== id);
  persist(next);
  return next;
}

function persist(list: Place[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
}
