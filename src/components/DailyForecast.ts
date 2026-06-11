import type { DailyEntry } from "../lib/weather";
import { pickIcon, getWmo, isPrecipCode } from "../lib/wmo";
import { weatherLabel } from "../i18n/weather-labels";
import { formatWeekday, formatTemp, formatPercent } from "../lib/format";
import { t, getLang, getLocale } from "../i18n/ui";
import { esc } from "../dom";

// Regenwahrscheinlichkeit erst ab dieser Schwelle (Prozent) zeigen; bei
// Niederschlagscodes (isPrecipCode) immer, sonst stünde ein Regensymbol ohne
// Wert da. Darunter bleibt der Slot leer (feste Spalte, Zeile verspringt nicht)
export const RAIN_SHOW_THRESHOLD = 30;

export function renderDailyForecast(el: HTMLElement, daily: DailyEntry[]): void {
  const locale = getLocale();
  el.innerHTML = daily
    .map((d, i) => {
      const icon = pickIcon(d.weatherCode, true);
      const label = weatherLabel(getWmo(d.weatherCode).labelKey, getLang());
      const day = i === 0 ? t("today") : formatWeekday(d.date, locale);
      // typeof Check fängt alte Forecast Caches ohne das Feld ab
      const rain =
        typeof d.precipitationProbabilityMax === "number" &&
        (isPrecipCode(d.weatherCode) || d.precipitationProbabilityMax >= RAIN_SHOW_THRESHOLD)
          ? d.precipitationProbabilityMax
          : null;
      return `<div class="day-row" role="listitem">
        <div class="day-name">${esc(day)}</div>
        <i data-lucide="${icon}" class="day-ico" role="img" aria-label="${esc(label)}"></i>
        <div class="day-label">${esc(label)}</div>
        <div class="day-rain">${rain !== null ? `<i data-lucide="droplets" class="day-rain-ico"></i><span>${formatPercent(rain)}</span>` : ""}</div>
        <div class="day-temps">
          <span class="day-max">${formatTemp(d.tempMax)}</span>
          <span class="day-min">${formatTemp(d.tempMin)}</span>
        </div>
      </div>`;
    })
    .join("");
}
