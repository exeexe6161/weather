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

const PROVIDERS: Record<ProviderId, WeatherProvider> = {
  WEATHER_API: weatherApiProvider,
};

function activeProvider(): WeatherProvider {
  return PROVIDERS.WEATHER_API;
}

// Schlüsselform der Ortssuche für den Cache. NUR für den Cache: der Rückgabewert
// ersetzt nie die Anfrage an den Provider, die trägt immer den Originalbegriff.
//
// Zwei eng begrenzte Schritte, in dieser Reihenfolge:
//
//   1. Das türkische İ (U+0130) wird gezielt auf ASCII "I" abgebildet, damit
//      "İstanbul" und "istanbul" denselben Eintrag treffen. Belegt: beide liefern
//      beim Provider denselben einen Treffer, ein gemeinsamer Eintrag spart also
//      einen Aufruf, ohne ein fremdes Ergebnis auszuliefern.
//   2. Die ASCII Großbuchstaben A bis Z werden gefaltet, damit "Berlin" und
//      "berlin" wie schon vorher denselben Eintrag treffen.
//
// Die Reihenfolge ist unkritisch, nicht nur zufällig richtig: Schritt 2 kann nur
// Zeichen aus "a" bis "z" erzeugen und damit nie ein İ, das Schritt 1 noch
// sehen müsste. Umgekehrt liefert Schritt 1 ein ASCII "I", das Schritt 2
// planmäßig mitfaltet.
//
// Alles andere bleibt Zeichen für Zeichen stehen. Insbesondere:
//
// Bewusst NICHT toLowerCase() auf dem ganzen Begriff: das zerlegt U+0130 in "i"
// plus kombinierendes U+0307, und genau diese Form findet der Provider nicht
// (live geprüft: null Treffer, während "İstanbul" und "istanbul" je einen
// liefern). Genau daran ist die Suche vorher gescheitert.
//
// Bewusst NICHT toLocaleLowerCase("tr"): das macht aus dem englischen "I" ein
// punktloses "ı" und beschädigt damit die Gegenrichtung.
//
// Bewusst KEIN pauschales Entfernen kombinierender Zeichen und keine Normalform
// über den ganzen String: beides würde weit über den belegten Fall hinausgreifen.
export function geocodingCacheQuery(query: string): string {
  return query
    .replace(/İ/g, "I")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
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
    // Der Provider bekommt den Begriff so, wie der Nutzer ihn getippt hat, nur
    // getrimmt und auf 100 Zeichen gekappt. Vorher lief hier ein pauschales
    // toLowerCase, dessen Ergebnis SOWOHL in den Cache Schlüssel ALS AUCH an den
    // Provider ging. Für Umlaute war das folgenlos, für das türkische große İ
    // nicht: es zerfällt zu "i" plus kombinierendem U+0307, und WeatherAPI findet
    // die so verfälschte Anfrage nicht mehr. Direkt am Provider geprüft:
    // "İstanbul" und "istanbul" liefern je einen Treffer, die zerlegte Form
    // keinen. Die Kleinschreibung war für den Provider ohnehin nie nötig, denn
    // search.json unterscheidet Groß und Kleinschreibung nicht (ebenfalls direkt
    // geprüft, "Berlin" und "berlin" liefern dasselbe); sie diente allein der
    // Trefferquote im Cache und lebt dort weiter.
    const providerQuery = query.trim().slice(0, 100);
    const requestedLanguage = language.trim().toLowerCase();
    const normalizedLanguage = requestedLanguage === "en" || requestedLanguage === "tr" ? requestedLanguage : "de";
    // Sprache bleibt wie bisher Teil des Schlüssels.
    const key = buildCacheKey(provider.id, ["geocoding", geocodingCacheQuery(providerQuery), normalizedLanguage]);
    return getOrSet(key, TTL.GEOCODING_MS, () => provider.searchPlaces(providerQuery, normalizedLanguage));
  },

  // Pro Ort einzeln cachen (Key über gerundete Koordinaten, nicht über die
  // client-seitige place.id): nur die Orte ohne frischen Cache-Treffer landen
  // gemeinsam beim Provider angefragt. WeatherAPI führt dabei pro Ort einen
  // schlanken eintägigen Forecast Request aus; frische Cache Treffer kosten
  // keinen Call. Die Aufrufzahl bleibt gegenüber dem früheren Current Request
  // unverändert, zusätzlich kommen Regenchance und Warnsignal zurück.
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
