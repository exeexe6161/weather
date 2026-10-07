// Favoriten-Wetter: schlanke Datenschicht für das Favoriten-Mini-Dashboard.
// STRIKT getrennt von fetchWeather/normalize (weather.ts) und favorites.ts:
// eigener, schlanker Endpoint (aktuelle Temperatur, Wettercode sowie kompakte
// Tageswerte für Vergleich und Warnsignal), eigener localStorage-Cache.
import { weatherAge, nextWeatherExpiry, WEATHER_FRESH_MS } from "./weatherAge";
import { fetchWithTimeout, apiUrl } from "./http";
import type { Place } from "./geocoding";
// Nur Typen, zur Laufzeit bleibt dieses Modul unabhängig von weather.ts.
import type { CurrentWeather, Forecast } from "./weather";

// Eigener WeatherAPI Cache Key, unabhängig von der reinen Favoriten Ortsliste
// und dem Einzelort Vollforecast.
// Auch Vollforecast-Spiegelungen konnten früher Ersatznullen enthalten. Nur
// diesen Wettercache erneuern, niemals die gespeicherte Favoriten-Ortsliste.
const FAV_WEATHER_CACHE_KEY = "weather:weatherapi:favorites-weather:rain-v2";
const LEGACY_FAV_WEATHER_CACHE_KEYS = ["weather:favorites-weather", "weather:weatherapi:favorites-weather"];
let favoriteBatchSeq = 0;
const latestBatchById = new Map<number, number>();

// Ab diesem Alter gilt ein Cache-Eintrag als veraltet und wird nachgeladen.
// current-Werte ändern sich selten schneller; schont zugleich das Rate-Limit.
export const FAV_WEATHER_TTL_MIN = WEATHER_FRESH_MS / 60_000;

// Schlankes Ergebnis pro Ort (nur was Favoritenzeile und Vergleich brauchen).
export interface FavWeather {
  // Optional nur, damit nicht verifizierte Altbestände erkannt werden können.
  sourceFetchedAt?: string;
  temp: number;
  code: number;
  isDay: boolean; // für die Tag-/Nacht-Variante des Icons (pickIcon)
  rainChance?: number | null;
  hasAlert?: boolean;
}

// Cache-Eintrag = FavWeather plus Zeitstempel für die TTL-Prüfung.
export interface FavWeatherEntry extends FavWeather {
  savedAt: string; // Kompatibilitätsfeld, bei neuen Einträgen identisch mit sourceFetchedAt
  // Optional für bestehende gespeicherte Einträge. Nur neue, zusammenhängende
  // Snapshots sind bestätigt; alte können durch das frühere Merge gemischt sein.
  snapshotVersion?: 1;
}

// ── A) Schlanker Multi-Location-Abruf ──────────────────────────────────────
// Holt das aktuelle Wetter ALLER übergebenen Orte über die eigene Server
// Route /api/favorites-weather (dahinter maximal fünf schlanke WeatherAPI
// eintägige Forecast Requests, mit serverseitigem Cache). Berührt den
// vollständigen Einzelort Forecast nicht.
export async function fetchFavoritesWeather(places: Place[]): Promise<Map<number, FavWeather>> {
  const out = new Map<number, FavWeather>();
  if (places.length === 0) return out; // leere Liste → kein Call

  const payload = places.map((p) => ({ id: p.id, latitude: p.latitude, longitude: p.longitude }));
  const res = await fetchWithTimeout(apiUrl("/api/favorites-weather"), 12000, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Favorites weather request failed: ${res.status}`);
  const data: Array<{ id: number; temp: number; code: number; isDay: boolean; rainChance: number | null; hasAlert: boolean; sourceFetchedAt?: string }> = await res.json();
  for (const entry of data) {
    out.set(entry.id, { sourceFetchedAt: entry.sourceFetchedAt, temp: entry.temp, code: entry.code, isDay: entry.isDay, rainChance: entry.rainChance, hasAlert: entry.hasAlert });
  }
  return out;
}

// ── B) Cache mit TTL ───────────────────────────────────────────────────────
// Liest den Favoriten-Wetter-Cache aus localStorage. Korrupter/fremder Inhalt
// wird als leer behandelt (nie ein Crash). Record placeId → Eintrag.
export function readFavWeatherCache(nowMs = Date.now()): Map<number, FavWeatherEntry> {
  const map = new Map<number, FavWeatherEntry>();
  try {
    for (const key of LEGACY_FAV_WEATHER_CACHE_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(FAV_WEATHER_CACHE_KEY);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return map;
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      if (!Number.isInteger(id)) continue;
      const e = val as { temp?: unknown; code?: unknown; isDay?: unknown; rainChance?: unknown; hasAlert?: unknown; savedAt?: unknown; sourceFetchedAt?: unknown; snapshotVersion?: unknown };
      if (
        e && typeof e.temp === "number" && Number.isFinite(e.temp) &&
        typeof e.code === "number" && Number.isFinite(e.code) &&
        typeof e.sourceFetchedAt === "string" && weatherAge(e.sourceFetchedAt, nowMs) !== "expired"
      ) {
        // Nur ein nachweisbarer Providerstand darf weiterverwendet werden.
        const isDay = typeof e.isDay === "boolean" ? e.isDay : true;
        const rainChance = typeof e.rainChance === "number" && Number.isFinite(e.rainChance) ? e.rainChance : null;
        const hasAlert = typeof e.hasAlert === "boolean" ? e.hasAlert : false;
        map.set(id, {
          temp: e.temp, code: e.code, isDay, rainChance, hasAlert, savedAt: e.sourceFetchedAt, sourceFetchedAt: e.sourceFetchedAt,
          ...(e.snapshotVersion === 1 ? { snapshotVersion: 1 as const } : {}),
        });
      }
    }
    // Auch ungültige/abgelaufene Altbestände physisch bereinigen, wenn möglich.
    if (JSON.stringify(parsed) !== JSON.stringify(Object.fromEntries(map))) writeFavWeatherCache(map, nowMs);
  } catch {
    // defektes JSON → leere Map
  }
  return map;
}

// Schreibt den Cache zurück. localStorage-Fehler (Quota, privater Modus) werden
// geschluckt — der Cache ist nur Beschleunigung, kein kritischer Zustand.
export function writeFavWeatherCache(cache: Map<number, FavWeatherEntry>, nowMs = Date.now()): void {
  const record: Record<string, FavWeatherEntry> = {};
  for (const [id, entry] of cache) {
    if (weatherAge(entry.sourceFetchedAt, nowMs) !== "expired") record[String(id)] = entry;
  }
  try {
    localStorage.setItem(FAV_WEATHER_CACHE_KEY, JSON.stringify(record));
  } catch {
    // Schreiben gescheitert (z. B. Quota) → still ignorieren
  }
}

// Fehlende, ungültige oder nicht als zusammenhängend bestätigte Altbestände
// sowie Einträge jenseits der unveränderten TTL müssen nachgeladen werden.
export function isFavWeatherStale(entry: FavWeatherEntry | undefined, nowMs = Date.now()): boolean {
  return !entry || entry.snapshotVersion !== 1 || weatherAge(entry.sourceFetchedAt, nowMs) !== "fresh";
}

// Liefert genau die Orte, deren Cache-Eintrag fehlt ODER veraltet ist — die
// Liste, die nachgeladen werden muss. Frische Orte bleiben außen vor.
export function getStaleOrMissingFavorites(
  places: Place[],
  cache: Map<number, FavWeatherEntry>,
  now = Date.now()
): Place[] {
  return places.filter((p) => isFavWeatherStale(cache.get(p.id), now));
}

// Nächster Wechsel zu älterem oder abgelaufenem Stand. Nur ein Anzeige-Timer,
// kein Polling und kein zusätzlicher Providerabruf.
export function nextFavWeatherExpiry(entries: Iterable<FavWeatherEntry>, nowMs = Date.now()): number | null {
  let next: number | null = null;
  for (const entry of entries) {
    const expiresAt = nextWeatherExpiry(entry.sourceFetchedAt, nowMs);
    if (expiresAt === null) continue;
    if (next === null || expiresAt < next) next = expiresAt;
  }
  return next;
}

// Jeder neue Stand ersetzt alle Chip-Werte gemeinsam. Fehlende optionale Werte
// bedeuten keine anzeigbare Regenzahl/kein bestätigtes Warnsignal in diesem
// Stand; sie dürfen niemals aus dem vorherigen Snapshot ergänzt werden.
function favoriteSnapshot(weather: FavWeather): FavWeatherEntry {
  return {
    temp: weather.temp,
    code: weather.code,
    isDay: weather.isDay,
    rainChance: weather.rainChance ?? null,
    hasAlert: weather.hasAlert ?? false,
    sourceFetchedAt: weather.sourceFetchedAt,
    savedAt: weather.sourceFetchedAt!,
    snapshotVersion: 1,
  };
}

// Einzel-Eintrag spiegeln ("Gratis-Update"): wenn ohnehin der volle Forecast
// eines Favoriten geladen wurde, dessen current direkt in den Cache schreiben.
// Die Frische hängt weiterhin vom ursprünglichen Providerabruf ab.
// Kein eigener Netzaufruf; placeId-basiert, unabhängig von der Reihenfolge.
// Der Kopierzeitpunkt ist keine neue Quelle für das Wetteralter.
export function cacheFavoriteWeather(id: number, weather: FavWeather, _savedAt?: string, nowMs = Date.now()): void {
  // Eine direkte Forecast-Spiegelung ist neuer als jeder laufende Batch für
  // denselben Favoriten, auch wenn dessen Antwort erst danach eintrifft.
  latestBatchById.delete(id);
  const cache = readFavWeatherCache(nowMs);
  if (weatherAge(weather.sourceFetchedAt, nowMs) !== "expired") cache.set(id, favoriteSnapshot(weather));
  writeFavWeatherCache(cache, nowMs);
}

// ── D) Spiegelung aus dem bereits geladenen Vollforecast ───────────────────
// Reduziert einen Vollforecast auf die schlanke Chip-Form. KEIN Netzzugriff:
// die Werte stehen bereits auf dem Bildschirm, sie werden nur übernommen.
//
// Fehlende Werte bleiben hier `undefined`. Der neue Snapshot zeigt dafür
// keine Regenzahl und kein Warnsignal, übernimmt aber auch keinen alten Wert.
// Das Fehlen eines Warnsignals ist keine bestätigte Entwarnung.
//
// null, wenn Temperatur oder Wettercode fehlen: ein Chip ohne diese beiden
// Werte hätte nichts zu zeigen, dann ist der reguläre Abruf der richtige Weg.
export function favWeatherFromForecast(forecast: Forecast | null | undefined): FavWeather | null {
  const current = forecast?.current as Partial<CurrentWeather> | undefined;
  if (current === null || current === undefined) return null;
  const temp = current.temperature;
  const code = current.weatherCode;
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;
  if (typeof code !== "number" || !Number.isFinite(code)) return null;
  const rain = forecast?.daily?.[0]?.precipitationProbabilityMax;
  return {
    sourceFetchedAt: forecast?.sourceFetchedAt,
    temp,
    code,
    isDay: current.isDay === true,
    rainChance: typeof rain === "number" && Number.isFinite(rain) ? rain : undefined,
    hasAlert: Array.isArray(forecast?.alerts) ? forecast.alerts.length > 0 : undefined,
  };
}

// Gemeinsamer Produktionspfad für Ortswahl und Refresh: sämtliche Chip-Werte
// aus demselben Vollforecast mit dessen bereits gesetztem Abrufzeitpunkt.
export function cacheFavoriteForecast(id: number, forecast: Forecast, savedAt: string, nowMs = Date.now()): void {
  const weather = favWeatherFromForecast(forecast);
  if (weather !== null) cacheFavoriteWeather(id, weather, savedAt, nowMs);
}

export interface FavoriteMirror {
  // Was in den Cache geschrieben werden soll, oder null wenn nichts spiegelbar ist.
  readonly entry: FavWeatherEntry | null;
  // Ob zusätzlich der reguläre Batch-Abruf angestoßen werden muss. true genau
  // dann, wenn nichts gespiegelt werden konnte ODER der gespiegelte Stand nach
  // derselben TTL-Regel bereits veraltet ist.
  readonly needsFetch: boolean;
}

// Entscheidet in einem Zug, was ein frisch hinzugefügter Favorit sofort zeigen
// darf und ob dafür trotzdem noch nachgeladen werden muss. Reine Funktion,
// damit die Regel ohne DOM prüfbar bleibt.
export function mirrorForNewFavorite(
  forecast: Forecast | null | undefined,
  _updatedAt: string,
  nowMs = Date.now()
): FavoriteMirror {
  const weather = favWeatherFromForecast(forecast);
  // Ohne verwertbaren Zeitstempel lässt sich die Frische nicht beurteilen; ein
  // Wert ohne beurteilbares Alter darf nicht in den Cache.
  if (weather === null || weatherAge(weather.sourceFetchedAt, nowMs) === "expired") {
    return { entry: null, needsFetch: true };
  }
  const entry = favoriteSnapshot(weather);
  return { entry, needsFetch: isFavWeatherStale(entry, nowMs) };
}

// Verwaiste Einträge entfernen: behält nur die Orte, deren placeId in validIds
// steht, und schreibt den bereinigten Cache zurück. Leere validIds → leerer
// Cache. Gibt die bereinigte Map zurück, damit Aufrufer den Stand direkt nutzen.
export function pruneFavWeatherCache(validIds: number[], nowMs = Date.now()): Map<number, FavWeatherEntry> {
  const cache = readFavWeatherCache(nowMs);
  const valid = new Set(validIds);
  for (const id of latestBatchById.keys()) {
    if (!valid.has(id)) latestBatchById.delete(id);
  }
  let changed = false;
  for (const id of [...cache.keys()]) {
    if (!valid.has(id)) {
      cache.delete(id);
      changed = true;
    }
  }
  if (changed) writeFavWeatherCache(cache, nowMs);
  return cache;
}

// ── C) Orchestrierung ─────────────────────────────────────────────────────
// Liest den Cache, lädt NUR die veralteten/fehlenden Orte in einem Batch-Call
// nach, ersetzt deren Snapshots und gibt die vollständige Map zurück.
// Ist nichts veraltet → kein Call. Bei Netz-/API-Fehler bleiben ausschließlich
// noch zulässige Cache-Werte erhalten (leises Scheitern), kein Crash.
export async function refreshFavoritesWeather(places: Place[], now = () => Date.now()): Promise<Map<number, FavWeatherEntry>> {
  const validIds = places.map((p) => p.id);
  // Nur vor dem Await auf die zu diesem Zeitpunkt übergebenen Favoriten
  // begrenzen. Ein späterer alter Batch darf neu hinzugefügte Orte nicht löschen.
  const cache = pruneFavWeatherCache(validIds, now());

  // Nur laden, wenn es Favoriten gibt und etwas veraltet/fehlt — sonst kein Call.
  if (places.length > 0) {
    const stale = getStaleOrMissingFavorites(places, cache, now());
    if (stale.length > 0) {
      const batchSeq = ++favoriteBatchSeq;
      for (const place of stale) latestBatchById.set(place.id, batchSeq);
      try {
        const fresh = await fetchFavoritesWeather(stale);
        const nowMs = now();
        const current = readFavWeatherCache(nowMs);
        let changed = false;
        for (const [id, w] of fresh) {
          if (latestBatchById.get(id) !== batchSeq) continue;
          if (weatherAge(w.sourceFetchedAt, nowMs) === "expired") continue;
          current.set(id, favoriteSnapshot(w));
          changed = true;
        }
        if (changed) writeFavWeatherCache(current, nowMs);
      } catch {
        // Der abschließende Leseweg behält nur weiterhin zulässige Wetterstände.
      } finally {
        for (const place of stale) {
          if (latestBatchById.get(place.id) === batchSeq) latestBatchById.delete(place.id);
        }
      }
    }
  }

  return readFavWeatherCache(now());
}
