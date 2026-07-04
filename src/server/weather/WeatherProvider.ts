import type { Forecast, Place, PollenLevels, FavWeather } from "./types.js";

export type ProviderId = "WEATHER_API" | "OPEN_METEO" | "OPEN_WEATHER" | "TOMORROW" | "METEOMATICS";

export interface BatchPlace {
  id: number;
  latitude: number;
  longitude: number;
}

export interface WeatherProvider {
  readonly id: ProviderId;
  getForecast(latitude: number, longitude: number): Promise<Forecast>;
  getPollen(latitude: number, longitude: number): Promise<PollenLevels | null>;
  searchPlaces(query: string, language: string): Promise<Place[]>;
  // Schlankes aktuelles Wetter für mehrere Orte im Favoriten Mini Dashboard.
  // Provider ohne Bulk Endpoint dürfen dafür mehrere Requests bündeln.
  getCurrentBatch(places: BatchPlace[]): Promise<Map<number, FavWeather>>;
}
