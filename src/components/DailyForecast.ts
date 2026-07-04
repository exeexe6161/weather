import type { DailyEntry } from "../lib/weather";
import { pickIcon, getWmo, isPrecipCode } from "../lib/wmo";
import { weatherLabel } from "../i18n/weather-labels";
import { formatWeekday, formatDayMonth, formatTemp, formatPercent } from "../lib/format";
import { t, getLang, getLocale } from "../i18n/ui";
import { esc } from "../dom";

// Regenwahrscheinlichkeit erst ab dieser Schwelle (Prozent) zeigen; bei
// Niederschlagscodes (isPrecipCode) immer, sonst stünde ein Regensymbol ohne
// Wert da. Darunter bleibt der Slot leer (feste Spalte, Zeile verspringt nicht)
export const RAIN_SHOW_THRESHOLD = 30;

// Ab diesem Index (Tag 8) gelten die Tage als unsicherer "Ausblick": gedämpft
// dargestellt, mit einem einmaligen Trenner davor. Bei Auswahl 7 (visible.length
// === 7) wird dieser Index nie erreicht → kein Trenner, keine Dämpfung.
const OUTLOOK_FROM = 7;

export function renderDailyForecast(el: HTMLElement, daily: DailyEntry[], days: number, currentCode?: number): void {
  const locale = getLocale();

  // Die Forecast-Daten enthalten bis zu sieben Tage. ERST kürzen, dann Skala
  // rechnen und Balken setzen,
  // damit Wochenskala und CSSOM-Index-Zuordnung auf dieselbe Liste verweisen.
  const visible = daily.slice(0, days);

  // Wochenskala EINMAL über alle (sichtbaren) Tage: kleinstes Tief, größtes Hoch. Jeder
  // Tagesbalken sitzt dort, wo seine Spanne in diesem Wochenbereich liegt.
  // Number.isFinite-Filter fängt alte Forecast-Caches ohne die Felder ab.
  const lows = visible.map((d) => d.tempMin).filter((v) => Number.isFinite(v));
  const highs = visible.map((d) => d.tempMax).filter((v) => Number.isFinite(v));
  const weekMin = Math.min(...lows);
  const weekMax = Math.max(...highs);
  const range = weekMax - weekMin; // 0 oder ungültig → Balken volle Breite, kein NaN

  // Position der Balkenfüllung (Prozent). Bei Hi==Lo wird width 0 — die
  // CSS-Mindestbreite (6px) macht daraus einen sichtbaren Punkt. Bei
  // range<=0 (alle Tage gleich) volle Breite statt Division durch null.
  const barPos = (d: DailyEntry): { left: number; width: number } => {
    if (!(range > 0) || !Number.isFinite(d.tempMin) || !Number.isFinite(d.tempMax)) {
      return { left: 0, width: 100 };
    }
    const left = Math.max(0, Math.min(100, ((d.tempMin - weekMin) / range) * 100));
    const width = Math.max(0, Math.min(100, ((d.tempMax - d.tempMin) / range) * 100));
    return { left, width };
  };

  el.innerHTML = visible
    .map((d, i) => {
      const isToday = i === 0;
      const code = isToday && typeof currentCode === "number" ? currentCode : d.weatherCode;
      const icon = pickIcon(code, true);
      const label = weatherLabel(getWmo(code).labelKey, getLang());
      const day = isToday ? t("today") : formatWeekday(d.date, locale);
      const dateLabel = isToday ? "&nbsp;" : formatDayMonth(d.date, locale);
      // typeof Check fängt alte Forecast Caches ohne das Feld ab
      const rain =
        typeof d.precipitationProbabilityMax === "number" &&
        (isPrecipCode(d.weatherCode) || d.precipitationProbabilityMax >= RAIN_SHOW_THRESHOLD)
          ? d.precipitationProbabilityMax
          : null;
      const outlook = i >= OUTLOOK_FROM;
      // Genau einmal vor dem ersten gedämpften Tag: der "Ausblick"-Trenner. Rein
      // visuell (aria-hidden) und OHNE .day-bar-fill — so bleibt die Zählung der
      // Fill-Elemente unten 1:1 zur Tagesreihenfolge (visible) erhalten.
      const divider =
        i === OUTLOOK_FROM
          ? `<div class="daily-divider" aria-hidden="true"><span>${esc(t("outlookLabel"))}</span></div>`
          : "";
      return `${divider}<div class="day-row${outlook ? " day-row--outlook" : ""}" role="listitem">
        <div class="day-name"><span class="day-dow">${day}</span><span class="day-date">${dateLabel}</span></div>
        <i data-lucide="${icon}" class="day-ico" role="img" aria-label="${esc(label)}"></i>
        <div class="day-label">${esc(label)}</div>
        <div class="day-rain">${rain !== null ? `<i data-lucide="droplets" class="day-rain-ico"></i><span>${formatPercent(rain)}</span>` : ""}</div>
        <div class="day-temps">
          <span class="day-max">${formatTemp(d.tempMax)}</span>
          <span class="day-min">${formatTemp(d.tempMin)}</span>
        </div>
        <div class="day-bar" aria-hidden="true"><div class="day-bar-fill"></div></div>
      </div>`;
    })
    .join("");

  // Balkenposition über CSSOM (style-Property-Setter, KEIN style-Attribut im
  // Markup): die strenge CSP (style-src 'self', kein unsafe-inline) blockt
  // inline style="" Attribute — einzelne style-Properties setzt CSP nicht.
  // Reihenfolge der Füllungen == visible-Reihenfolge (1 Balken je Zeile). Der
  // Ausblick-Trenner trägt KEIN .day-bar-fill, stört die Zählung also nicht.
  const fills = el.querySelectorAll<HTMLElement>(".day-bar-fill");
  visible.forEach((d, i) => {
    const fill = fills[i];
    if (!fill) return;
    const { left, width } = barPos(d);
    fill.style.left = `${left.toFixed(2)}%`;
    fill.style.width = `${width.toFixed(2)}%`;
  });
}
