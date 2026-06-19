import type { Forecast } from "../lib/weather";
import { pickIcon, getWmo } from "../lib/wmo";
import { nightSpans, isNightAt } from "../lib/daylight";
import { weatherLabel } from "../i18n/weather-labels";
import { formatHour, formatTemp } from "../lib/format";
import { getLang, getLocale } from "../i18n/ui";
import { esc } from "../dom";

// Fallback-Heuristik für alte Forecast-Caches ohne sunrise/sunset:
// 06:00 bis 19:59 lokaler Stationszeit gelten als Tag. Mit Sonnenzeiten
// kippen die Symbole exakt am echten Sonnenauf-/untergang — dieselbe
// Quelle wie die Nacht-Tönung des Temperaturverlaufs darunter.
function hourIsDayHeuristic(iso: string): boolean {
  const hour = Number(iso.slice(11, 13));
  return hour >= 6 && hour < 20;
}

export function renderHourlyStrip(el: HTMLElement, forecast: Forecast): void {
  const locale = getLocale();
  const spans = nightSpans(forecast.daily);
  const cells = forecast.hourly
    .map((h) => {
      const isDay = spans !== null ? !isNightAt(h.time, spans) : hourIsDayHeuristic(h.time);
      const icon = pickIcon(h.weatherCode, isDay);
      const label = weatherLabel(getWmo(h.weatherCode).labelKey, getLang());
      return `<div class="hour-cell" role="listitem">
        <div class="hour-time">${formatHour(h.time, locale)}</div>
        <i data-lucide="${icon}" class="hour-ico"></i><span class="sr-only">${esc(label)}</span>
        <div class="hour-temp">${formatTemp(h.temperature)}</div>
      </div>`;
    })
    .join("");
  el.innerHTML = `<div class="hourly-track" role="list">${cells}</div>`;
}
