import type { Forecast, HourlyEntry } from "../lib/weather";
import { formatHour, formatPercent, formatTemp, formatWind } from "../lib/format";
import { getLocale, t } from "../i18n/ui";
import { esc } from "../dom";

function maxBy(hours: HourlyEntry[], value: (hour: HourlyEntry) => number | undefined): HourlyEntry | null {
  return hours.reduce<HourlyEntry | null>((best, hour) => {
    const current = value(hour);
    if (typeof current !== "number" || !Number.isFinite(current)) return best;
    const previous = best ? value(best) : undefined;
    return typeof previous !== "number" || current > previous ? hour : best;
  }, null);
}

function tile(icon: string, label: string, value: string, time: string): string {
  return `<div class="highlight-item"><i data-lucide="${icon}" class="highlight-ico"></i><span class="environment-label">${esc(label)}</span><strong class="environment-value">${esc(value)}</strong><span class="highlight-time">${esc(time)}</span></div>`;
}

export function renderTodayHighlights(el: HTMLElement, heading: HTMLElement, forecast: Forecast): void {
  const date = forecast.current.time.slice(0, 10);
  const hours = forecast.hourly.filter((hour) => hour.time.startsWith(date));
  const locale = getLocale();
  const warmest = maxBy(hours, (hour) => hour.temperature);
  const gustiest = maxBy(hours, (hour) => hour.windGusts);
  const rainiest = maxBy(hours, (hour) => hour.precipitationProbability);
  const visibility = hours.reduce<HourlyEntry | null>((best, hour) => {
    if (typeof hour.visibility !== "number" || !Number.isFinite(hour.visibility)) return best;
    return !best || typeof best.visibility !== "number" || hour.visibility < best.visibility ? hour : best;
  }, null);
  const items: string[] = [];
  if (warmest) items.push(tile("thermometer", t("highlightWarmest"), formatTemp(warmest.temperature), formatHour(warmest.time, locale)));
  if (gustiest && typeof gustiest.windGusts === "number") items.push(tile("wind", t("highlightGust"), formatWind(gustiest.windGusts), formatHour(gustiest.time, locale)));
  if (rainiest) items.push(tile("cloud-rain", t("highlightRain"), formatPercent(rainiest.precipitationProbability), formatHour(rainiest.time, locale)));
  if (visibility && typeof visibility.visibility === "number") {
    const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(visibility.visibility / 1000);
    items.push(tile("eye", t("highlightVisibility"), `${km} km`, formatHour(visibility.time, locale)));
  }
  const show = items.length >= 2;
  heading.hidden = !show;
  el.hidden = !show;
  if (!show) el.replaceChildren();
  else el.innerHTML = items.join("");
}
