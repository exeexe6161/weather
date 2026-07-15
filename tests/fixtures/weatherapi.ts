type JsonRecord = Record<string, unknown>;

export function alertFixture(overrides: JsonRecord = {}): JsonRecord {
  return {
    event: "Strong wind warning",
    headline: "Official warning for Germany - Hessen",
    areas: "Germany Hessen",
    severity: "Moderate",
    urgency: "Expected",
    effective: "2099-07-15T10:00:00+00:00",
    expires: "2099-07-16T10:00:00+00:00",
    desc: "Strong wind is possible in the affected area.",
    instruction: "Follow official local guidance.",
    ...overrides,
  };
}

interface ForecastFixtureOptions {
  alerts?: unknown[];
  country?: string;
  rainChance?: number;
  region?: string;
  temp?: number;
}

export function forecastFixture(options: ForecastFixtureOptions = {}): JsonRecord {
  const {
    alerts = [],
    country = "Germany",
    rainChance = 42,
    region = "Hessen",
    temp = 23,
  } = options;
  const date = "2099-07-15";
  const hour = (time: string, hourTemp: number): JsonRecord => ({
    time: `${date} ${time}`,
    temp_c: hourTemp,
    humidity: 55,
    wind_kph: 12,
    chance_of_rain: rainChance,
    condition: { code: 1000 },
    dewpoint_c: 12,
    precip_mm: 0.4,
    wind_degree: 220,
    gust_kph: 20,
    cloud: 15,
    pressure_mb: 1018,
    uv: 4,
    vis_km: 10,
  });

  return {
    location: {
      localtime: `${date} 12:30`,
      tz_id: "Europe/Berlin",
      region,
      country,
    },
    current: {
      temp_c: temp,
      humidity: 55,
      wind_kph: 12,
      is_day: 1,
      condition: { code: 1000 },
    },
    forecast: {
      forecastday: [{
        date,
        day: {
          condition: { code: 1003 },
          maxtemp_c: 26,
          mintemp_c: 15,
          daily_chance_of_rain: rainChance,
          uv: 5,
          maxwind_kph: 24,
          totalprecip_mm: 1.2,
          avghumidity: 58,
        },
        astro: {
          sunrise: "05:30 AM",
          sunset: "09:15 PM",
          moonrise: "11:00 PM",
          moonset: "08:15 AM",
          moon_phase: "Waxing Crescent",
          moon_illumination: 20,
        },
        hour: [hour("12:00", temp), hour("13:00", temp + 1)],
      }],
    },
    alerts: { alert: alerts },
  };
}

export function historyFixture(): JsonRecord {
  return {
    forecast: {
      forecastday: [{ day: { maxtemp_c: 22 } }],
    },
  };
}
