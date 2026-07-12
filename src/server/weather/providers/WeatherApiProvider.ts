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
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
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
    1012: 1012, 1015: 1015, 1018: 1018, 1021: 1021, 1024: 1024, 1027: 1027,
    1030: 45, 1033: 1033, 1036: 1036, 1039: 1039, 1042: 1042, 1045: 1045, 1048: 1048,
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
  const ozone = optionalNumber(raw.o3);
  const nitrogenDioxide = optionalNumber(raw.no2);
  const sulphurDioxide = optionalNumber(raw.so2);
  const carbonMonoxide = optionalNumber(raw.co);
  if ([usEpaIndex, pm25, pm10, ozone, nitrogenDioxide, sulphurDioxide, carbonMonoxide].every((v) => v === undefined)) return null;
  return {
    usEpaIndex: usEpaIndex ?? null,
    pm25: pm25 ?? null,
    pm10: pm10 ?? null,
    ozone: ozone ?? null,
    nitrogenDioxide: nitrogenDioxide ?? null,
    sulphurDioxide: sulphurDioxide ?? null,
    carbonMonoxide: carbonMonoxide ?? null,
  };
}

// Ortsfilter für Warnungen. WeatherAPI liefert für einen Ort teils Warnungen
// ganz anderer Regionen mit (z. B. für Mailand in Lombardia auch Basilicata,
// Puglia, Campania). Wir gleichen alert.areas mit location.region ab und blenden
// nur dann aus, wenn wir SICHER sind, dass die Warnung fremde Regionen benennt.
// Im Zweifel bleibt sie sichtbar (bewusst nicht aggressiv). location.region und
// alert.areas stammen aus derselben WeatherAPI Antwort, daher ist die
// Schreibweise am ehesten konsistent — deshalb filtern wir hier im Provider.
const MAX_ALERTS = 10;

// Ländernamen-Synonyme, um in alert.areas das Muster "<Land> <Region>" zu
// erkennen (z. B. "Italia Basilicata"). WeatherAPI mischt bei europäischen
// Meteoalarm-Meldungen Englisch, Landessprache und Nutzersprache. Die Gruppen
// decken deshalb Europa breit ab. Unbekannte Formate landen weiterhin im
// sicheren Zweig und werden nicht gefiltert.
const COUNTRY_SYNONYMS: string[][] = [
  ["italy", "italia", "italien"],
  ["germany", "deutschland", "almanya"],
  ["netherlands", "nederland", "holland", "niederlande", "hollanda"],
  ["belgium", "belgie", "belgien", "belgique", "belcika"],
  ["turkey", "turkiye", "turkei"],
  ["poland", "polska", "polen", "polonya", "pologne", "polonia"],
  ["france", "frankreich", "fransa", "francia"],
  ["spain", "espana", "spanien", "ispanya", "spagna"],
  ["portugal"],
  ["austria", "osterreich", "avusturya"],
  ["switzerland", "schweiz", "suisse", "svizzera", "isvicre"],
  ["czechia", "czech republic", "cesko", "tschechien", "cekya"],
  ["slovakia", "slovensko", "slowakei", "slovakya"],
  ["slovenia", "slovenija", "slowenien", "slovenya"],
  ["croatia", "hrvatska", "kroatien", "hirvatistan"],
  ["hungary", "magyarorszag", "ungarn", "macaristan"],
  ["romania", "rumanien", "romanya"],
  ["bulgaria", "bulgariya", "bulgarien", "bulgaristan"],
  ["greece", "ellada", "griechenland", "yunanistan"],
  ["denmark", "danmark", "danemark", "danimarka"],
  ["norway", "norge", "norwegen", "norvec"],
  ["sweden", "sverige", "schweden", "isvec"],
  ["finland", "suomi", "finnland", "finlandiya"],
  ["ireland", "eire", "irland", "irlanda"],
  ["united kingdom", "great britain", "uk", "grossbritannien", "birlesik krallik"],
  ["estonia", "eesti", "estland", "estonya"],
  ["latvia", "latvija", "lettland", "letonya"],
  ["lithuania", "lietuva", "litauen", "litvanya"],
  ["serbia", "srbija", "serbien", "sirbistan"],
  ["bosnia and herzegovina", "bosna i hercegovina", "bosnien und herzegowina", "bosna hersek"],
  ["montenegro", "crna gora", "karadag"],
  ["north macedonia", "severna makedonija", "nordmazedonien", "kuzey makedonya"],
  ["albania", "shqiperia", "albanien", "arnavutluk"],
];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Diakritika entfernen (ü→u, ö→o, ç→c …)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildCountryWords(country: string): Set<string> {
  const norm = normalizeText(country);
  const words = new Set<string>();
  if (!norm) return words;
  const first = norm.split(" ")[0];
  for (const w of norm.split(" ")) if (w) words.add(w);
  for (const group of COUNTRY_SYNONYMS) {
    if (group.includes(norm) || group.includes(first)) {
      for (const syn of group) words.add(syn);
    }
  }
  return words;
}

// Nennt eine Meldung eindeutig ein anderes bekanntes Land, darf sie nicht als
// ortsbezogene Warnung durch den konservativen Fallback rutschen. Der Abgleich
// erfolgt wortweise, damit kurze Ländernamen nicht zufällig Teil anderer Wörter
// treffen. Meldungen, die das aktuelle Land ebenfalls nennen, werden weiterhin
// durch den bestehenden Regionenabgleich beurteilt.
function mentionsKnownForeignCountry(text: string, countryWords: Set<string>): boolean {
  const padded = ` ${normalizeText(text)} `;
  const mentions = (name: string): boolean => padded.includes(` ${normalizeText(name)} `);
  if ([...countryWords].some(mentions)) return false;
  return COUNTRY_SYNONYMS.some((group) => group.some(mentions));
}

function sharedPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// Loser Wortabgleich zwischen eigener Region und Gebietsregion. Großzügig
// gehalten (gemeinsames Wort ODER gemeinsamer Präfix ab 4 Zeichen), damit
// "Lombardy" und "Lombardia" als Treffer gelten und eine echte Warnung nie
// fälschlich verschwindet. Treffer = behalten (die sichere Richtung).
function regionMatches(regionNorm: string, areaRegionNorm: string): boolean {
  const rw = regionNorm.split(" ").filter((w) => w.length >= 3);
  const aw = areaRegionNorm.split(" ").filter((w) => w.length >= 3);
  for (const r of rw) {
    for (const a of aw) {
      if (r === a) return true;
      if (sharedPrefixLen(r, a) >= 4) return true;
    }
  }
  return false;
}

// Sammelt Kandidaten-Regionen aus alert.areas UND alert.headline. Live liefert
// WeatherAPI für die italienischen Meteoalarm-Warnungen KEIN areas-Feld; die
// Region steht nur in der headline ("... per l'Italia - Basilicata"). Daher wird
// beides ausgewertet. Ein Kandidat entsteht nur, wenn ein Landbezug erkennbar ist
// (Landpräfix in areas bzw. Landname in der headline), damit fremde Formate
// (z. B. deutsche Kreisnamen) nicht fälschlich als Region gedeutet werden.
function collectAreaRegions(areas: string, headline: string, countryWords: Set<string>): { candidates: string[]; nationwide: boolean } {
  const candidates: string[] = [];
  let nationwide = false;
  for (const entry of areas.split(/[;,\n]/).map(normalizeText).filter(Boolean)) {
    const words = entry.split(" ");
    let start = 0;
    while (start < words.length && countryWords.has(words[start])) start++;
    if (start === 0) continue; // kein Landpräfix → Format unklar → kein Kandidat
    const regionPart = words.slice(start).join(" ");
    if (!regionPart) nationwide = true; // Gebiet nennt nur das Land → landesweit
    else candidates.push(regionPart);
  }
  // headline nur auswerten, wenn sie den Landnamen trägt (Meteoalarm-Muster);
  // die Region ist das Segment nach dem letzten Trennstrich.
  const hlNorm = normalizeText(headline);
  if (hlNorm && [...countryWords].some((c) => hlNorm.includes(c))) {
    const parts = headline.split(/[-–—]/);
    if (parts.length >= 2) {
      const tailWords = normalizeText(parts[parts.length - 1]).split(" ").filter(Boolean);
      let s = 0;
      while (s < tailWords.length && countryWords.has(tailWords[s])) s++;
      const tail = tailWords.slice(s).join(" ");
      if (tail) candidates.push(tail);
    }
  }
  return { candidates, nationwide };
}

// true = Warnung für diesen Ort relevant (behalten). false NUR, wenn klare
// Kandidat-Regionen erkannt wurden und keine zur eigenen Region passt. Ohne
// Kandidaten, bei landesweiten Warnungen oder wenn die eigene Region unbekannt
// ist, bleibt die Warnung sichtbar (nie aggressiv). Bewusst NUR gegen die Region
// abgeglichen, nicht gegen den Ortsnamen: ein Ortsname kann zufällig mit einer
// fremden Region beginnen (z. B. "Puglianello" in Campania mit der Region
// "Puglia"), was sonst eine ortsfremde Warnung fälschlich sichtbar hält.
function alertMatchesLocation(areas: string, headline: string, regionNorm: string, countryWords: Set<string>): boolean {
  if (mentionsKnownForeignCountry(`${areas} ${headline}`, countryWords)) return false;
  const { candidates, nationwide } = collectAreaRegions(areas, headline, countryWords);
  if (nationwide) return true;
  if (candidates.length === 0) return true;
  if (!regionNorm) return true;
  for (const cand of candidates) {
    if (regionMatches(regionNorm, cand)) return true;
  }
  return false;
}

function weatherAlerts(value: unknown, region: string, country: string): WeatherAlert[] {
  const alerts = record(value).alert;
  if (!Array.isArray(alerts)) return [];
  const regionNorm = normalizeText(region);
  const countryWords = buildCountryWords(country);
  const out: WeatherAlert[] = [];
  const now = Date.now();
  for (const raw of alerts) {
    const alert = record(raw);
    const event = stringValue(alert.event).trim();
    const headline = stringValue(alert.headline).trim();
    if (!event && !headline) continue;
    if (!alertMatchesLocation(stringValue(alert.areas).trim(), headline, regionNorm, countryWords)) continue;
    const expires = stringValue(alert.expires).trim() || null;
    const expiresAt = expires ? Date.parse(expires) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= now) continue;
    out.push({
      event,
      headline,
      expires,
      severity: stringValue(alert.severity).trim() || null,
      urgency: stringValue(alert.urgency).trim() || null,
      effective: stringValue(alert.effective).trim() || null,
      desc: stringValue(alert.desc).trim() || null,
      instruction: stringValue(alert.instruction).trim() || null,
    });
  }
  return out
    .sort((a, b) => {
      const rank = (severity: string | null | undefined): number => {
        const normalized = severity?.toLowerCase();
        return normalized === "extreme" ? 4 : normalized === "severe" ? 3 : normalized === "moderate" ? 2 : normalized === "minor" ? 1 : 0;
      };
      const severityDiff = rank(b.severity) - rank(a.severity);
      if (severityDiff !== 0) return severityDiff;
      const aTime = a.effective ? Date.parse(a.effective) : Number.POSITIVE_INFINITY;
      const bTime = b.effective ? Date.parse(b.effective) : Number.POSITIVE_INFINITY;
      return (Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY) - (Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY);
    })
    .slice(0, MAX_ALERTS);
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
        moonrise: astroIso(date, astro.moonrise),
        moonset: astroIso(date, astro.moonset),
        moonPhase: stringValue(astro.moon_phase).trim() || null,
        moonIllumination: optionalNumber(astro.moon_illumination) ?? null,
        // Tages-Detailwerte fuers Tagespanel: liegen bereits im day-Objekt der
        // forecast.json Antwort, kein zusaetzlicher Call. optionalNumber -> undefined
        // wenn die API sie nicht liefert (dann blendet das Panel sie aus).
        windMax: optionalNumber(day.maxwind_kph),
        precipTotal: optionalNumber(day.totalprecip_mm),
        humidityAvg: optionalNumber(day.avghumidity),
      };
    })
    .filter(isCompleteDay);

  return {
    current,
    hourly,
    daily,
    timezone: stringValue(location.tz_id, "UTC"),
    airQuality: airQuality(currentData.air_quality),
    alerts: weatherAlerts(data.alerts, stringValue(location.region), stringValue(location.country)),
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
    const data = record(await requestJson("forecast.json", {
      q: `${place.latitude},${place.longitude}`,
      days: "1",
      aqi: "no",
      alerts: "yes",
    }));
    const current = record(data.current);
    const temp = optionalNumber(current.temp_c);
    const code = optionalNumber(record(current.condition).code);
    if (temp === undefined || code === undefined) throw new Error("WeatherAPI returned incomplete current data");
    const forecastDays = record(data.forecast).forecastday;
    const day = Array.isArray(forecastDays) && forecastDays.length > 0
      ? record(record(forecastDays[0]).day)
      : {};
    const location = record(data.location);
    return {
      id: place.id,
      weather: {
        temp,
        code: weatherApiCodeToWmo(code),
        isDay: finiteNumber(current.is_day, 1) === 1,
        rainChance: optionalNumber(day.daily_chance_of_rain) ?? null,
        hasAlert: weatherAlerts(data.alerts, stringValue(location.region), stringValue(location.country)).length > 0,
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
