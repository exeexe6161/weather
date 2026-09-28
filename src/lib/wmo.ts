export interface WmoInfo {
  icon: string;       // Lucide Icon, Tag oder neutral
  iconNight?: string; // Lucide Icon für Nacht, nur wenn abweichend
  labelKey: string;   // Key in weather-labels
}

export const wmoMap: Record<number, WmoInfo> = {
  0:  { icon: "sun",           iconNight: "moon",            labelKey: "wmo_clear" },
  1:  { icon: "cloud-sun",     iconNight: "cloud-moon",      labelKey: "wmo_mainly_clear" },
  2:  { icon: "cloud-sun",     iconNight: "cloud-moon",      labelKey: "wmo_partly_cloudy" },
  3:  { icon: "cloud",                                       labelKey: "wmo_overcast" },
  1012: { icon: "cloud-fog",                                labelKey: "weather_haze" },
  1015: { icon: "cloud-fog",                                labelKey: "weather_dust_haze" },
  1018: { icon: "wind",                                     labelKey: "weather_blowing_dust" },
  1021: { icon: "wind",                                     labelKey: "weather_dust_storm" },
  1024: { icon: "wind",                                     labelKey: "weather_sandstorm" },
  1027: { icon: "wind",                                     labelKey: "weather_severe_sandstorm" },
  1033: { icon: "cloud-fog",                                labelKey: "weather_smoke" },
  1036: { icon: "cloud-fog",                                labelKey: "weather_smoky_haze" },
  1039: { icon: "cloud-fog",                                labelKey: "weather_smog" },
  1042: { icon: "cloud-fog",                                labelKey: "weather_severe_smog" },
  1045: { icon: "wind",                                     labelKey: "weather_saharan_dust" },
  1048: { icon: "wind",                                     labelKey: "weather_dust" },
  45: { icon: "cloud-fog",                                   labelKey: "wmo_fog" },
  48: { icon: "cloud-fog",                                   labelKey: "wmo_rime_fog" },
  51: { icon: "cloud-drizzle",                               labelKey: "wmo_drizzle_light" },
  53: { icon: "cloud-drizzle",                               labelKey: "wmo_drizzle_moderate" },
  55: { icon: "cloud-drizzle",                               labelKey: "wmo_drizzle_dense" },
  56: { icon: "cloud-drizzle",                               labelKey: "wmo_freezing_drizzle_light" },
  57: { icon: "cloud-drizzle",                               labelKey: "wmo_freezing_drizzle_dense" },
  61: { icon: "cloud-rain",                                  labelKey: "wmo_rain_slight" },
  63: { icon: "cloud-rain",                                  labelKey: "wmo_rain_moderate" },
  65: { icon: "cloud-rain-wind",                             labelKey: "wmo_rain_heavy" },
  66: { icon: "cloud-rain",                                  labelKey: "wmo_freezing_rain_light" },
  67: { icon: "cloud-rain-wind",                             labelKey: "wmo_freezing_rain_heavy" },
  71: { icon: "cloud-snow",                                  labelKey: "wmo_snow_slight" },
  73: { icon: "cloud-snow",                                  labelKey: "wmo_snow_moderate" },
  75: { icon: "cloud-snow",                                  labelKey: "wmo_snow_heavy" },
  77: { icon: "snowflake",                                   labelKey: "wmo_snow_grains" },
  80: { icon: "cloud-sun-rain", iconNight: "cloud-moon-rain", labelKey: "wmo_rain_showers_slight" },
  81: { icon: "cloud-rain",                                  labelKey: "wmo_rain_showers_moderate" },
  82: { icon: "cloud-rain-wind",                             labelKey: "wmo_rain_showers_violent" },
  85: { icon: "cloud-snow",                                  labelKey: "wmo_snow_showers_slight" },
  86: { icon: "cloud-snow",                                  labelKey: "wmo_snow_showers_heavy" },
  95: { icon: "cloud-lightning",                             labelKey: "wmo_thunderstorm" },
  96: { icon: "cloud-hail",                                  labelKey: "wmo_thunderstorm_hail_slight" },
  99: { icon: "cloud-hail",                                  labelKey: "wmo_thunderstorm_hail_heavy" },
  // Providerzustände ohne eindeutige WMO Entsprechung behalten ihren WeatherAPI Code.
  1069: { icon: "cloud-snow", labelKey: "weather_sleet_possible" },
  1204: { icon: "cloud-snow", labelKey: "weather_sleet_light" },
  1207: { icon: "cloud-snow", labelKey: "weather_sleet_heavy" },
  1237: { icon: "cloud-hail", labelKey: "weather_ice_pellets" },
  1249: { icon: "cloud-snow", labelKey: "weather_sleet_showers_light" },
  1252: { icon: "cloud-snow", labelKey: "weather_sleet_showers_heavy" },
  1261: { icon: "cloud-hail", labelKey: "weather_ice_pellet_showers_light" },
  1264: { icon: "cloud-hail", labelKey: "weather_ice_pellet_showers_heavy" },
  1273: { icon: "cloud-lightning", labelKey: "weather_thunder_rain_light" },
  1276: { icon: "cloud-lightning", labelKey: "weather_thunder_rain_heavy" },
  1279: { icon: "cloud-lightning", labelKey: "weather_thunder_snow_light" },
  1282: { icon: "cloud-lightning", labelKey: "weather_thunder_snow_heavy" },
};

const fallback: WmoInfo = { icon: "circle-question-mark", labelKey: "wmo_unknown" };

export function getWmo(code: number): WmoInfo {
  return wmoMap[code] ?? fallback;
}

export function pickIcon(code: number, isDay: boolean): string {
  const info = getWmo(code);
  return !isDay && info.iconNight ? info.iconNight : info.icon;
}

// Niederschlagscodes nach WMO: 51-99 (Niesel, Regen, gefrierender Regen,
// Schnee, Schauer, Gewitter). Trockene Codes: 0-48.
export function isPrecipCode(code: number): boolean {
  return (code >= 51 && code <= 99) || [1069, 1204, 1207, 1237, 1249, 1252, 1261, 1264, 1273, 1276, 1279, 1282].includes(code);
}

export function isThunderCode(code: number): boolean {
  return (code >= 95 && code <= 99) || [1273, 1276, 1279, 1282].includes(code);
}

export function isRainCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code === 1273 || code === 1276;
}

export function isSnowCode(code: number): boolean {
  return (code >= 71 && code <= 77) || (code >= 85 && code <= 86) || [1069, 1204, 1207, 1249, 1252, 1279, 1282].includes(code);
}
