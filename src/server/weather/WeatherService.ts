// Zentrale Fassade: Komponenten und spätere API Routes dürfen ausschließlich
// hierüber gehen, nie einen Provider direkt importieren. Der aktive Provider
// ist WEATHER_API. Der Schlüssel bleibt ausschließlich als
// Server Environment Variable konfiguriert. Caching (siehe cache.ts)
// sitzt hier zentral, nicht im Provider: der Cache Key enthält die Provider
// Id, damit ein späterer Providerwechsel nie einen fremden Cache Eintrag trifft.
import type { WeatherProvider, ProviderId, BatchPlace } from "./WeatherProvider.js";
import { weatherApiProvider } from "./providers/WeatherApiProvider.js";
import type { Forecast, Place, PollenLevels, FavWeather } from "./types.js";
import { getOrSet, get, set, roundCoord, buildCacheKey, TTL } from "./cache.js";

const PROVIDERS: Record<ProviderId, WeatherProvider | null> = {
  WEATHER_API: weatherApiProvider,
  OPEN_METEO: null,
  OPEN_WEATHER: null,
  TOMORROW: null,
  METEOMATICS: null,
};

function activeProvider(): WeatherProvider {
  return PROVIDERS.WEATHER_API!;
}

export const WeatherService = {
  getForecast(latitude: number, longitude: number): Promise<Forecast> {
    const provider = activeProvider();
    const key = buildCacheKey(provider.id, ["forecast", roundCoord(latitude), roundCoord(longitude)]);
    return getOrSet(key, TTL.WEATHER_MS, () => provider.getForecast(latitude, longitude));
  },

  getPollen(latitude: number, longitude: number): Promise<PollenLevels | null> {
    const provider = activeProvider();
    const key = buildCacheKey(provider.id, ["pollen", roundCoord(latitude), roundCoord(longitude)]);
    // getPollen wirft nie, ein Ausfall liefert `null` — das nicht für die volle
    // TTL einfrieren, sonst bleibt die Pollensektion bei einem kurzen
    // WeatherAPI Ausfall bis zum TTL Ende leer, obwohl der Dienst wieder da ist.
    return getOrSet(key, TTL.POLLEN_MS, () => provider.getPollen(latitude, longitude), (v) => v !== null);
  },

  searchPlaces(query: string, language: string): Promise<Place[]> {
    const provider = activeProvider();
    // Normalisiert (trim + lowercase), damit "Berlin" und "berlin" denselben
    // Eintrag treffen; die eigentliche Mindestlänge prüft schon der Client.
    const normalized = query.trim().slice(0, 100).toLowerCase();
    const requestedLanguage = language.trim().toLowerCase();
    const normalizedLanguage = requestedLanguage === "en" || requestedLanguage === "tr" ? requestedLanguage : "de";
    const key = buildCacheKey(provider.id, ["geocoding", normalized, normalizedLanguage]);
    return getOrSet(key, TTL.GEOCODING_MS, () => provider.searchPlaces(normalized, normalizedLanguage));
  },

  // Pro Ort einzeln cachen (Key über gerundete Koordinaten, nicht über die
  // client-seitige place.id): nur die Orte ohne frischen Cache-Treffer landen
  // gemeinsam beim Provider angefragt. WeatherAPI führt dabei pro Ort einen
  // schlanken Current Request aus; frische Cache Treffer kosten keinen Call.
  async getCurrentBatch(places: BatchPlace[]): Promise<Map<number, FavWeather>> {
    const provider = activeProvider();
    const result = new Map<number, FavWeather>();
    const missing: BatchPlace[] = [];

    for (const place of places) {
      const key = buildCacheKey(provider.id, ["favorites-weather", roundCoord(place.latitude), roundCoord(place.longitude)]);
      const hit = get<FavWeather>(key);
      if (hit !== undefined) result.set(place.id, hit);
      else missing.push(place);
    }

    if (missing.length > 0) {
      const fresh = await provider.getCurrentBatch(missing);
      for (const place of missing) {
        const weather = fresh.get(place.id);
        if (!weather) continue;
        result.set(place.id, weather);
        const key = buildCacheKey(provider.id, ["favorites-weather", roundCoord(place.latitude), roundCoord(place.longitude)]);
        set(key, weather, TTL.FAVORITES_WEATHER_MS);
      }
    }
    return result;
  },
};
