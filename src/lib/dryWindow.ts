// Trockenes Zeitfenster: an einem gemischten Tag die eine nutzbare trockene
// Lücke bis Sonnenuntergang finden. Bewusst ein SELTENER Hinweis — alle
// Anzeigebedingungen müssen erfüllt sein, sonst null und die Zeile entfällt.
// Sprachneutral: liefert nur Stunden und das untilSunset-Flag, die Copy
// entsteht in der Komponente über die uiLabels.
import type { Forecast, HourlyEntry } from "./weather";
import { RAIN_PROB_THRESHOLD, todayHours, hourOf, rainWindowFor } from "./clothing";
import { localHour } from "./summary";

// ── Schwellen, kalibrierbar ──
export const DRY_WINDOW_MIN_HOURS = 2;     // kürzere Lücken sind kein nutzbares Fenster
export const DRY_WINDOW_MIN_REMAINING = 3; // Mindeststunden bis Sonnenuntergang, sonst lohnt der Hinweis nicht
export const DRY_WINDOW_WIND_MAX = 30;     // km/h: ein durchgehend so windiges Fenster zählt nicht als gut

export interface DryWindow {
  fromHour: number;
  toHour: number;       // exklusiv: ein Stundenwert deckt [Stunde, Stunde + 1) ab
  untilSunset: boolean; // Fenster reicht bis Sonnenuntergang → "Ab {von} Uhr trocken."
}

const isDry = (h: HourlyEntry): boolean => h.precipitationProbability < RAIN_PROB_THRESHOLD;

// Durchgehend sehr windig? Nur bewerten, wenn alle Stunden Windwerte tragen —
// alte Forecast-Caches ohne windSpeed lassen das Kriterium schlicht aus.
function allWindy(run: HourlyEntry[]): boolean {
  return run.every((h) => typeof h.windSpeed === "number" && h.windSpeed >= DRY_WINDOW_WIND_MAX);
}

export function dryWindowFor(forecast: Forecast): DryWindow | null {
  const c = forecast.current;
  const sunrise = forecast.daily?.[0]?.sunrise;
  const sunset = forecast.daily?.[0]?.sunset;
  if (typeof c?.time !== "string" || typeof sunrise !== "string" || typeof sunset !== "string") return null;

  // Nur tagsüber anzeigen; "jetzt" in Stationszeit über die gemeinsame
  // timezone-Mechanik. Wichtig: nach Mitternacht ist ebenfalls "nach
  // Sonnenuntergang" — die Sonnenaufgangs-Untergrenze fängt das ab (gleiche
  // Fehlerklasse wie die frühere UV-Mittagswarnung nachts).
  const nowHour = localHour(forecast.timezone);
  const sunsetHour = hourOf(sunset);
  if (nowHour === null || nowHour >= sunsetHour || nowHour < hourOf(sunrise)) return null;

  // Verbleibende Stunden von jetzt bis Sonnenuntergang (hourly beginnt bei jetzt)
  const dayHours = todayHours(forecast.hourly ?? [], c.time).filter(
    (h) => typeof h.precipitationProbability === "number" && hourOf(h.time) < sunsetHour
  );
  if (dayHours.length < DRY_WINDOW_MIN_REMAINING) return null;

  // Bedingung 1: gemischter Resttag. Ganz trocken → kein Mehrwert,
  // durchgehend nass → kein Fenster.
  const hasWet = dayHours.some((h) => !isDry(h));
  const hasDry = dayHours.some(isDry);
  if (!hasWet || !hasDry) return null;

  // Längstes zusammenhängendes trockenes Fenster; durchgehend windige Fenster
  // zählen nicht. Bei Gleichstand gewinnt das frühere.
  let best: HourlyEntry[] | null = null;
  let run: HourlyEntry[] = [];
  for (const h of [...dayHours, null]) {
    if (h !== null && isDry(h)) {
      run.push(h);
      continue;
    }
    if (run.length >= DRY_WINDOW_MIN_HOURS && !allWindy(run) && run.length > (best?.length ?? 0)) {
      best = run;
    }
    run = [];
  }
  if (best === null) return null;

  const fromHour = hourOf(best[0].time);
  const toHour = hourOf(best[best.length - 1].time) + 1;
  const untilSunset = toHour >= hourOf(dayHours[dayHours.length - 1].time) + 1;

  // Bedingung 4, Überschneidungsschutz: Ist das Fenster nur die Kehrseite des
  // Regenfensters aus der Anziehzeile, ist es offensichtlich und entfällt —
  // trocken von jetzt bis zum genannten Regenbeginn, oder vom Regenende bis
  // Sonnenuntergang. Eine Lücke MITTEN im nassen Tag (nach dem Regenfenster,
  // aber vor weiterem Regen) bleibt eigenständige Information.
  const rain = rainWindowFor(todayHours(forecast.hourly ?? [], c.time));
  if (rain) {
    const startsNow = fromHour === hourOf(dayHours[0].time);
    if (startsNow && toHour === rain.fromHour) return null;
    if (fromHour === rain.toHour && untilSunset) return null;
  }

  return { fromHour, toHour, untilSunset };
}
