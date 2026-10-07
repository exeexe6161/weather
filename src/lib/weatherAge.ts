// Abrufalter des ursprünglichen Providerstands, unabhängig von Beobachtungszeit,
// Empfang im Browser und Kopien zwischen Caches. Altbestände ohne Herkunft verfallen.
export const WEATHER_FRESH_MS = 15 * 60_000;
export const WEATHER_MAX_MS = 60 * 60_000;
export type WeatherAge = "fresh" | "stale" | "expired";

export function weatherAge(sourceFetchedAt: unknown, nowMs = Date.now()): WeatherAge {
  const sourceMs = typeof sourceFetchedAt === "string" ? Date.parse(sourceFetchedAt) : NaN;
  const age = nowMs - sourceMs;
  if (!Number.isFinite(age) || age < 0 || age > WEATHER_MAX_MS) return "expired";
  return age <= WEATHER_FRESH_MS ? "fresh" : "stale";
}

export function nextWeatherExpiry(sourceFetchedAt: unknown, nowMs = Date.now()): number | null {
  const age = weatherAge(sourceFetchedAt, nowMs);
  if (age === "expired") return null;
  return Date.parse(sourceFetchedAt as string) + (age === "fresh" ? WEATHER_FRESH_MS : WEATHER_MAX_MS) + 1;
}

// Während dieser App Sitzung kann Zurückstellen der Systemuhr keine Restlaufzeit
// schenken. Vorwärtssprünge gelten sofort. Keine Aussage über eine geschlossene App.
export function createWeatherClock(wallNow = () => Date.now(), elapsedNow = () => performance.now()): () => number {
  let wall = wallNow();
  let elapsed = elapsedNow();
  return () => {
    const nextElapsed = elapsedNow();
    wall = Math.max(wallNow(), wall + Math.max(0, nextElapsed - elapsed));
    elapsed = nextElapsed;
    return wall;
  };
}
