import type { Forecast } from "../lib/weather";
import {
  stageFor,
  todayHours,
  segmentsFor,
  rainWindowFor,
  RAIN_PROB_THRESHOLD,
  type StageKey,
  type StageSegment,
} from "../lib/clothing";
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

  const currentStage: StageKey = segments[0].stage;
  const headline = rain ? `${t(currentStage)}, ${t("dress_add_rain")}` : t(currentStage);

  // Drei Regenvarianten: Fenster im Rest des Tages, kein Fenster mehr obwohl
  // das Tagesmaximum über der Schwelle lag (Regen war am Vormittag), oder
  // komplett trockener Tag
  const todayMax = forecast.daily[0]?.precipitationProbabilityMax;
  const rainText = rain
    ? fill(t("rain_window"), { prob: formatPercent(rain.maxProb), from: rain.fromHour, to: rain.toHour })
    : typeof todayMax === "number" && todayMax >= RAIN_PROB_THRESHOLD
      ? t("rain_none_more")
      : t("rain_none");

  el.innerHTML = `
    <div class="dress-stage">${esc(headline)}</div>
    ${segments.length > 1 ? `<div class="dress-course">${esc(courseText(segments))}</div>` : ""}
    <div class="dress-rain">
      <i data-lucide="umbrella" class="dress-rain-ico${rain ? "" : " dress-rain-ico--calm"}"></i>
      <span>${esc(rainText)}</span>
    </div>
  `;
}
