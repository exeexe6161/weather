import type { Forecast } from "../lib/weather";
import {
  stageFor,
  todayHours,
  segmentsFor,
  rainWindowFor,
  type StageKey,
  type StageSegment,
} from "../lib/clothing";
import { t } from "../i18n/ui";
import { esc } from "../dom";

// uiLabels kennen keine Parameter; {platzhalter} werden hier ersetzt
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => String(params[key] ?? ""));
}

// Verlauf von hinten verketten: "A bis HH Uhr, danach B bis HH Uhr, danach C"
function courseText(segments: StageSegment[]): string {
  if (segments.length === 1) return fill(t("dress_single"), { stage: t(segments[0].stage) });
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
  const rainText = rain
    ? fill(t("rain_window"), { prob: Math.round(rain.maxProb), from: rain.fromHour, to: rain.toHour })
    : t("rain_none");

  el.innerHTML = `
    <div class="dress-stage">${esc(headline)}</div>
    <div class="dress-course">${esc(courseText(segments))}</div>
    <div class="dress-rain">
      <i data-lucide="umbrella" class="dress-rain-ico"></i>
      <span>${esc(rainText)}</span>
    </div>
  `;
}
