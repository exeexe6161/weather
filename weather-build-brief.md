# Weather App — Build Brief (Handoff für Claude Code)

Minimalistische Wetter App, lizenzfrei. Web PWA mit Astro 6 auf Vercel zuerst, iOS via Capacitor erst bei Traktion (Phase B Muster wie EVSpend). Kein eigenes Backend, local first, zero tracking, DE/EN/TR.

---

## ⚠️ Rechtlich zuerst (vor dem Bauen prüfen)

- **Open-Meteo Daten = CC BY 4.0.** Quellenangabe ist Pflicht und gehört fest in den Footer: `Wetterdaten von Open-Meteo.com · CC BY 4.0`. Der kostenlose Zugang gilt nur **nicht kommerziell**. Sobald Ads oder IAP dazukommen, braucht es ein bezahltes API Abo. Vor echtem Launch final gegenprüfen.
- **Standortdaten sind personenbezogen.** Browser Geolocation nur mit Einwilligung, opt-in. Beim API Call geht die IP an Open-Meteo (EU gehostet, Processor Situation vor Launch verifizieren).
- **Icons (Lucide, ISC)** und **Inter (OFL)** brauchen keine sichtbare Attribution, aber Lizenztext im Repo ablegen.

---

## Scaffold (Terminal)

1. EVSpend Struktur in einen **neuen, eigenen Ordner `weather`** kopieren (Geschwister neben den anderen Projekten, nicht innerhalb von EVSpend).
2. **Strippen:** komplette Rechen Engine und alles EV Spezifische raus (Calc Module, EV Texte, EV Assets, EV i18n Keys).
3. **Behalten:** Astro 6 + Vercel Setup, i18n Gerüst, Inter selbst gehostet (woff2), local first Muster, Security Header, Impressum + Datenschutz Struktur, zero tracking, Pre-commit Hooks, Capacitor Pfad.
4. Lucide als Dependency ergänzen (Icon Import passend zum EVSpend Island Muster).

---

## Dateibaum

```
src/
  lib/
    wmo.ts            WMO Code -> Icon + Label Key, pickIcon(code, isDay)
    weather.ts        Open-Meteo Forecast, getypt
    geocoding.ts      Städtesuche
    favorites.ts      localStorage CRUD (mit SSR Guard)
    format.ts         Temp, Wind, Zeit, locale aware
  i18n/
    weather-labels.ts Label Key -> de/en/tr
  components/
    WeatherApp        Island, hält State
      SearchBar       Suche + Geolocation opt-in
      CurrentWeather  aktuelle Bedingungen
      HourlyStrip     nächste 24h
      DailyForecast   7 Tage
      FavoritesList   gespeicherte Orte
  pages/
    index.astro       statische Hülle, mountet das Island, Footer mit Attribution
```

---

## Islands: Muster + Baureihenfolge

**Framework:** Exakt das bestehende EVSpend Island Muster übernehmen, damit beide Apps konsistent bleiben. Wenn EVSpend reines Vanilla TS nutzt, hier auch Vanilla TS, der State ist leicht genug. Die `src/lib` Schicht unten ist framework-agnostisch und funktioniert so oder so.

**Reihenfolge:**
1. Inter selbst hosten, Open-Meteo gegen feste Koordinaten testen, erst die Daten fließen sehen.
2. WMO Mapping + Icon Set, eine Stadt komplett rendern (current + hourly + daily).
3. Geocoding Suche, danach Favoriten in localStorage.
4. Geolocation opt-in mit Consent.
5. PWA Hülle: manifest, Service Worker, letzte Daten offline cachen.
6. DSGVO Abschluss (Checkliste unten).

Icons **immer** über `pickIcon(code, isDay)` ziehen, nie direkt aus der Map, sonst gehen die Nacht Varianten verloren.

---

## src/lib (fertige Implementierung)

### src/lib/wmo.ts
```ts
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
```

### src/lib/weather.ts
```ts
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
  weatherCode: number;
}
export interface DailyEntry {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
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
    hourly: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
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
    hourly.push({ time: h.time[i], temperature: h.temperature_2m[i], weatherCode: h.weather_code[i] });
  }

  const d = data.daily;
  const daily: DailyEntry[] = d.time.map((date: string, i: number) => ({
    date,
    weatherCode: d.weather_code[i],
    tempMax: d.temperature_2m_max[i],
    tempMin: d.temperature_2m_min[i],
  }));

  return { current, hourly, daily, timezone: data.timezone };
}
```

### src/lib/geocoding.ts
```ts
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  countryCode: string;
  admin1?: string;
}

export async function searchCity(query: string, language = "de"): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ name: q, count: "5", language, format: "json" });
  const res = await fetch(`${GEOCODING_URL}?${params}`);
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    countryCode: r.country_code,
    admin1: r.admin1,
  }));
}
```

### src/lib/favorites.ts
```ts
import type { Place } from "./geocoding";

const KEY = "weather:favorites";

export function getFavorites(): Place[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function isFavorite(id: number): boolean {
  return getFavorites().some((p) => p.id === id);
}

export function addFavorite(place: Place): Place[] {
  const next = [...getFavorites().filter((p) => p.id !== place.id), place];
  persist(next);
  return next;
}

export function removeFavorite(id: number): Place[] {
  const next = getFavorites().filter((p) => p.id !== id);
  persist(next);
  return next;
}

function persist(list: Place[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
}
```

### src/lib/format.ts
```ts
export function formatHour(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
export function formatWeekday(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: "short" });
}
export function formatTemp(value: number): string {
  return `${Math.round(value)}°`;
}
export function formatWind(value: number): string {
  return `${Math.round(value)} km/h`;
}
```

### src/i18n/weather-labels.ts
TR ist mitgeliefert, passend zu den anderen Apps. Falls diese App nur DE/EN wird, den TR Wert je Zeile löschen.
```ts
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
```

---

## Non-negotiables (Review Checkliste)

- [ ] Footer Attribution `Wetterdaten von Open-Meteo.com · CC BY 4.0` von Anfang an drin.
- [ ] Icons ausschließlich über `pickIcon(code, isDay)`.
- [ ] Suche ist Default, Geolocation ist opt-in mit Consent.
- [ ] `favorites.ts` SSR Guard bleibt (sonst kracht der Astro Build).
- [ ] Inter selbst gehostet als woff2, kein Google Fonts CDN, auf benötigte Sprachen subsetten.
- [ ] Lucide selbst gebündelt, kein Icon CDN.
- [ ] Kein eigenes Backend, kein Tracking, kein Cookie Banner (nur funktionaler localStorage).
- [ ] Sichtbare UI Copy ohne Bindestriche, umformulieren statt Bindestrich.

---

## DSGVO Abschluss (vor Launch)

- [ ] **Datenschutzerklärung:** Open-Meteo als Datenquelle nennen, IP Übermittlung beim API Call, localStorage für Favoriten, Geolocation nur nach Einwilligung. Rechtsgrundlage Art. 6(1)(f) DSGVO + §25(2)(2) TTDSG.
- [ ] **Impressum** übernehmen (bestehende Struktur, c/o Adresse).
- [ ] **Attribution** für Daten (CC BY 4.0) und Lizenztexte für Icons (ISC) und Inter (OFL) im Repo.
- [ ] **BFSG/Accessibility:** aria-labels auf alle Icon Buttons, Tastaturnavigation, focus-visible, aria-pressed wo Toggle.
- [ ] Open-Meteo Processor / Hosting Situation final verifizieren, kommerzielle Nutzung ausgeschlossen oder Abo geklärt.

---

## Standardregeln (gelten weiter)

- iamguer/anyhla Stil ist hier nicht relevant, aber: Commits sauber halten, Pre-commit Hook (Brand + Real Name Block) bleibt aktiv. Ein App Name darf keine geschützten Marken streifen, vor Festlegung kurz Trademark Check.
- Große Änderungen vor Ausführung als Diff zeigen.
- DSGVO Check vor jedem Feature mit Storage, externen Ressourcen, Audio, Video oder Tracking.
