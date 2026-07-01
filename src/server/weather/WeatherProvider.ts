import type { Forecast, Place, PollenLevels, FavWeather } from "./types";

export type ProviderId = "OPEN_METEO" | "OPEN_WEATHER" | "TOMORROW" | "METEOMATICS";

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
  // Schlankes aktuelles Wetter für mehrere Orte in einem Upstream Call
  // (Favoriten Mini Dashboard). Getrennt von getForecast: eigener,
  // schlankerer Open Meteo Endpoint Aufbau, siehe favoritesWeather.ts.
  getCurrentBatch(places: BatchPlace[]): Promise<Map<number, FavWeather>>;
}
