// Einfacher In-Memory Cache pro warmer Function Instanz. Vercel Fluid Compute
// hält Instanzen zwischen Aufrufen warm, der Cache überlebt also mehrere
// Requests auf derselben Instanz — es gibt aber KEINEN geteilten Speicher
// über mehrere Instanzen/Regionen hinweg, und ein Cold Start leert ihn. Für
// den Free Mode reicht das, um wiederholte Anfragen auf dieselbe Koordinate
// oder Stadt kurzfristig abzufangen und Open-Meteo Calls zu reduzieren.
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function get<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function set<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Lädt bei Cache Miss über `load()` nach und schreibt das Ergebnis in den
// Cache. `shouldCache` verhindert, dass ein "leiser Fehlschlag" (z. B.
// getPollen liefert bei einem Ausfall `null` statt zu werfen) für die volle
// TTL eingefroren wird — ein echter Fehler (geworfene Exception) wird nie
// gecacht, weil `load()` dann vor dem `set` abbricht.
export async function getOrSet<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true
): Promise<T> {
  const cached = get<T>(key);
  if (cached !== undefined) return cached;
  const value = await load();
  if (shouldCache(value)) set(key, value, ttlMs);
  return value;
}

// Koordinaten auf 2 Nachkommastellen runden (~1,1 km Raster): erhöht die
// Trefferquote für nahe beieinanderliegende Anfragen, ohne den Wetterwert
// spürbar zu verändern.
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildCacheKey(providerId: string, parts: (string | number)[]): string {
  return [providerId, ...parts].join(":");
}

export const TTL = {
  WEATHER_MS: 15 * 60_000,
  GEOCODING_MS: 7 * 24 * 60 * 60_000,
  POLLEN_MS: 6 * 60 * 60_000,
  FAVORITES_WEATHER_MS: 15 * 60_000,
} as const;
