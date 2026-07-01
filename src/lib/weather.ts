import { fetchWithTimeout, apiUrl } from "./http";

export interface CurrentWeather {
  time: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  isDay: boolean;
}
export interface HourlyEntry {
  time: string;
  temperature: number;
  apparentTemperature: number;
  precipitationProbability: number;
  weatherCode: number;
  windSpeed?: number; // optional: Forecast-Caches vor dem Trockenfenster-Feature haben das Feld nicht
  // Reichere Stundendaten fürs spätere Stundendetail-Panel. Alle optional:
  // ältere localStorage-Forecast-Caches kennen diese Felder nicht (dann
  // undefined, das Panel lässt fehlende Werte aus). Open-Meteo-Defaults liefern
  // die Einheiten in Klammern, kein zusätzlicher Query-Parameter nötig.
  relativeHumidity?: number; // %
  dewPoint?: number; // °C
  precipitation?: number; // mm (Summe der Vorstunde)
  windDirection?: number; // °
  windGusts?: number; // km/h (Max der Vorstunde)
  cloudCover?: number; // %
  pressure?: number; // hPa (pressure_msl)
  uvIndex?: number; // Index
  snowfall?: number; // cm (Summe der Vorstunde)
  visibility?: number; // m
}
export interface DailyEntry {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipitationProbabilityMax: number;
  sunrise: string | null; // ISO Zeit lokaler Stationszeit
  sunset: string | null;
  uvIndexMax: number | null;
  sunshineDuration?: number; // Sekunden pro Tag (optional wegen alter Caches)
}
export interface Forecast {
  current: CurrentWeather;
  hourly: HourlyEntry[];
  daily: DailyEntry[];
  timezone: string;
  // Gestriger Tageshöchstwert für den Vergleich "wärmer/kühler als gestern".
  // null wenn die API ihn nicht liefert; Forecast-Caches vor diesem Feature
  // haben das Feld gar nicht (undefined) — Konsumenten prüfen per typeof.
  yesterdayTempMax: number | null;
}

// Ruft die eigene Server Route auf statt Open-Meteo direkt: kein API Key im
// Browser, die Zusammenstellung von current/hourly/daily und das Mapping auf
// dieses Modell laufen serverseitig im Provider
// (src/server/weather/providers/OpenMeteoProvider.ts).
export async function fetchWeather(latitude: number, longitude: number): Promise<Forecast> {
  const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
  const res = await fetchWithTimeout(apiUrl(`/api/weather?${params}`));
  if (!res.ok) throw new Error(`Weather request failed: ${res.status}`);
  return (await res.json()) as Forecast;
}

// Ein Tag gilt als vollständig, wenn Hoch, Tief und Wettercode echte Zahlen
// sind. Bewusst Number.isFinite und NICHT !d.tempMax: 0 °C ist ein gültiger
// Wert (Number.isFinite(0) === true), ein echter Frost-/Nulltag bleibt also
// erhalten. Nur null/undefined (fehlende API-Werte) werden als unvollständig
// erkannt. Die eigentliche Filterung läuft inzwischen serverseitig
// (OpenMeteoProvider); bleibt hier exportiert für Bestandsschutz der
// öffentlichen API dieses Moduls.
export function isCompleteDay(d: DailyEntry): boolean {
  return (
    Number.isFinite(d.tempMax) &&
    Number.isFinite(d.tempMin) &&
    typeof d.weatherCode === "number"
  );
}
