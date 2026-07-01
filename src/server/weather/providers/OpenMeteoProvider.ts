// Eigenständige Kopie der Open-Meteo Abruflogik (1:1 aus src/lib/weather.ts,
// geocoding.ts, pollen.ts übernommen), bewusst NICHT über die src/lib
// Funktionen delegiert: sobald src/lib/weather.ts (Schritt "Server Routes")
// selbst auf eine eigene /api/weather Route umgestellt wird, würde eine
// Delegation hierher einen Kreislauf erzeugen (Provider ruft die Route auf,
// die den Provider aufruft). Diese Datei wird dann die einzige Quelle dieser
// Logik, src/lib/weather.ts verliert ihre eigene Kopie.
import { fetchWithTimeout } from "../../../lib/http";
import type { WeatherProvider, BatchPlace } from "../WeatherProvider";
import type { Forecast, DailyEntry, Place, PollenLevels, FavWeather } from "../types";
import { POLLEN_KINDS, type PollenKind } from "../../../lib/pollen";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

async function getForecast(latitude: number, longitude: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m,dew_point_2m,precipitation,wind_direction_10m,wind_gusts_10m,cloud_cover,pressure_msl,uv_index,snowfall,visibility",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max,sunshine_duration",
    timezone: "auto",
    forecast_days: "16",
    past_days: "1",
    forecast_hours: "48",
  });
  const res = await fetchWithTimeout(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Weather request failed: ${res.status}`);
  return normalizeForecast(await res.json());
}

function isCompleteDay(d: DailyEntry): boolean {
  return (
    Number.isFinite(d.tempMax) &&
    Number.isFinite(d.tempMin) &&
    typeof d.weatherCode === "number"
  );
}

function normalizeForecast(data: any): Forecast {
  const c = data.current;
  const current = {
    time: c.time,
    temperature: c.temperature_2m,
    apparentTemperature: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    windSpeed: c.wind_speed_10m,
    weatherCode: c.weather_code,
    isDay: c.is_day === 1,
  };

  const h = data.hourly;
  const start = Math.max(0, h.time.findIndex((t: string) => t >= c.time));
  const hourly = [];
  for (let i = start; i < start + 25 && i < h.time.length; i++) {
    hourly.push({
      time: h.time[i],
      temperature: h.temperature_2m[i],
      apparentTemperature: h.apparent_temperature[i],
      precipitationProbability: h.precipitation_probability?.[i] ?? 0,
      weatherCode: h.weather_code[i],
      windSpeed: h.wind_speed_10m?.[i] ?? undefined,
      relativeHumidity: h.relative_humidity_2m?.[i] ?? undefined,
      dewPoint: h.dew_point_2m?.[i] ?? undefined,
      precipitation: h.precipitation?.[i] ?? undefined,
      windDirection: h.wind_direction_10m?.[i] ?? undefined,
      windGusts: h.wind_gusts_10m?.[i] ?? undefined,
      cloudCover: h.cloud_cover?.[i] ?? undefined,
      pressure: h.pressure_msl?.[i] ?? undefined,
      uvIndex: h.uv_index?.[i] ?? undefined,
      snowfall: h.snowfall?.[i] ?? undefined,
      visibility: h.visibility?.[i] ?? undefined,
    });
  }

  const d = data.daily;
  const todayDate = c.time.slice(0, 10);
  const todayIdx = Math.max(0, d.time.findIndex((t: string) => t >= todayDate));
  const rawYesterdayMax = todayIdx > 0 ? d.temperature_2m_max?.[todayIdx - 1] : null;
  const yesterdayTempMax = typeof rawYesterdayMax === "number" ? rawYesterdayMax : null;
  const daily: DailyEntry[] = d.time
    .slice(todayIdx)
    .map((date: string, j: number) => {
      const i = todayIdx + j;
      return {
        date,
        weatherCode: d.weather_code[i],
        tempMax: d.temperature_2m_max[i],
        tempMin: d.temperature_2m_min[i],
        precipitationProbabilityMax: d.precipitation_probability_max?.[i] ?? 0,
        sunrise: d.sunrise?.[i] ?? null,
        sunset: d.sunset?.[i] ?? null,
        uvIndexMax: d.uv_index_max?.[i] ?? null,
        sunshineDuration: d.sunshine_duration?.[i] ?? undefined,
      };
    })
    .filter(isCompleteDay);

  return { current, hourly, daily, timezone: data.timezone, yesterdayTempMax };
}

const ALLOWED_FEATURE_PREFIXES = ["PPL"];
const RESULT_COUNT = 5;
const MAX_QUERY_LEN = 100;

function isPlaceResult(r: any): boolean {
  return (
    typeof r?.feature_code === "string" &&
    ALLOWED_FEATURE_PREFIXES.some((prefix) => r.feature_code.startsWith(prefix))
  );
}

async function searchPlaces(query: string, language = "de"): Promise<Place[]> {
  const q = query.trim().slice(0, MAX_QUERY_LEN);
  if (q.length < 2) return [];
  const params = new URLSearchParams({ name: q, count: String(RESULT_COUNT * 2), language, format: "json" });
  const res = await fetchWithTimeout(`${GEOCODING_URL}?${params}`);
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter(isPlaceResult)
    .slice(0, RESULT_COUNT)
    .map((r: any) => ({
      id: r.id,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      country: r.country,
      countryCode: r.country_code,
      admin1: r.admin1,
    }));
}

function nowInZone(timezone: unknown): string | null {
  if (typeof timezone !== "string" || timezone === "") return null;
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replace(" ", "T");
  } catch {
    return null;
  }
}

function readCurrentValue(series: unknown[], times: string[], idx: number): number | null {
  const day = times[idx]?.slice(0, 10);
  for (let i = idx; i >= 0; i--) {
    if (times[i]?.slice(0, 10) !== day) break;
    const value = series[i];
    if (typeof value === "number") return value;
  }
  return null;
}

async function getPollen(latitude: number, longitude: number): Promise<PollenLevels | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      hourly: POLLEN_KINDS.map((k) => `${k}_pollen`).join(","),
      timezone: "auto",
    });
    const res = await fetchWithTimeout(`${AIR_QUALITY_URL}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const h = data?.hourly;
    if (!h?.time?.length) return null;

    const now = nowInZone(data.timezone);
    const idx = now === null ? 0 : Math.max(0, h.time.findIndex((t: string) => t >= now));

    const levels = {} as Record<PollenKind, number | null>;
    for (const kind of POLLEN_KINDS) {
      const series = h[`${kind}_pollen`];
      levels[kind] = Array.isArray(series) ? readCurrentValue(series, h.time, idx) : null;
    }
    return levels;
  } catch {
    return null;
  }
}

async function getCurrentBatch(places: BatchPlace[]): Promise<Map<number, FavWeather>> {
  const out = new Map<number, FavWeather>();
  if (places.length === 0) return out;

  const params = new URLSearchParams({
    latitude: places.map((p) => String(p.latitude)).join(","),
    longitude: places.map((p) => String(p.longitude)).join(","),
    current: "temperature_2m,weather_code,is_day",
    timezone: "auto",
  });
  const res = await fetchWithTimeout(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Favorites weather request failed: ${res.status}`);
  const data = await res.json();

  // Bei mehreren Orten liefert Open-Meteo ein Array von Orts-Objekten, bei
  // genau einem Ort ein einzelnes Objekt.
  const list: unknown[] = Array.isArray(data) ? data : [data];

  // Zuordnung strikt über die Reihenfolge, siehe favoritesWeather.ts.
  for (let i = 0; i < places.length && i < list.length; i++) {
    const cur = (list[i] as { current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown } })?.current;
    const temp = cur?.temperature_2m;
    const code = cur?.weather_code;
    if (
      typeof temp === "number" && Number.isFinite(temp) &&
      typeof code === "number" && Number.isFinite(code)
    ) {
      out.set(places[i].id, { temp, code, isDay: cur?.is_day !== 0 });
    }
  }
  return out;
}

export const openMeteoProvider: WeatherProvider = {
  id: "OPEN_METEO",
  getForecast,
  getPollen,
  searchPlaces,
  getCurrentBatch,
};
