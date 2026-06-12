type Lang = "de" | "en" | "tr";

export const weatherLabels: Record<string, Record<Lang, string>> = {
  wmo_clear:                    { de: "Klarer Himmel",        en: "Clear sky",            tr: "Açık" },
  wmo_mainly_clear:             { de: "Überwiegend klar",     en: "Mainly clear",         tr: "Çoğunlukla açık" },
  wmo_partly_cloudy:            { de: "Teilweise bewölkt",    en: "Partly cloudy",        tr: "Parçalı bulutlu" },
  wmo_overcast:                 { de: "Bedeckt",              en: "Overcast",             tr: "Kapalı" },
  wmo_fog:                      { de: "Nebel",                en: "Fog",                  tr: "Sis" },
  wmo_rime_fog:                 { de: "Reifnebel",            en: "Rime fog",             tr: "Kırağılı sis" },
  wmo_drizzle_light:            { de: "Leichter Nieselregen", en: "Light drizzle",        tr: "Hafif çiseleme" },
  wmo_drizzle_moderate:         { de: "Nieselregen",          en: "Drizzle",              tr: "Çiseleme" },
  wmo_drizzle_dense:            { de: "Dichter Nieselregen",  en: "Dense drizzle",        tr: "Yoğun çiseleme" },
  wmo_freezing_drizzle_light:   { de: "Leichter gefrierender Nieselregen", en: "Light freezing drizzle", tr: "Hafif dondurucu çiseleme" },
  wmo_freezing_drizzle_dense:   { de: "Gefrierender Nieselregen", en: "Freezing drizzle", tr: "Dondurucu çiseleme" },
  wmo_rain_slight:              { de: "Leichter Regen",       en: "Slight rain",          tr: "Hafif yağmur" },
  wmo_rain_moderate:            { de: "Regen",                en: "Rain",                 tr: "Yağmur" },
  wmo_rain_heavy:               { de: "Starker Regen",        en: "Heavy rain",           tr: "Şiddetli yağmur" },
  wmo_freezing_rain_light:      { de: "Leichter gefrierender Regen", en: "Light freezing rain", tr: "Hafif dondurucu yağmur" },
  wmo_freezing_rain_heavy:      { de: "Gefrierender Regen",   en: "Heavy freezing rain",  tr: "Dondurucu yağmur" },
  wmo_snow_slight:              { de: "Leichter Schneefall",  en: "Slight snow",          tr: "Hafif kar" },
  wmo_snow_moderate:            { de: "Schneefall",           en: "Snow",                 tr: "Kar" },
  wmo_snow_heavy:               { de: "Starker Schneefall",   en: "Heavy snow",           tr: "Yoğun kar" },
  wmo_snow_grains:              { de: "Schneegriesel",        en: "Snow grains",          tr: "Kar taneleri" },
  wmo_rain_showers_slight:      { de: "Leichte Regenschauer", en: "Slight rain showers",  tr: "Hafif sağanak" },
  wmo_rain_showers_moderate:    { de: "Regenschauer",         en: "Rain showers",         tr: "Sağanak" },
  wmo_rain_showers_violent:     { de: "Heftige Regenschauer", en: "Violent rain showers", tr: "Şiddetli sağanak" },
  wmo_snow_showers_slight:      { de: "Leichte Schneeschauer", en: "Slight snow showers", tr: "Hafif kar sağanağı" },
  wmo_snow_showers_heavy:       { de: "Starke Schneeschauer", en: "Heavy snow showers",   tr: "Yoğun kar sağanağı" },
  wmo_thunderstorm:             { de: "Gewitter",             en: "Thunderstorm",         tr: "Gök gürültülü fırtına" },
  wmo_thunderstorm_hail_slight: { de: "Gewitter mit leichtem Hagel", en: "Thunderstorm with slight hail", tr: "Hafif dolu ile fırtına" },
  wmo_thunderstorm_hail_heavy:  { de: "Gewitter mit starkem Hagel",  en: "Thunderstorm with heavy hail",  tr: "Yoğun dolu ile fırtına" },
  wmo_unknown:                  { de: "Unbekannt",            en: "Unknown",              tr: "Bilinmiyor" },
};

export function weatherLabel(key: string, lang: Lang): string {
  return weatherLabels[key]?.[lang] ?? weatherLabels.wmo_unknown[lang];
}

// Kurzformen für den Tab-Titel: Tab-Titel werden schmal abgeschnitten, daher
// Intensitäten und Zusätze weglassen ("Leichter Regen" → "Regen"). Bewusst
// nach Gruppen statt je Code — die Nuance trägt im Tab keine Information.
const shortLabels: Record<string, Record<Lang, string>> = {
  clear:   { de: "Klar",        en: "Clear",    tr: "Açık" },
  cloudy:  { de: "Wolkig",      en: "Cloudy",   tr: "Bulutlu" },
  overcast:{ de: "Bedeckt",     en: "Overcast", tr: "Kapalı" },
  fog:     { de: "Nebel",       en: "Fog",      tr: "Sis" },
  drizzle: { de: "Nieselregen", en: "Drizzle",  tr: "Çiseleme" },
  rain:    { de: "Regen",       en: "Rain",     tr: "Yağmur" },
  snow:    { de: "Schnee",      en: "Snow",     tr: "Kar" },
  showers: { de: "Schauer",     en: "Showers",  tr: "Sağanak" },
  thunder: { de: "Gewitter",    en: "Storm",    tr: "Fırtına" },
};

const shortGroupByKey: Record<string, keyof typeof shortLabels> = {
  wmo_clear: "clear",
  wmo_mainly_clear: "clear",
  wmo_partly_cloudy: "cloudy",
  wmo_overcast: "overcast",
  wmo_fog: "fog",
  wmo_rime_fog: "fog",
  wmo_drizzle_light: "drizzle",
  wmo_drizzle_moderate: "drizzle",
  wmo_drizzle_dense: "drizzle",
  wmo_freezing_drizzle_light: "drizzle",
  wmo_freezing_drizzle_dense: "drizzle",
  wmo_rain_slight: "rain",
  wmo_rain_moderate: "rain",
  wmo_rain_heavy: "rain",
  wmo_freezing_rain_light: "rain",
  wmo_freezing_rain_heavy: "rain",
  wmo_snow_slight: "snow",
  wmo_snow_moderate: "snow",
  wmo_snow_heavy: "snow",
  wmo_snow_grains: "snow",
  wmo_rain_showers_slight: "showers",
  wmo_rain_showers_moderate: "showers",
  wmo_rain_showers_violent: "showers",
  wmo_snow_showers_slight: "snow",
  wmo_snow_showers_heavy: "snow",
  wmo_thunderstorm: "thunder",
  wmo_thunderstorm_hail_slight: "thunder",
  wmo_thunderstorm_hail_heavy: "thunder",
};

// Ohne Kurzform (unbekannter Code) fällt der Titel auf die volle Beschreibung
// zurück — gleiche Quelle wie das Label in der Karte, nie ein leerer Text.
export function weatherLabelShort(key: string, lang: Lang): string {
  const group = shortGroupByKey[key];
  return group ? shortLabels[group][lang] : weatherLabel(key, lang);
}
