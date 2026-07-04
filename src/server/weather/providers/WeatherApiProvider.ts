import { fetchWithTimeout } from "../../../lib/http.js";
import { POLLEN_KINDS, type PollenKind } from "../../../lib/pollen.js";
import type { BatchPlace, WeatherProvider } from "../WeatherProvider.js";
import type { AirQuality, DailyEntry, FavWeather, Forecast, Place, PollenLevels, WeatherAlert } from "../types.js";

const BASE_URL = "https://api.weatherapi.com/v1";
const RESULT_COUNT = 5;
const MAX_QUERY_LEN = 100;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? value as JsonRecord : {};
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = optionalNumber(value);
  if (parsed === undefined) throw new Error(`WeatherAPI response missing ${field}`);
  return parsed;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function apiKey(): string {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const key = runtime.process?.env?.WEATHERAPI_KEY?.trim();
  if (!key) throw new Error("WeatherAPI is not configured");
  return key;
}

function apiUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ key: apiKey(), ...params });
  return `${BASE_URL}/${path}?${query}`;
}

async function requestJson(path: string, params: Record<string, string>): Promise<unknown> {
  const response = await fetchWithTimeout(apiUrl(path, params));
  if (!response.ok) throw new Error(`WeatherAPI request failed: ${response.status}`);
  return response.json();
}

// WeatherAPI Conditions werden auf das bestehende interne WMO Modell
// abgebildet. Dadurch bleiben Texte, pickIcon und alle UI Komponenten stabil.
export function weatherApiCodeToWmo(code: number): number {
  const map: Record<number, number> = {
    1000: 0, 1003: 2, 1006: 3, 1009: 3,
    1012: 45, 1015: 45, 1018: 45, 1021: 45, 1024: 45, 1027: 45,
    1030: 45, 1033: 45, 1036: 45, 1039: 45, 1042: 45, 1045: 45, 1048: 45,
    1063: 80, 1066: 85, 1069: 85, 1072: 56, 1087: 95,
    1114: 73, 1117: 75, 1135: 45, 1147: 48,
    1150: 51, 1153: 51, 1168: 56, 1171: 57,
    1180: 80, 1183: 61, 1186: 81, 1189: 63, 1192: 82, 1195: 65,
    1198: 66, 1201: 67, 1204: 71, 1207: 73,
    1210: 85, 1213: 71, 1216: 85, 1219: 73, 1222: 86, 1225: 75,
    1237: 77, 1240: 80, 1243: 81, 1246: 82,
    1249: 85, 1252: 86, 1255: 85, 1258: 86, 1261: 85, 1264: 86,
    1273: 95, 1276: 95, 1279: 96, 1282: 99,
  };
  return map[code] ?? 3;
}

function conditionCode(value: unknown): number {
  return weatherApiCodeToWmo(requiredNumber(record(value).code, "condition.code"));
}

function localIso(value: unknown): string {
  return stringValue(value).replace(" ", "T");
}

function astroIso(date: string, value: unknown): string | null {
  const time = stringValue(value).trim();
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return `${date}T${String(hour).padStart(2, "0")}:${match[2]}`;
}

// WeatherAPI liefert fuer milde Forecast-Stunden teilweise unplausibel starke
// Abweichungen im Feld feelslike_c. Die uebliche meteorologische Definition
// setzt Windchill nur bei Kaelte und Hitzeindex nur bei Hitze ein; im milden
// Bereich entspricht die gefuehlte Temperatur der Lufttemperatur.
export function apparentTemperature(tempC: number, humidity: number, windKph: number): number {
  let result = tempC;
  if (tempC <= 10 && windKph >= 4.8) {
    const windFactor = Math.pow(windKph, 0.16);
    result = 13.12 + 0.6215 * tempC - 11.37 * windFactor + 0.3965 * tempC * windFactor;
  } else if (tempC >= 27 && humidity >= 40) {
    const tempF = tempC * 9 / 5 + 32;
    const heatF =
      -42.379 + 2.04901523 * tempF + 10.14333127 * humidity
      - 0.22475541 * tempF * humidity - 0.00683783 * tempF * tempF
      - 0.05481717 * humidity * humidity + 0.00122874 * tempF * tempF * humidity
      + 0.00085282 * tempF * humidity * humidity
      - 0.00000199 * tempF * tempF * humidity * humidity;
    result = Math.max(tempC, (heatF - 32) * 5 / 9);
  }
  return Math.round(result * 10) / 10;
}

function airQuality(value: unknown): AirQuality | null {
  const raw = record(value);
  const usEpaIndex = optionalNumber(raw["us-epa-index"]);
  const pm25 = optionalNumber(raw.pm2_5);
  const pm10 = optionalNumber(raw.pm10);
  if (usEpaIndex === undefined && pm25 === undefined && pm10 === undefined) return null;
  return {
    usEpaIndex: usEpaIndex ?? null,
    pm25: pm25 ?? null,
    pm10: pm10 ?? null,
  };
}

function weatherAlerts(value: unknown): WeatherAlert[] {
  const alerts = record(value).alert;
  if (!Array.isArray(alerts)) return [];
  return alerts.slice(0, 3).flatMap((value) => {
    const alert = record(value);
    const event = stringValue(alert.event).trim();
    const headline = stringValue(alert.headline).trim();
    if (!event && !headline) return [];
    return [{
      event,
      headline,
      expires: stringValue(alert.expires).trim() || null,
    }];
  });
}

function isCompleteDay(day: DailyEntry): boolean {
  return Number.isFinite(day.tempMax) && Number.isFinite(day.tempMin) && Number.isFinite(day.weatherCode);
}

function yesterdayDate(localtime: string): string {
  const date = new Date(`${localtime.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function getYesterdayMax(latitude: number, longitude: number, localtime: string): Promise<number | null> {
  try {
    const data = record(await requestJson("history.json", {
      q: `${latitude},${longitude}`,
      dt: yesterdayDate(localtime),
    }));
    const days = record(data.forecast).forecastday;
    if (!Array.isArray(days) || days.length === 0) return null;
    const value = optionalNumber(record(record(days[0]).day).maxtemp_c);
    return value ?? null;
  } catch {
    return null;
  }
}

async function getForecast(latitude: number, longitude: number): Promise<Forecast> {
  const data = record(await requestJson("forecast.json", {
    q: `${latitude},${longitude}`,
    days: "7",
    aqi: "yes",
    alerts: "yes",
  }));
  const location = record(data.location);
  const currentData = record(data.current);
  const forecastDays = record(data.forecast).forecastday;
  if (!Array.isArray(forecastDays) || forecastDays.length === 0) {
    throw new Error("WeatherAPI returned no forecast days");
  }

  const localtime = localIso(location.localtime);
  if (localtime.length < 16) throw new Error("WeatherAPI response missing location.localtime");
  const currentTemperature = requiredNumber(currentData.temp_c, "current.temp_c");
  const currentHumidity = requiredNumber(currentData.humidity, "current.humidity");
  const currentWind = requiredNumber(currentData.wind_kph, "current.wind_kph");
  const current = {
    // Fuer Tagesgrenzen und das rollende Stundenfenster zaehlt die aktuelle
    // Ortszeit. last_updated kann kurz nach Mitternacht noch am Vortag liegen.
    time: localtime,
    temperature: currentTemperature,
    apparentTemperature: apparentTemperature(currentTemperature, currentHumidity, currentWind),
    humidity: currentHumidity,
    windSpeed: currentWind,
    weatherCode: conditionCode(currentData.condition),
    isDay: finiteNumber(currentData.is_day, 1) === 1,
  };

  const currentHour = `${localtime.slice(0, 13)}:00`;
  const hourly = forecastDays
    .flatMap((rawDay) => {
      const hours = record(rawDay).hour;
      return Array.isArray(hours) ? hours : [];
    })
    .map((rawHour) => {
      const hour = record(rawHour);
      const temperature = requiredNumber(hour.temp_c, "hour.temp_c");
      const humidity = requiredNumber(hour.humidity, "hour.humidity");
      const windSpeed = requiredNumber(hour.wind_kph, "hour.wind_kph");
      return {
        time: localIso(hour.time),
        temperature,
        apparentTemperature: apparentTemperature(temperature, humidity, windSpeed),
        precipitationProbability: finiteNumber(hour.chance_of_rain),
        weatherCode: conditionCode(hour.condition),
        windSpeed,
        relativeHumidity: humidity,
        dewPoint: optionalNumber(hour.dewpoint_c),
        precipitation: optionalNumber(hour.precip_mm),
        windDirection: optionalNumber(hour.wind_degree),
        windGusts: optionalNumber(hour.gust_kph),
        cloudCover: optionalNumber(hour.cloud),
        pressure: optionalNumber(hour.pressure_mb),
        uvIndex: optionalNumber(hour.uv),
        snowfall: optionalNumber(hour.snow_cm),
        visibility: optionalNumber(hour.vis_km) === undefined ? undefined : finiteNumber(hour.vis_km) * 1000,
      };
    })
    .filter((hour) => hour.time >= currentHour)
    .slice(0, 25);

  const daily: DailyEntry[] = forecastDays
    .slice(0, 7)
    .map((rawDay) => {
      const wrapper = record(rawDay);
      const date = stringValue(wrapper.date);
      const day = record(wrapper.day);
      const astro = record(wrapper.astro);
      return {
        date,
        weatherCode: conditionCode(day.condition),
        tempMax: requiredNumber(day.maxtemp_c, "day.maxtemp_c"),
        tempMin: requiredNumber(day.mintemp_c, "day.mintemp_c"),
        precipitationProbabilityMax: finiteNumber(day.daily_chance_of_rain),
        sunrise: astroIso(date, astro.sunrise),
        sunset: astroIso(date, astro.sunset),
        uvIndexMax: optionalNumber(day.uv) ?? null,
      };
    })
    .filter(isCompleteDay);

  return {
    current,
    hourly,
    daily,
    timezone: stringValue(location.tz_id, "UTC"),
    airQuality: airQuality(currentData.air_quality),
    alerts: weatherAlerts(data.alerts),
    yesterdayTempMax: await getYesterdayMax(latitude, longitude, localtime),
  };
}

function stablePlaceId(place: JsonRecord): number {
  const supplied = optionalNumber(place.id);
  if (supplied !== undefined) return supplied;
  const input = `${place.lat}|${place.lon}|${place.name}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = Math.imul(31, hash) + input.charCodeAt(i) | 0;
  return Math.abs(hash) || 1;
}

async function searchPlaces(query: string, _language: string): Promise<Place[]> {
  const q = query.trim().slice(0, MAX_QUERY_LEN);
  if (q.length < 3) return [];
  const data = await requestJson("search.json", { q });
  if (!Array.isArray(data)) return [];
  return data.slice(0, RESULT_COUNT).flatMap((rawPlace) => {
    const place = record(rawPlace);
    const latitude = optionalNumber(place.lat);
    const longitude = optionalNumber(place.lon);
    if (latitude === undefined || longitude === undefined || stringValue(place.name) === "") return [];
    return [{
      id: stablePlaceId(place),
      name: stringValue(place.name),
      latitude,
      longitude,
      country: stringValue(place.country),
      countryCode: stringValue(place.country_code),
      admin1: stringValue(place.region) || undefined,
    }];
  });
}

function normalizedPollen(pollen: JsonRecord, kind: PollenKind): number | null {
  const normalized = new Map(
    Object.entries(pollen).map(([key, value]) => [key.toLowerCase().replace(/[^a-z]/g, ""), value])
  );
  const value = normalized.get(kind.replace(/[^a-z]/g, ""))
    ?? normalized.get(`${kind}pollen`);
  const parsed = optionalNumber(value);
  return parsed ?? null;
}

async function getPollen(latitude: number, longitude: number): Promise<PollenLevels | null> {
  try {
    const data = record(await requestJson("current.json", {
      q: `${latitude},${longitude}`,
      pollen: "yes",
      aqi: "no",
    }));
    const pollen = record(record(data.current).pollen);
    if (Object.keys(pollen).length === 0) return null;
    const levels = {} as Record<PollenKind, number | null>;
    for (const kind of POLLEN_KINDS) levels[kind] = normalizedPollen(pollen, kind);
    return levels;
  } catch {
    return null;
  }
}

async function getCurrentBatch(places: BatchPlace[]): Promise<Map<number, FavWeather>> {
  const out = new Map<number, FavWeather>();
  const responses = await Promise.allSettled(places.map(async (place) => {
    const data = record(await requestJson("current.json", {
      q: `${place.latitude},${place.longitude}`,
      aqi: "no",
    }));
    const current = record(data.current);
    const temp = optionalNumber(current.temp_c);
    const code = optionalNumber(record(current.condition).code);
    if (temp === undefined || code === undefined) throw new Error("WeatherAPI returned incomplete current data");
    return {
      id: place.id,
      weather: {
        temp,
        code: weatherApiCodeToWmo(code),
        isDay: finiteNumber(current.is_day, 1) === 1,
      },
    };
  }));
  for (const response of responses) {
    if (response.status === "fulfilled") out.set(response.value.id, response.value.weather);
  }
  return out;
}

export const weatherApiProvider: WeatherProvider = {
  id: "WEATHER_API",
  getForecast,
  getPollen,
  searchPlaces,
  getCurrentBatch,
};
