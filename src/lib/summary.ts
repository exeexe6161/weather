// Tageszusammenfassung: ein regelbasierter Klartext-Satz aus den vorhandenen
// Forecast-Daten. Keine neue API, kein KI Text zur Laufzeit, kein Speicher.
// Dieses Modul liefert nur i18n Keys (Ebene 1: fertiger Satz, Ebene 2:
// Bausteine); die sichtbare Copy entsteht in der Komponente über die uiLabels.
import type { Forecast } from "./weather";
import { isPrecipCode } from "./wmo";
import { todayHours, rainWindowFor, RAIN_PROB_THRESHOLD } from "./clothing";
import { UV_SHOW_THRESHOLD } from "./uv";

// ── Temperaturbänder (gefühlte Temperatur, Obergrenzen exklusiv), kalibrierbar
export const FROSTY_MAX = 0; // darunter: frostig
export const COLD_MAX = 8;
export const COOL_MAX = 15;
export const MILD_MAX = 22;
export const WARM_MAX = 28; // darüber: heiß

// ── Weitere Schwellen, kalibrierbar
export const WINDY_MIN = 25; // km/h, ab hier "windig"
export const HUMID_MIN = 65; // Prozent Luftfeuchte, ab hier "schwül"

// ── Tageszeitgrenzen (lokale Stunde des Orts), kalibrierbar
export const EVENING_FROM = 17;
export const NIGHT_FROM = 22;
export const NIGHT_UNTIL = 6; // exklusiv: ab 6 Uhr wieder Tag

export type TimeOfDay = "day" | "evening" | "night";

type Band = "frosty" | "cold" | "cool" | "mild" | "warm" | "hot";
type Sky = "sunny" | "friendly" | "cloudy" | "overcast" | "grey" | "rain" | "thunder";

export type Summary =
  | { kind: "fixed"; key: string }
  | { kind: "modular"; temp: string; sky: string; extra?: string; closer?: string };

// Lokale Stunde des Orts; dieselbe Intl-Mechanik wie Ortszeit und UV-Logik,
// nie Stunden von Hand addieren. null ohne/bei ungültiger timezone.
// Exportiert, damit dryWindow.ts dieselbe Mechanik nutzt statt sie zu kopieren.
export function localHour(timezone: unknown): number | null {
  if (typeof timezone !== "string" || timezone === "") return null;
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hour12: false }).format(new Date())
    );
    // hour12:false kann je nach ICU "24" für Mitternacht liefern
    return Number.isFinite(hour) ? hour % 24 : null;
  } catch {
    return null;
  }
}

export function timeOfDayFor(timezone: unknown): TimeOfDay | null {
  const hour = localHour(timezone);
  if (hour === null) return null;
  if (hour >= NIGHT_FROM || hour < NIGHT_UNTIL) return "night";
  if (hour >= EVENING_FROM) return "evening";
  return "day";
}

function bandFor(apparent: number): Band {
  if (apparent < FROSTY_MAX) return "frosty";
  if (apparent < COLD_MAX) return "cold";
  if (apparent < COOL_MAX) return "cool";
  if (apparent < MILD_MAX) return "mild";
  if (apparent < WARM_MAX) return "warm";
  return "hot";
}

// Himmel aus dem WMO Code, angelehnt an die bestehende wmoMap-Gliederung
function skyFor(code: number): Sky {
  if (code === 0) return "sunny";
  if (code === 1) return "friendly";
  if (code === 2) return "cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "grey";
  if (code >= 95) return "thunder";
  return "rain"; // 51-94: Niesel, Regen, Schnee, Schauer
}

// Wählt zuerst eine Ebene 1 Lage (fertiger Satz), sonst Ebene 2 (Bausteine).
// null, wenn kein sinnvoller Satz möglich ist (alte Caches ohne Felder oder
// timezone, oder nachts eine nicht nachttaugliche Himmelslage) — dann entfällt
// die Zeile einfach.
export function summaryFor(forecast: Forecast): Summary | null {
  const c = forecast.current;
  if (
    typeof c?.apparentTemperature !== "number" ||
    typeof c?.weatherCode !== "number" ||
    typeof c?.time !== "string"
  ) {
    return null;
  }
  const tod = timeOfDayFor(forecast.timezone);
  if (tod === null) return null;

  const band = bandFor(c.apparentTemperature);
  const sky = skyFor(c.weatherCode);
  const clearish = sky === "sunny" || sky === "friendly";
  const windy = typeof c.windSpeed === "number" && c.windSpeed >= WINDY_MIN;
  const humid = typeof c.humidity === "number" && c.humidity >= HUMID_MIN;

  // Regenlage aus den Reststunden des Tages (hourly beginnt bei jetzt)
  const rest = todayHours(forecast.hourly ?? [], c.time);
  const rainNow = isPrecipCode(c.weatherCode) && sky !== "thunder";
  const rainLater = !rainNow && rainWindowFor(rest) !== null;
  const thunderLater = rest.some((h) => typeof h.weatherCode === "number" && h.weatherCode >= 95);
  const todayMax = forecast.daily?.[0]?.precipitationProbabilityMax;
  // Regen war heute, Rest trocken (gleiche Logik wie die Anziehempfehlung)
  const rainWasOver =
    !rainNow && !rainLater && typeof todayMax === "number" && todayMax >= RAIN_PROB_THRESHOLD;
  const dry = !rainNow && !rainLater;

  const uvMax = forecast.daily?.[0]?.uvIndexMax;
  const uvHigh = typeof uvMax === "number" && uvMax >= UV_SHOW_THRESHOLD;

  // ── Nacht: nur Nacht-Sätze; tag- und abendbezogene Schlüsse sind tabu
  if (tod === "night") {
    if (clearish && band === "mild") return { kind: "fixed", key: "sum1_night_mild_clear" };
    if (clearish && (band === "frosty" || band === "cold")) return { kind: "fixed", key: "sum1_night_cold" };
    // Klarer Himmel außerhalb der Nacht-Sätze: "sonnig" wäre nachts Unsinn,
    // also Zeile weglassen. Bewölkte Lagen sind zeitneutral → Ebene 2.
    if (clearish) return null;
    return modular(band, sky, { rainNow, rainLater, thunderLater, windy, uvHigh: false, tod });
  }

  // ── Ebene 1, geordnete Liste: erster Treffer gewinnt
  if (thunderLater && humid) return { kind: "fixed", key: "sum1_thunder_humid" };
  if (rainNow && band === "mild") return { kind: "fixed", key: "sum1_rain_mild" };
  if (tod === "evening" && band === "mild" && rainWasOver) return { kind: "fixed", key: "sum1_rain_over_evening" };
  if (band === "hot" && humid) return { kind: "fixed", key: "sum1_hot_humid" };
  // Heiß plus hohe UV tagsüber: der Sonnenschutz-Schluss schlägt den fertigen
  // "viel trinken" Satz → Ebene 2 ("Heiß und sonnig, denk an Sonnenschutz.")
  if (band === "hot" && dry && !(uvHigh && tod === "day" && clearish)) {
    return { kind: "fixed", key: "sum1_hot_dry" };
  }
  if (band === "warm" && clearish && uvHigh && tod === "day") return { kind: "fixed", key: "sum1_warm_sunny_uv" };
  if (band === "warm" && clearish && dry) return { kind: "fixed", key: "sum1_warm_sunny" };
  if (band === "mild" && clearish && dry && tod === "day") return { kind: "fixed", key: "sum1_mild_sunny_day" };
  if (band === "mild" && rainLater) return { kind: "fixed", key: "sum1_mild_changeable" };
  if (band === "mild" && (sky === "overcast" || sky === "grey") && dry) return { kind: "fixed", key: "sum1_mild_grey" };
  if (band === "mild" && windy && dry) return { kind: "fixed", key: "sum1_mild_windy" };
  if (band === "cool" && rainLater && tod === "day") return { kind: "fixed", key: "sum1_cool_rain_later" };
  if (band === "cool" && clearish && dry) return { kind: "fixed", key: "sum1_cool_friendly" };
  if (band === "cool" && (sky === "cloudy" || sky === "overcast" || sky === "grey") && dry) {
    return { kind: "fixed", key: "sum1_cool_cloudy" };
  }
  if (band === "cold" && (sky === "overcast" || sky === "grey") && dry) return { kind: "fixed", key: "sum1_cold_overcast" };
  if (band === "cold" && dry) return { kind: "fixed", key: "sum1_cold_dry" };
  if (band === "frosty" && clearish && dry) return { kind: "fixed", key: "sum1_frosty_clear" };

  // ── Ebene 2, modular
  return modular(band, sky, { rainNow, rainLater, thunderLater, windy, uvHigh, tod });
}

interface ModularContext {
  rainNow: boolean;
  rainLater: boolean;
  thunderLater: boolean;
  windy: boolean;
  uvHigh: boolean;
  tod: TimeOfDay;
}

function modular(band: Band, sky: Sky, ctx: ModularContext): Summary | null {
  // Laufender Niederschlag/Gewitter hat kein eigenes Himmelswort in den
  // Bausteinen; "grau" plus Schirm-Schluss trägt die Information.
  const skyKey =
    sky === "rain" || sky === "thunder"
      ? "sum_s_grey"
      : sky === "sunny"
        ? "sum_s_sunny"
        : sky === "friendly"
          ? "sum_s_friendly"
          : sky === "cloudy"
            ? "sum_s_cloudy"
            : sky === "overcast"
              ? "sum_s_overcast"
              : "sum_s_grey";

  // Auffälliges: höchstens eines, Gewitter vor Regen vor Wind
  const extra = ctx.thunderLater
    ? "sum_x_thunder_later"
    : ctx.rainLater
      ? "sum_x_rain_later"
      : ctx.windy
        ? "sum_x_windy"
        : undefined;

  // Schluss: nur wenn handlungsrelevant und tageszeitlich passend, höchstens
  // einer (Schirm vor Sonnenschutz vor warm anziehen)
  const closer =
    ctx.rainNow || ctx.rainLater || ctx.thunderLater
      ? "sum_c_umbrella"
      : ctx.uvHigh && ctx.tod === "day" && (sky === "sunny" || sky === "friendly")
        ? "sum_c_sun"
        : band === "frosty" || band === "cold"
          ? "sum_c_warm"
          : undefined;

  return { kind: "modular", temp: `sum_t_${band}`, sky: skyKey, extra, closer };
}
