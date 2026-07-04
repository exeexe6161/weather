// Favoriten-Wetter: schlanke Datenschicht für das Favoriten-Mini-Dashboard.
// STRIKT getrennt von fetchWeather/normalize (weather.ts) und favorites.ts:
// eigener Endpoint-Aufbau (nur current=temperature_2m,weather_code, kein
// hourly/daily/past_days), eigener localStorage-Cache mit eigener TTL.
import { fetchWithTimeout, apiUrl } from "./http";
import type { Place } from "./geocoding";

// Eigener WeatherAPI Cache Key, unabhängig von der reinen Favoriten Ortsliste
// und dem Einzelort Vollforecast.
const FAV_WEATHER_CACHE_KEY = "weather:weatherapi:favorites-weather";
const LEGACY_FAV_WEATHER_CACHE_KEY = "weather:favorites-weather";

// Ab diesem Alter gilt ein Cache-Eintrag als veraltet und wird nachgeladen.
// current-Werte ändern sich selten schneller; schont zugleich das Rate-Limit.
export const FAV_WEATHER_TTL_MIN = 15;

// Schlankes Ergebnis pro Ort (nur was ein Chip braucht).
export interface FavWeather {
  temp: number;
  code: number;
  isDay: boolean; // für die Tag-/Nacht-Variante des Icons (pickIcon)
}

// Cache-Eintrag = FavWeather plus Zeitstempel für die TTL-Prüfung.
export interface FavWeatherEntry extends FavWeather {
  savedAt: string; // ISO-Zeit
}

// ── A) Schlanker Multi-Location-Abruf ──────────────────────────────────────
// Holt das aktuelle Wetter ALLER übergebenen Orte über die eigene Server
// Route /api/favorites-weather (dahinter maximal fünf schlanke WeatherAPI
// Current Requests, mit serverseitigem Cache). Gibt
// eine Map place.id → {temp, code, isDay} zurück. Berührt fetchWeather nicht.
export async function fetchFavoritesWeather(places: Place[]): Promise<Map<number, FavWeather>> {
  const out = new Map<number, FavWeather>();
  if (places.length === 0) return out; // leere Liste → kein Call

  const payload = places.map((p) => ({ id: p.id, latitude: p.latitude, longitude: p.longitude }));
  const params = new URLSearchParams({ places: JSON.stringify(payload) });
  const res = await fetchWithTimeout(apiUrl(`/api/favorites-weather?${params}`));
  if (!res.ok) throw new Error(`Favorites weather request failed: ${res.status}`);
  const data: Array<{ id: number; temp: number; code: number; isDay: boolean }> = await res.json();
  for (const entry of data) {
    out.set(entry.id, { temp: entry.temp, code: entry.code, isDay: entry.isDay });
  }
  return out;
}

// ── B) Cache mit TTL ───────────────────────────────────────────────────────
// Liest den Favoriten-Wetter-Cache aus localStorage. Korrupter/fremder Inhalt
// wird als leer behandelt (nie ein Crash). Record placeId → Eintrag.
export function readFavWeatherCache(): Map<number, FavWeatherEntry> {
  const map = new Map<number, FavWeatherEntry>();
  if (typeof localStorage === "undefined") return map;
  try {
    localStorage.removeItem(LEGACY_FAV_WEATHER_CACHE_KEY);
    const raw = localStorage.getItem(FAV_WEATHER_CACHE_KEY);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      if (!Number.isInteger(id)) continue;
      const e = val as { temp?: unknown; code?: unknown; isDay?: unknown; savedAt?: unknown };
      if (
        e && typeof e.temp === "number" && Number.isFinite(e.temp) &&
        typeof e.code === "number" && Number.isFinite(e.code) &&
        typeof e.savedAt === "string"
      ) {
        // Schema-Migration: Einträge aus der Zeit vor isDay haben das Feld nicht
        // → Tag-Fallback. Beim nächsten TTL-Ablauf wird der Eintrag mit echtem
        // isDay frisch überschrieben. Kein harter Bruch, keine Migration nötig.
        const isDay = typeof e.isDay === "boolean" ? e.isDay : true;
        map.set(id, { temp: e.temp, code: e.code, isDay, savedAt: e.savedAt });
      }
    }
  } catch {
    // defektes JSON → leere Map
  }
  return map;
}

// Schreibt den Cache zurück. localStorage-Fehler (Quota, privater Modus) werden
// geschluckt — der Cache ist nur Beschleunigung, kein kritischer Zustand.
export function writeFavWeatherCache(cache: Map<number, FavWeatherEntry>): void {
  if (typeof localStorage === "undefined") return;
  const record: Record<string, FavWeatherEntry> = {};
  for (const [id, entry] of cache) record[String(id)] = entry;
  try {
    localStorage.setItem(FAV_WEATHER_CACHE_KEY, JSON.stringify(record));
  } catch {
    // Schreiben gescheitert (z. B. Quota) → still ignorieren
  }
}

// Ist ein Eintrag älter als die TTL (oder fehlt/ungültig)? Dann muss er neu.
export function isFavWeatherStale(entry: FavWeatherEntry | undefined, nowMs = Date.now()): boolean {
  if (!entry) return true;
  const savedMs = Date.parse(entry.savedAt);
  if (!Number.isFinite(savedMs)) return true;
  return nowMs - savedMs > FAV_WEATHER_TTL_MIN * 60_000;
}

// Liefert genau die Orte, deren Cache-Eintrag fehlt ODER veraltet ist — die
// Liste, die nachgeladen werden muss. Frische Orte bleiben außen vor.
export function getStaleOrMissingFavorites(
  places: Place[],
  cache: Map<number, FavWeatherEntry>
): Place[] {
  const now = Date.now();
  return places.filter((p) => isFavWeatherStale(cache.get(p.id), now));
}

// Einzel-Eintrag spiegeln ("Gratis-Update"): wenn ohnehin der volle Forecast
// eines Favoriten geladen wurde, dessen current direkt in den Cache schreiben —
// der Chip ist damit sofort frisch und fällt im nächsten Batch als nicht-stale
// heraus. Kein eigener Netzaufruf. placeId-basiert, also unabhängig von der
// Reihenfolge der Favoriten.
export function cacheFavoriteWeather(id: number, weather: FavWeather): void {
  const cache = readFavWeatherCache();
  cache.set(id, { temp: weather.temp, code: weather.code, isDay: weather.isDay, savedAt: new Date().toISOString() });
  writeFavWeatherCache(cache);
}

// Verwaiste Einträge entfernen: behält nur die Orte, deren placeId in validIds
// steht, und schreibt den bereinigten Cache zurück. Leere validIds → leerer
// Cache. Gibt die bereinigte Map zurück, damit Aufrufer den Stand direkt nutzen.
export function pruneFavWeatherCache(validIds: number[]): Map<number, FavWeatherEntry> {
  const cache = readFavWeatherCache();
  const valid = new Set(validIds);
  let changed = false;
  for (const id of [...cache.keys()]) {
    if (!valid.has(id)) {
      cache.delete(id);
      changed = true;
    }
  }
  if (changed) writeFavWeatherCache(cache);
  return cache;
}

// ── C) Orchestrierung (reine Funktion, in dieser Etappe noch nicht verdrahtet) ─
// Liest den Cache, lädt NUR die veralteten/fehlenden Orte in einem Batch-Call
// nach, merged das Ergebnis in den Cache und gibt die vollständige Map zurück.
// Ist nichts veraltet → kein Call. Bei Netz-/API-Fehler bleiben die bisherigen
// Cache-Werte erhalten (leises Scheitern), kein Crash.
export async function refreshFavoritesWeather(places: Place[]): Promise<Map<number, FavWeatherEntry>> {
  const validIds = places.map((p) => p.id);
  const cache = readFavWeatherCache();

  // Nur laden, wenn es Favoriten gibt und etwas veraltet/fehlt — sonst kein Call.
  if (places.length > 0) {
    const stale = getStaleOrMissingFavorites(places, cache);
    if (stale.length > 0) {
      try {
        const fresh = await fetchFavoritesWeather(stale);
        const savedAt = new Date().toISOString();
        for (const [id, w] of fresh) cache.set(id, { temp: w.temp, code: w.code, isDay: w.isDay, savedAt });
        writeFavWeatherCache(cache);
      } catch {
        // Netz/API-Fehler: bestehende Cache-Werte behalten, nicht löschen.
      }
    }
  }

  // Immer aufräumen: Cache auf die aktuellen Favoriten beschränken. Fängt auch die
  // Race-Altlast ab (Etappe 3), falls der Batch einen inzwischen entfernten Ort
  // zurückgab, und leert bei leeren Favoriten den Cache vollständig.
  return pruneFavWeatherCache(validIds);
}
