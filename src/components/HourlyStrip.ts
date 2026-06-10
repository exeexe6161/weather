import type { HourlyEntry } from "../lib/weather";
import { pickIcon, getWmo } from "../lib/wmo";
import { weatherLabel } from "../i18n/weather-labels";
import { formatHour, formatTemp } from "../lib/format";
import { getLang, getLocale } from "../i18n/ui";
import { esc } from "../dom";

// Heuristik: hourly liefert kein is_day Flag (src/lib bleibt brief-exakt),
// daher gelten 06:00 bis 19:59 lokaler Stationszeit als Tag.
function hourIsDay(iso: string): boolean {
  const hour = Number(iso.slice(11, 13));
  return hour >= 6 && hour < 20;
}

export function renderHourlyStrip(el: HTMLElement, hourly: HourlyEntry[]): void {
  const locale = getLocale();
  el.innerHTML = hourly
    .map((h) => {
      const icon = pickIcon(h.weatherCode, hourIsDay(h.time));
      const label = weatherLabel(getWmo(h.weatherCode).labelKey, getLang());
      return `<div class="hour-cell" role="listitem">
        <div class="hour-time">${formatHour(h.time, locale)}</div>
        <i data-lucide="${icon}" class="hour-ico" role="img" aria-label="${esc(label)}"></i>
        <div class="hour-temp">${formatTemp(h.temperature)}</div>
      </div>`;
    })
    .join("");
}
