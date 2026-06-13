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
  windSpeed?: number; // optional: Forecast-Caches vor dem Trockenfenster-Feature haben das Feld nicht
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
  // Gefühlte Temperatur des HEUTIGEN Kalendertags (00:00..23:00 Stationszeit)
  // — für den Tagesverlauf (TempCurve), der auch die bereits vergangenen
  // Morgenstunden zeigt. Bewusst getrennt von `hourly` (jetzt→+24h, das
  // Stundenleiste/Trockenfenster brauchen). Alte Caches vor diesem Feld:
  // Konsument fällt auf [] zurück (Diagramm entfällt).
  hourlyToday: { time: string; apparentTemperature: number }[];
  // Erster Eintrag des Folgetags (00:00) als sauberer Abschluss bei Stunde 24;
  // null wenn die Antwort nicht so weit reicht.
  nextMidnight: { time: string; apparentTemperature: number } | null;
}

export async function fetchWeather(latitude: number, longitude: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max",
    timezone: "auto",
    forecast_days: "7",
    past_days: "1", // gestriger Tag in derselben daily Antwort (Vergleichszeile)
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
      windSpeed: h.wind_speed_10m?.[i] ?? undefined,
    });
  }

  const d = data.daily;
  // past_days=1 stellt dem daily Array den gestrigen Tag voran. Gestrigen
  // Höchstwert abzweigen und daily ab heute schneiden — die gesamte App
  // verlässt sich darauf, dass daily[0] der heutige Tag ist.
  const todayDate = c.time.slice(0, 10);
  const todayIdx = Math.max(0, d.time.findIndex((t: string) => t >= todayDate));
  const rawYesterdayMax = todayIdx > 0 ? d.temperature_2m_max?.[todayIdx - 1] : null;
  const yesterdayTempMax = typeof rawYesterdayMax === "number" ? rawYesterdayMax : null;
  const daily: DailyEntry[] = d.time.slice(todayIdx).map((date: string, j: number) => {
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
    };
  });

  // Heutiger Kalendertag für den Tagesverlauf: die Stundenwerte mit
  // Stationszeit-Datum == todayDate (Stunde 00..23), und der erste Eintrag des
  // Folgetags (00:00) separat als nextMidnight. data.hourly ist chronologisch,
  // heute liegt dank past_days=1 vollständig vor (inkl. der Morgenstunden, die
  // `hourly` wegschneidet). Bewusst getrennt: dayFeelsFromHourly mappt jeden
  // hourlyToday-Eintrag nach Stunde, da darf kein Folgetag-00:00 die eigene
  // 00:00 überschreiben. Fehlende Einzelstunden überbrückt die TempCurve.
  const hourlyToday: { time: string; apparentTemperature: number }[] = [];
  let nextMidnight: { time: string; apparentTemperature: number } | null = null;
  for (let i = 0; i < h.time.length; i++) {
    const day = h.time[i].slice(0, 10);
    if (day === todayDate) {
      hourlyToday.push({ time: h.time[i], apparentTemperature: h.apparent_temperature[i] });
    } else if (day > todayDate) {
      nextMidnight = { time: h.time[i], apparentTemperature: h.apparent_temperature[i] };
      break; // erster Folgetag-Eintrag = 00:00
    }
  }

  return { current, hourly, daily, timezone: data.timezone, yesterdayTempMax, hourlyToday, nextMidnight };
}
