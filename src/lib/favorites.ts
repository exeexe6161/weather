import type { Place } from "./geocoding";

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
  const next = [...getFavorites().filter((p) => p.id !== place.id), place];
  persist(next);
  return next;
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
