const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

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
}
export interface DailyEntry {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipitationProbabilityMax: number;
}
export interface Forecast {
  current: CurrentWeather;
  hourly: HourlyEntry[];
  daily: DailyEntry[];
  timezone: string;
}

export async function fetchWeather(latitude: number, longitude: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "7",
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Weather request failed: ${res.status}`);
  return normalize(await res.json());
}

function normalize(data: any): Forecast {
  const c = data.current;
  const current: CurrentWeather = {
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
  const hourly: HourlyEntry[] = [];
  for (let i = start; i < start + 24 && i < h.time.length; i++) {
    hourly.push({
      time: h.time[i],
      temperature: h.temperature_2m[i],
      apparentTemperature: h.apparent_temperature[i],
      precipitationProbability: h.precipitation_probability?.[i] ?? 0,
      weatherCode: h.weather_code[i],
    });
  }

  const d = data.daily;
  const daily: DailyEntry[] = d.time.map((date: string, i: number) => ({
    date,
    weatherCode: d.weather_code[i],
    tempMax: d.temperature_2m_max[i],
    tempMin: d.temperature_2m_min[i],
    precipitationProbabilityMax: d.precipitation_probability_max?.[i] ?? 0,
  }));

  return { current, hourly, daily, timezone: data.timezone };
}
