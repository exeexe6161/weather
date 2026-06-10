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
};

const fallback: WmoInfo = { icon: "cloud", labelKey: "wmo_unknown" };

export function getWmo(code: number): WmoInfo {
  return wmoMap[code] ?? fallback;
}

export function pickIcon(code: number, isDay: boolean): string {
  const info = getWmo(code);
  return !isDay && info.iconNight ? info.iconNight : info.icon;
}
