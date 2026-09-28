// Forecast-Cache pro Ort: hält den zuletzt geladenen Vollforecast MEHRERER
// Orte, nicht nur des einen zuletzt geöffneten.
//
// Vorher lag genau ein Forecast unter einem Einzelschlüssel. Beim Wechsel
// zwischen zwei Favoriten überschrieb jeder Ort den anderen, sodass der
// Rückweg immer wieder im Ladeskelett landete, obwohl die Daten Sekunden
// vorher da waren. Ein Eintrag je Ort löst genau das: der Wechsel zeigt sofort
// den letzten Stand ("Stand HH:MM"), während im Hintergrund frisch geladen wird.
//
// Gleiche Bauform wie favoritesWeather.ts (eigener Schlüssel, Map über placeId,
// defekter Inhalt gilt als leer, Schreibfehler werden geschluckt) — der Cache
// ist Beschleunigung, nie Quelle der Wahrheit.
import { GEO_PLACE_ID } from "./geocoding";
import { MAX_FAVORITES } from "./favorites";
import type { Forecast } from "./weather";
import { isForecastForCurrentLocalDay } from "./forecastDay";

// Frühere Forecasts können fehlende Regenwahrscheinlichkeiten als 0 enthalten.
// Wiederbeschaffbaren Wettercache erneuern, echte 0 niemals umdeuten.
const FORECAST_CACHE_KEY = "weather:weatherapi:forecasts:rain-v2";

// Einzelforecast-Schlüssel früherer Versionen. Beide werden bei jedem Lesen
// entfernt, damit kein toter Datensatz mit Koordinaten liegen bleibt. Ihre
// Inhalte werden bewusst NICHT übernommen: ein einzelner Ort ist beim ersten
// Abruf ohnehin sofort wieder da, eine Migration wäre reine Altlastpflege.
const LEGACY_FORECAST_CACHE_KEYS = ["weather:weatherapi:last-forecast", "weather:last-forecast", "weather:weatherapi:forecasts"];

// Unverändert aus app.ts übernommen: ein Stand, der älter ist, wird nicht mehr
// als Sofort-Anzeige gezeigt. Eine tagealte Vorhersage als "Stand" wäre
// irreführend. Keine Verlängerung gegenüber dem bisherigen Verhalten.
export const MAX_FORECAST_CACHE_AGE_MS = 60 * 60 * 1000;

// Ein Platz je möglichem Favoriten plus einer für den aktuell angezeigten Ort,
// der kein Favorit sein muss. Gemessen belegt ein Eintrag rund 10 KB, das
// Maximum also rund 61 KB — unkritisch für localStorage.
export const MAX_FORECAST_CACHE_ENTRIES = MAX_FAVORITES + 1;

export interface ForecastCacheEntry {
  placeId: number;
  latitude: number;
  longitude: number;
  savedAt: string; // ISO-Zeit, gleiche Rolle wie savedAt in FavWeatherEntry
  forecast: Forecast;
}

// Nur die unmittelbar gerenderten Pflichtstrukturen prüfen. Zusätzliche Wetter-
// felder bleiben optional, damit ältere Cacheeinträge weiter lesbar sind.
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUsableForecast(value: unknown): value is Forecast {
  if (!isRecord(value) || !isRecord(value.current) || !Array.isArray(value.hourly) || !Array.isArray(value.daily)) return false;
  const current = value.current;
  return (
    typeof current.time === "string" &&
    isFiniteNumber(current.temperature) && isFiniteNumber(current.apparentTemperature) &&
    isFiniteNumber(current.humidity) && isFiniteNumber(current.windSpeed) &&
    isFiniteNumber(current.weatherCode) && typeof current.isDay === "boolean" &&
    value.hourly.every((hour: unknown) => isRecord(hour) &&
      typeof hour.time === "string" && isFiniteNumber(hour.temperature) &&
      isFiniteNumber(hour.apparentTemperature) && isFiniteNumber(hour.weatherCode)) &&
    value.daily.every((day: unknown) => isRecord(day) &&
      typeof day.date === "string" && isFiniteNumber(day.tempMax) &&
      isFiniteNumber(day.tempMin) && isFiniteNumber(day.weatherCode))
  );
}

function isEntry(value: unknown, id: number): value is ForecastCacheEntry {
  if (!isRecord(value)) return false;
  const e = value as Partial<ForecastCacheEntry>;
  return (
    e.placeId === id &&
    typeof e.latitude === "number" && Number.isFinite(e.latitude) && e.latitude >= -90 && e.latitude <= 90 &&
    typeof e.longitude === "number" && Number.isFinite(e.longitude) && e.longitude >= -180 && e.longitude <= 180 &&
    typeof e.savedAt === "string" && Number.isFinite(Date.parse(e.savedAt)) &&
    isUsableForecast(e.forecast)
  );
}

// Liest den Cache. Verworfen wird dabei alles, was nie hätte dort liegen dürfen
// oder nicht mehr verwertbar ist: defektes JSON, fremde Struktur, nicht
// parsebare Zeitstempel und der Geolocation-Ort (Datenschutzzusage). Wirft nie.
export function readForecastCache(): Map<number, ForecastCacheEntry> {
  const map = new Map<number, ForecastCacheEntry>();
  try {
    for (const key of LEGACY_FORECAST_CACHE_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(FORECAST_CACHE_KEY);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      // Der Geo-Ort wird nie geschrieben; läge er trotzdem hier (Altlast einer
      // früheren Version), fällt genau dieser Eintrag raus statt des ganzen Caches.
      if (!Number.isInteger(id) || id === GEO_PLACE_ID) continue;
      if (isEntry(value, id)) map.set(id, value);
    }
  } catch {
    // defektes JSON → leere Map
  }
  return map;
}

// Schreibt den Cache zurück. localStorage-Fehler (Quota, privater Modus) werden
// geschluckt — ohne Cache ist die App langsamer, aber vollständig funktionsfähig.
export function writeForecastCache(cache: Map<number, ForecastCacheEntry>): void {
  const record: Record<string, ForecastCacheEntry> = {};
  for (const [id, entry] of cache) record[String(id)] = entry;
  try {
    localStorage.setItem(FORECAST_CACHE_KEY, JSON.stringify(record));
  } catch {
    // Schreiben gescheitert (z. B. Quota) → still ignorieren
  }
}

export function isForecastEntryTooOld(savedAt: string, nowMs = Date.now()): boolean {
  const savedMs = Date.parse(savedAt);
  if (!Number.isFinite(savedMs)) return true;
  return nowMs - savedMs > MAX_FORECAST_CACHE_AGE_MS;
}

export type ForecastCacheState = "fresh" | "calendar-stale" | "expired";

export function forecastCacheState(entry: ForecastCacheEntry, nowMs = Date.now()): ForecastCacheState {
  if (isForecastEntryTooOld(entry.savedAt, nowMs)) return "expired";
  return isForecastForCurrentLocalDay(entry.forecast, nowMs) ? "fresh" : "calendar-stale";
}

// Der Stand, der für diesen Ort sofort angezeigt werden darf — oder null.
// Für den Geolocation-Ort immer null: sein Standort wird nicht gespeichert und
// darf deshalb auch nicht aus einem Cache zurückkommen.
export function getUsableForecast(placeId: number, nowMs = Date.now()): ForecastCacheEntry | null {
  if (placeId === GEO_PLACE_ID) return null;
  const entry = readForecastCache().get(placeId);
  if (!entry || forecastCacheState(entry, nowMs) !== "fresh") return null;
  return entry;
}

// Innerhalb der bisherigen TTL bleibt ein alter Ortstag als letzter bekannter
// Stand lesbar. Der Aufrufer darf ihn nur ohne relative Heute-Aussagen zeigen.
export function getRecentForecast(placeId: number, nowMs = Date.now()): ForecastCacheEntry | null {
  if (placeId === GEO_PLACE_ID) return null;
  const entry = readForecastCache().get(placeId);
  return entry && forecastCacheState(entry, nowMs) !== "expired" ? entry : null;
}

// Legt den Stand eines Orts ab. Der Geolocation-Ort wird nie geschrieben
// (Datenschutzzusage) — zweite Verteidigungslinie hinter dem Aufrufer.
// Übersteigt der Cache das Limit, fällt der jeweils älteste Eintrag heraus;
// der gerade geschriebene ist der jüngste und bleibt damit immer erhalten.
export function putForecast(
  placeId: number,
  latitude: number,
  longitude: number,
  forecast: Forecast,
  savedAt: string = new Date().toISOString()
): void {
  if (placeId === GEO_PLACE_ID) return;
  const cache = readForecastCache();
  cache.set(placeId, { placeId, latitude, longitude, savedAt, forecast });
  while (cache.size > MAX_FORECAST_CACHE_ENTRIES) {
    let oldestId: number | null = null;
    let oldestMs = Infinity;
    for (const [id, entry] of cache) {
      const ms = Date.parse(entry.savedAt);
      if (ms < oldestMs) {
        oldestMs = ms;
        oldestId = id;
      }
    }
    if (oldestId === null) break; // kann nicht eintreten, schützt vor Endlosschleife
    cache.delete(oldestId);
  }
  writeForecastCache(cache);
}

// Verwaiste Einträge entfernen: behält nur die Orte aus validIds. Aufrufer gibt
// bewusst auch den aktuell angezeigten Ort mit, selbst wenn er kein Favorit ist
// — das ist der "+1"-Platz, ohne den ein Neuladen nach dem Entfernen eines
// Favoriten wieder im Ladeskelett landen würde.
export function pruneForecastCache(validIds: number[]): Map<number, ForecastCacheEntry> {
  const cache = readForecastCache();
  const valid = new Set(validIds);
  let changed = false;
  for (const id of [...cache.keys()]) {
    if (!valid.has(id)) {
      cache.delete(id);
      changed = true;
    }
  }
  if (changed) writeForecastCache(cache);
  return cache;
}

// Abgelaufene Stände beim Start wegräumen, statt sie bis zum nächsten Schreiben
// liegen zu lassen: sie enthalten Koordinaten und sind ohnehin nicht mehr
// anzeigbar. Ersetzt die frühere Einzelschlüssel-Aufräumung in initApp.
export function pruneExpiredForecasts(nowMs = Date.now()): Map<number, ForecastCacheEntry> {
  const cache = readForecastCache();
  let changed = false;
  for (const [id, entry] of [...cache]) {
    if (isForecastEntryTooOld(entry.savedAt, nowMs)) {
      cache.delete(id);
      changed = true;
    }
  }
  if (changed) writeForecastCache(cache);
  return cache;
}
