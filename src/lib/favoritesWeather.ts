// Favoriten-Wetter: schlanke Datenschicht für das Favoriten-Mini-Dashboard.
// STRIKT getrennt von fetchWeather/normalize (weather.ts) und favorites.ts:
// eigener Endpoint-Aufbau (nur current=temperature_2m,weather_code, kein
// hourly/daily/past_days), eigener localStorage-Cache mit eigener TTL. Diese
// Etappe legt nur die Funktionen an; nichts ruft sie automatisch auf.
import { fetchWithTimeout } from "./http";
import type { Place } from "./geocoding";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// Eigener Cache-Key, unabhängig von "weather:favorites" (reine Ortsliste) und
// "weather:last-forecast" (Einzelort-Vollforecast).
const FAV_WEATHER_CACHE_KEY = "weather:favorites-weather";

// Ab diesem Alter gilt ein Cache-Eintrag als veraltet und wird nachgeladen.
// current-Werte ändern sich selten schneller; schont zugleich das Rate-Limit.
export const FAV_WEATHER_TTL_MIN = 15;

// Schlankes Ergebnis pro Ort (nur was ein Chip braucht).
export interface FavWeather {
  temp: number;
  code: number;
}

// Cache-Eintrag = FavWeather plus Zeitstempel für die TTL-Prüfung.
export interface FavWeatherEntry extends FavWeather {
  savedAt: string; // ISO-Zeit
}

// ── A) Schlanker Multi-Location-Abruf ──────────────────────────────────────
// Holt das aktuelle Wetter ALLER übergebenen Orte in EINEM Open-Meteo-Request
// (kommagetrennte Koordinaten). Gibt eine Map place.id → {temp, code} zurück.
// Berührt fetchWeather/normalize nicht.
export async function fetchFavoritesWeather(places: Place[]): Promise<Map<number, FavWeather>> {
  const out = new Map<number, FavWeather>();
  if (places.length === 0) return out; // leere Liste → kein Call

  const params = new URLSearchParams({
    latitude: places.map((p) => String(p.latitude)).join(","),
    longitude: places.map((p) => String(p.longitude)).join(","),
    current: "temperature_2m,weather_code",
    timezone: "auto",
  });
  const res = await fetchWithTimeout(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Favorites weather request failed: ${res.status}`);
  const data = await res.json();

  // Bei mehreren Orten liefert Open-Meteo ein ARRAY von Orts-Objekten, bei genau
  // einem Ort ein einzelnes Objekt. Beide Fälle defensiv auf ein Array bringen.
  const list: unknown[] = Array.isArray(data) ? data : [data];

  // Zuordnung strikt über die REIHENFOLGE: Open-Meteo gibt die Orte in derselben
  // Reihenfolge zurück, in der die Koordinaten gesendet wurden. Bewusst NICHT
  // über die zurückgelieferten lat/lon matchen — die API snappt auf den nächsten
  // Gitterpunkt, die Rückgabewerte weichen also leicht von den gesendeten ab.
  for (let i = 0; i < places.length && i < list.length; i++) {
    const cur = (list[i] as { current?: { temperature_2m?: unknown; weather_code?: unknown } })?.current;
    const temp = cur?.temperature_2m;
    const code = cur?.weather_code;
    if (
      typeof temp === "number" && Number.isFinite(temp) &&
      typeof code === "number" && Number.isFinite(code)
    ) {
      out.set(places[i].id, { temp, code });
    }
    // Fehlende/NaN-Werte einfach überspringen (Chip zeigt dann nichts), kein Crash.
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
    const raw = localStorage.getItem(FAV_WEATHER_CACHE_KEY);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      if (!Number.isInteger(id)) continue;
      const e = val as { temp?: unknown; code?: unknown; savedAt?: unknown };
      if (
        e && typeof e.temp === "number" && Number.isFinite(e.temp) &&
        typeof e.code === "number" && Number.isFinite(e.code) &&
        typeof e.savedAt === "string"
      ) {
        map.set(id, { temp: e.temp, code: e.code, savedAt: e.savedAt });
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
  cache.set(id, { temp: weather.temp, code: weather.code, savedAt: new Date().toISOString() });
  writeFavWeatherCache(cache);
}

// ── C) Orchestrierung (reine Funktion, in dieser Etappe noch nicht verdrahtet) ─
// Liest den Cache, lädt NUR die veralteten/fehlenden Orte in einem Batch-Call
// nach, merged das Ergebnis in den Cache und gibt die vollständige Map zurück.
// Ist nichts veraltet → kein Call. Bei Netz-/API-Fehler bleiben die bisherigen
// Cache-Werte erhalten (leises Scheitern), kein Crash.
export async function refreshFavoritesWeather(places: Place[]): Promise<Map<number, FavWeatherEntry>> {
  const cache = readFavWeatherCache();
  if (places.length === 0) return cache;

  const stale = getStaleOrMissingFavorites(places, cache);
  if (stale.length === 0) return cache; // alles frisch → kein Call

  try {
    const fresh = await fetchFavoritesWeather(stale);
    const savedAt = new Date().toISOString();
    for (const [id, w] of fresh) cache.set(id, { temp: w.temp, code: w.code, savedAt });
    writeFavWeatherCache(cache);
  } catch {
    // Netz/API-Fehler: bestehende Cache-Werte behalten, nicht löschen.
  }
  return cache;
}
