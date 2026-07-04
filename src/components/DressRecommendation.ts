import type { Forecast } from "../lib/weather";
import {
  stageFor,
  todayHours,
  segmentsFor,
  simplifySegments,
  rainWindowFor,
  RAIN_PROB_THRESHOLD,
  type StageKey,
  type StageSegment,
} from "../lib/clothing";
import { dryWindowFor } from "../lib/dryWindow";
import { formatPercent } from "../lib/format";
import { t } from "../i18n/ui";
import { esc } from "../dom";

// uiLabels kennen keine Parameter; {platzhalter} werden hier ersetzt
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => String(params[key] ?? ""));
}

// Verlauf von hinten verketten: "A bis HH Uhr, danach B bis HH Uhr, danach C".
// Wird nur ab zwei Segmenten gerendert, bei einem trägt die Überschrift allein.
function courseText(segments: StageSegment[]): string {
  let text = t(segments[segments.length - 1].stage);
  for (let i = segments.length - 2; i >= 0; i--) {
    text = fill(t("dress_until"), { stage: t(segments[i].stage), time: segments[i].toHour, next: text });
  }
  return text;
}

export function renderDressToday(el: HTMLElement, forecast: Forecast): void {
  const hours = todayHours(forecast.hourly, forecast.current.time);
  // Forecast Caches aus localStorage können noch ohne die neuen Stundenfelder
  // gespeichert sein; dann (und kurz vor Mitternacht ohne Reststunden) auf die
  // aktuelle gefühlte Temperatur zurückfallen.
  const usable = hours.length > 0 && typeof hours[0].apparentTemperature === "number";

  const segments: StageSegment[] = usable
    ? segmentsFor(hours)
    : [{ stage: stageFor(forecast.current.apparentTemperature), fromHour: 0, toHour: 24 }];
  const rain = usable ? rainWindowFor(hours) : null;
  // Gewitter zählt als Schirm-Grund, auch wenn die Wahrscheinlichkeit unter der
  // Schwelle bleibt (Gewittercode kann auch bei Prob < 40 auftreten). Dasselbe
  // Signal wie thunderLater in summary.ts; typeof fängt alte Caches ohne Feld
  // ab. Über den ganzen Resttag, damit jedes von der Summary gemeldete Gewitter
  // hier mit abgedeckt ist und kein "kein Regen mehr" widerspricht.
  const thunder = usable && hours.some((h) => typeof h.weatherCode === "number" && h.weatherCode >= 95);
  const wet = rain !== null || thunder;

  // Headline = Stufe der aktuellen Stunde, unverändert aus den Rohsegmenten.
  const currentStage: StageKey = segments[0].stage;
  const headline = wet ? `${t(currentStage)}, ${t("dress_add_rain")}` : t(currentStage);

  // Verlaufszeile: entschlackt (kurze Blitzstufen weg, höchstens drei
  // Abschnitte). Bleibt nur eine Stufe übrig, entfällt die Zeile ganz.
  const courseSegments = simplifySegments(segments);

  // Drei Regenvarianten: Fenster im Rest des Tages, kein Fenster mehr obwohl
  // das Tagesmaximum über der Schwelle lag (Regen war am Vormittag), oder
  // komplett trockener Tag
  const todayMax = forecast.daily[0]?.precipitationProbabilityMax;
  const rainText = rain
    ? fill(t("rain_window"), { prob: formatPercent(rain.maxProb), from: rain.fromHour, to: rain.toHour })
    : thunder
      ? t("rain_thunder")
      : typeof todayMax === "number" && todayMax >= RAIN_PROB_THRESHOLD
        ? t("rain_none_more")
        : t("rain_none");

  // Trockenes Fenster: seltener Hinweis, nur an gemischten Tagen mit
  // eigenständiger Information (dryWindowFor prüft alle Bedingungen inkl.
  // Überschneidungsschutz mit der Regenzeile oben)
  const dry = usable ? dryWindowFor(forecast) : null;
  const dryText = dry
    ? dry.untilSunset
      ? fill(t("dry_from"), { von: dry.fromHour })
      : fill(t("dry_window"), { von: dry.fromHour, bis: dry.toHour })
    : null;

  el.innerHTML = `
    <div class="dress-stage">${esc(headline)}</div>
    ${courseSegments.length > 1 ? `<div class="dress-course">${esc(courseText(courseSegments))}</div>` : ""}
    <div class="dress-rain">
      <i data-lucide="umbrella" class="dress-rain-ico${wet ? "" : " dress-rain-ico--calm"}"></i>
      <span>${esc(rainText)}</span>
    </div>
    ${dryText ? `<div class="dress-dry">
      <i data-lucide="cloud-sun" class="dress-dry-ico"></i>
      <span>${esc(dryText)}</span>
    </div>` : ""}
  `;
}
