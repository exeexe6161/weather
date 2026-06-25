import type { Forecast, HourlyEntry } from "../lib/weather";
import { pickIcon, getWmo } from "../lib/wmo";
import { nightSpans, isNightAt } from "../lib/daylight";
import { weatherLabel } from "../i18n/weather-labels";
import { formatHour, formatTemp } from "../lib/format";
import { getLang, getLocale, t } from "../i18n/ui";
import { esc } from "../dom";

// Fallback-Heuristik für alte Forecast-Caches ohne sunrise/sunset:
// 06:00 bis 19:59 lokaler Stationszeit gelten als Tag. Mit Sonnenzeiten
// kippen die Symbole exakt am echten Sonnenauf-/untergang — dieselbe
// Quelle wie die Nacht-Tönung des Temperaturverlaufs darunter.
function hourIsDayHeuristic(iso: string): boolean {
  const hour = Number(iso.slice(11, 13));
  return hour >= 6 && hour < 20;
}

// Aktuell angezeigter Forecast je Strip-Container. Der Klick-Listener wird nur
// EINMAL pro Container gebunden (#hourlyStrip ist statisch und überlebt jeden
// Re-Render); renderHourlyStrip aktualisiert hier vor jedem innerHTML den
// Forecast, sodass ein Klick nach Stadtwechsel/Refresh immer die GERADE
// angezeigte Stunde auflöst. WeakMap: kein Leak, kein Doppel-Listener.
const stripForecasts = new WeakMap<HTMLElement, Forecast>();

export function renderHourlyStrip(el: HTMLElement, forecast: Forecast): void {
  const firstRender = !stripForecasts.has(el);
  stripForecasts.set(el, forecast);
  const locale = getLocale();
  const spans = nightSpans(forecast.daily);
  const cells = forecast.hourly
    .map((h, i) => {
      const isDay = spans !== null ? !isNightAt(h.time, spans) : hourIsDayHeuristic(h.time);
      const icon = pickIcon(h.weatherCode, isDay);
      const label = weatherLabel(getWmo(h.weatherCode).labelKey, getLang());
      const time = formatHour(h.time, locale);
      const temp = formatTemp(h.temperature);
      // aria-label trägt Uhrzeit, Zustand und Temperatur: benennt die Schalt-
      // fläche eindeutig ("Details für …") UND erhält die Info, die sonst nur
      // das sr-only-Label des (dekorativen) Icons liefert.
      const aria = t("hourDetailAria")
        .replace("{time}", time)
        .replace("{condition}", label)
        .replace("{temp}", temp);
      // data-hour-index = Index in forecast.hourly: der Delegations-Listener
      // löst die Stunde direkt als forecast.hourly[index] auf (kein Off-by-one).
      // Echtes <button> in einer role="listitem"-Hülle: Listensemantik bleibt
      // (list > listitem > button), die Zelle ist nativ fokussier- und per
      // Enter/Space auslösbar, der globale :focus-visible-Ring greift.
      return `<div class="hour-cell-li" role="listitem">
        <button type="button" class="hour-cell" data-hour-index="${i}" aria-label="${esc(aria)}">
          <div class="hour-time">${time}</div>
          <i data-lucide="${icon}" class="hour-ico"></i><span class="sr-only">${esc(label)}</span>
          <div class="hour-temp">${temp}</div>
        </button>
      </div>`;
    })
    .join("");
  el.innerHTML = `<div class="hourly-track" role="list">${cells}</div>`;
  if (firstRender) bindHourlyStrip(el);
}

// Einmalige Event-Delegation auf dem (statischen) Container. Ein echtes <button>
// ist nativ fokussierbar und löst bei Enter/Space von selbst ein click aus —
// daher genügt EIN click-Listener für Maus, Touch und Tastatur. Der Container
// bleibt über Re-Render bestehen, der Listener also gültig und nie doppelt.
function bindHourlyStrip(el: HTMLElement): void {
  el.addEventListener("click", (e) => {
    const node = e.target instanceof Element ? e.target.closest<HTMLElement>(".hour-cell[data-hour-index]") : null;
    if (!node || !el.contains(node)) return;
    const forecast = stripForecasts.get(el);
    if (!forecast) return;
    const index = Number(node.dataset.hourIndex);
    // Defensiv: kein/ungültiger/außerhalb liegender Index → nichts tun (kein Crash).
    if (!Number.isInteger(index) || index < 0 || index >= forecast.hourly.length) return;
    openHourDetail(forecast.hourly[index], index);
  });
}

// Platzhalter für Etappe 3 (Stundendetail-Panel). Diese Etappe verdrahtet nur
// die Auswahl: der aufgelöste Eintrag wird geloggt, damit die Bindung prüfbar
// ist, BEVOR das Panel daraufgesetzt wird. Hier kommt in Etappe 3 das Öffnen rein.
function openHourDetail(hour: HourlyEntry, index: number): void {
  console.log("[HourDetail] Stunde", index, hour);
}
