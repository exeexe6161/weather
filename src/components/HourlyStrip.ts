import type { Forecast, HourlyEntry } from "../lib/weather";
import { pickIcon, getWmo } from "../lib/wmo";
import { nightSpans, isNightAt } from "../lib/daylight";
import { weatherLabel } from "../i18n/weather-labels";
import { formatHour, formatTemp, formatPercent, formatWind } from "../lib/format";
import { getLang, getLocale, t } from "../i18n/ui";
import { esc } from "../dom";
import { renderIcons } from "../icons";

// Fallback-Heuristik für alte Forecast-Caches ohne sunrise/sunset:
// 06:00 bis 19:59 lokaler Stationszeit gelten als Tag. Mit Sonnenzeiten
// kippen die Symbole exakt am echten Sonnenauf-/untergang — dieselbe
// Quelle wie die Nacht-Tönung des Temperaturverlaufs darunter.
function hourIsDayHeuristic(iso: string): boolean {
  const hour = Number(iso.slice(11, 13));
  return hour >= 6 && hour < 20;
}

type Spans = ReturnType<typeof nightSpans>;
// Tag/Nacht einer Stunde aus den echten Sonnenzeiten, sonst Heuristik. Genutzt
// für das Stundensymbol UND das Symbol im Detail-Panel (gleiche Quelle).
function hourIsDay(iso: string, spans: Spans): boolean {
  return spans !== null ? !isNightAt(iso, spans) : hourIsDayHeuristic(iso);
}

// Aktuell angezeigter Forecast je Strip-Container. Der Klick-Listener wird nur
// EINMAL pro Container gebunden (#hourlyStrip ist statisch und überlebt jeden
// Re-Render); renderHourlyStrip aktualisiert hier vor jedem innerHTML den
// Forecast, sodass ein Klick nach Stadtwechsel/Refresh immer die GERADE
// angezeigte Stunde auflöst. WeakMap: kein Leak, kein Doppel-Listener.
const stripForecasts = new WeakMap<HTMLElement, Forecast>();

export function renderHourlyStrip(el: HTMLElement, forecast: Forecast, autoOpen = false): void {
  // Die Zellen werden gleich neu erzeugt → ein offenes Panel gehört zur alten
  // Stadt/zum alten Stand und wird geschlossen (Stadtwechsel, Refresh, Sprach-
  // und Tageswechsel laufen alle über renderContent → hier durch).
  closeHourDetail();
  const firstRender = !stripForecasts.has(el);
  stripForecasts.set(el, forecast);
  const locale = getLocale();
  const spans = nightSpans(forecast.daily);
  const cells = forecast.hourly
    .map((h, i) => {
      const isDay = hourIsDay(h.time, spans);
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
      // aria-controls/aria-expanded beschreiben das gesteuerte Detail-Panel.
      return `<div class="hour-cell-li" role="listitem">
        <button type="button" class="hour-cell" data-hour-index="${i}" aria-controls="hourPanel" aria-expanded="false" aria-label="${esc(aria)}">
          <div class="hour-time">${time}</div>
          <i data-lucide="${icon}" class="hour-ico"></i><span class="sr-only">${esc(label)}</span>
          <div class="hour-temp">${temp}</div>
        </button>
      </div>`;
    })
    .join("");
  el.innerHTML = `<div class="hourly-track" role="list">${cells}</div>`;
  if (firstRender) bindHourlyStrip(el);
  // Auto-Open nur, wenn der Aufrufer es erlaubt (initiales Laden, app.ts hält das
  // über den Cache→Netz-Doppelrender hinweg "armed"). Stadtwechsel/Refresh laufen
  // mit autoOpen=false → kein Auto-Open. Kein Fokus/Scroll (openHourDetail false).
  if (autoOpen && forecast.hourly.length > 0) {
    // Aktuelle Stunde = erster Eintrag mit Zeit >= jetzt (dieselbe Prädikat-Logik
    // wie normalize()); Fallback Index 0 bei keinem Treffer.
    const autoIdx = Math.max(0, forecast.hourly.findIndex((h) => h.time >= forecast.current.time));
    const autoHour = forecast.hourly[autoIdx];
    const autoBtn = el.querySelector<HTMLButtonElement>(`.hour-cell[data-hour-index="${autoIdx}"]`);
    if (autoBtn) {
      const icon = pickIcon(autoHour.weatherCode, hourIsDay(autoHour.time, spans));
      openHourDetail(autoHour, autoIdx, autoBtn, icon, false);
    }
  }
}

// Einmalige Event-Delegation auf dem (statischen) Container plus die globalen
// Schließ-Listener (Escape, Klick außerhalb) — gebunden nach dem Muster des
// Sprachmenüs (main.ts). Ein echtes <button> ist nativ fokussierbar und löst
// bei Enter/Space von selbst ein click aus → EIN click-Listener für Maus, Touch
// und Tastatur. Der Container bleibt über Re-Render bestehen, der Listener also
// gültig und nie doppelt.
function bindHourlyStrip(el: HTMLElement): void {
  el.addEventListener("click", (e) => {
    const node = e.target instanceof Element ? e.target.closest<HTMLElement>(".hour-cell[data-hour-index]") : null;
    if (!node || !el.contains(node)) return;
    const forecast = stripForecasts.get(el);
    if (!forecast) return;
    const index = Number(node.dataset.hourIndex);
    // Defensiv: kein/ungültiger/außerhalb liegender Index → nichts tun (kein Crash).
    if (!Number.isInteger(index) || index < 0 || index >= forecast.hourly.length) return;
    // Dieselbe Stunde erneut → Toggle (schließen, Fokus zurück); andere Stunde →
    // Panel bleibt offen, Inhalt wechselt.
    if (panelOpen() && activeIndex === index) {
      closeHourDetail(true);
      return;
    }
    const hour = forecast.hourly[index];
    const spans = nightSpans(forecast.daily);
    const icon = pickIcon(hour.weatherCode, hourIsDay(hour.time, spans));
    openHourDetail(hour, index, node as HTMLButtonElement, icon);
  });

  // Escape schließt und gibt den Fokus zur Zelle zurück (das Sprachmenü macht den
  // Rückwurf nicht; hier sinnvoll, da es ein Detail-Panel ist).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen()) closeHourDetail(true);
  });
  // Klick außerhalb schließt. Klicks IN der Leiste (Zellen verwalten Öffnen/
  // Umschalten/Toggle selbst) und IM Panel sind ausgenommen. Kein Fokus-Rückwurf
  // hier: der Klick hat den Fokus bewusst woandershin gesetzt.
  document.addEventListener("click", (e) => {
    if (!panelOpen()) return;
    const target = e.target as Node | null;
    const panel = getPanel();
    if (!target || !panel) return;
    if (panel.contains(target) || el.contains(target)) return;
    closeHourDetail(false);
  });
}

// ── Panel-Steuerung ───────────────────────────────────────────────────────

let cachedPanel: HTMLElement | null = null;
function getPanel(): HTMLElement | null {
  if (!cachedPanel) cachedPanel = document.getElementById("hourPanel");
  return cachedPanel;
}
function panelOpen(): boolean {
  const p = getPanel();
  return p !== null && !p.hidden;
}

let activeIndex: number | null = null;
let activeButton: HTMLButtonElement | null = null;

// Etappe 3: füllt und öffnet das Detail-Panel mit den Daten der angetippten
// Stunde, markiert die aktive Zelle und legt den Fokus ins Panel.
function openHourDetail(hour: HourlyEntry, index: number, button: HTMLButtonElement, icon: string, focusPanel = true): void {
  const panel = getPanel();
  if (!panel) return;
  const locale = getLocale();
  const time = formatHour(hour.time, locale);
  const label = weatherLabel(getWmo(hour.weatherCode).labelKey, getLang());

  // Vorherige Aktiv-Zelle zurücksetzen (beim Umschalten), neue markieren.
  if (activeButton && activeButton !== button) {
    activeButton.classList.remove("hour-cell--active");
    activeButton.setAttribute("aria-expanded", "false");
  }
  button.classList.add("hour-cell--active");
  button.setAttribute("aria-expanded", "true");
  activeButton = button;
  activeIndex = index;

  panel.setAttribute("aria-label", `${t("hourPanelTitle")} ${time}`);
  panel.innerHTML = buildPanelHtml(hour, icon, time, label, locale);
  panel.hidden = false;
  renderIcons(); // Wetter-Icon + X im Panel hydrieren

  panel
    .querySelector<HTMLButtonElement>(".hour-panel-close")
    ?.addEventListener("click", () => closeHourDetail(true));

  // Fokus nur beim Nutzer-Klick ins Panel (Escape/X geben ihn zurück); beim
  // Auto-Open (focusPanel=false) NICHT, damit die Seite beim Laden nicht scrollt.
  if (focusPanel) panel.focus();
}

function closeHourDetail(returnFocus = false): void {
  const panel = getPanel();
  if (panel && !panel.hidden) {
    panel.hidden = true;
    panel.innerHTML = "";
    panel.removeAttribute("aria-label");
  }
  const btn = activeButton;
  activeButton = null;
  activeIndex = null;
  if (btn) {
    btn.classList.remove("hour-cell--active");
    btn.setAttribute("aria-expanded", "false");
    if (returnFocus && btn.isConnected) btn.focus();
  }
}

// ── Panel-Inhalt ────────────────────────────────────────────────────────────

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
// Label/Wert-Kachel im bestehenden cw-meta-Stil (Tabellenziffern, --s2-Fläche).
function metaRow(lbl: string, val: string): string {
  return `<li class="cw-meta-item"><span class="cw-meta-lbl">${esc(lbl)}</span><span class="cw-meta-val">${esc(val)}</span></li>`;
}
// Schlanke, konsistente Formatierung für die neuen Einheiten (mm, hPa, Richtung).
// Bestehende Werte laufen über formatTemp/formatPercent/formatWind.
function fmtMm(v: number, locale: string): string {
  return `${v.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;
}
function fmtHpa(v: number): string {
  return `${Math.round(v)} hPa`;
}
function fmtDir(deg: number): string {
  const pts = t("compassPoints").split(",");
  const dir = pts[Math.round(deg / 45) % 8] ?? "";
  return dir ? `${dir} ${Math.round(deg)}°` : `${Math.round(deg)}°`;
}

function buildPanelHtml(hour: HourlyEntry, icon: string, time: string, label: string, locale: string): string {
  const rows: string[] = [];
  // Basis: Temperatur, Gefühlt und Niederschlagswahrscheinlichkeit liegen immer
  // vor (Pflichtfelder bzw. Default 0).
  rows.push(metaRow(t("temperature"), formatTemp(hour.temperature)));
  rows.push(metaRow(t("feelsLike"), formatTemp(hour.apparentTemperature)));
  rows.push(metaRow(t("precipProbability"), formatPercent(hour.precipitationProbability)));
  // Optionale Felder: Zeile NUR bei echtem Zahlenwert, sonst weglassen (kein NaN,
  // kein "undefined"; alte Caches ohne diese Felder zeigen nur die Basis).
  if (isNum(hour.precipitation) && hour.precipitation > 0) rows.push(metaRow(t("precipAmount"), fmtMm(hour.precipitation, locale)));
  if (isNum(hour.windSpeed)) rows.push(metaRow(t("wind"), formatWind(hour.windSpeed)));
  if (isNum(hour.windDirection)) rows.push(metaRow(t("windDirection"), fmtDir(hour.windDirection)));
  if (isNum(hour.windGusts)) rows.push(metaRow(t("windGusts"), formatWind(hour.windGusts)));
  if (isNum(hour.relativeHumidity)) rows.push(metaRow(t("humidity"), formatPercent(hour.relativeHumidity)));
  if (isNum(hour.dewPoint)) rows.push(metaRow(t("dewPoint"), formatTemp(hour.dewPoint)));
  if (isNum(hour.cloudCover)) rows.push(metaRow(t("cloudCover"), formatPercent(hour.cloudCover)));
  if (isNum(hour.pressure)) rows.push(metaRow(t("pressure"), fmtHpa(hour.pressure)));
  // UV nur ab gerundet 1 zeigen: nachts/0 ist uninformativ.
  if (isNum(hour.uvIndex) && Math.round(hour.uvIndex) >= 1) rows.push(metaRow(t("uv_label"), String(Math.round(hour.uvIndex))));

  return `<div class="hour-panel-head">
    <i data-lucide="${icon}" class="hour-panel-ico"></i>
    <div class="hour-panel-htext">
      <div class="hour-panel-time">${esc(time)}</div>
      <div class="hour-panel-cond">${esc(label)}</div>
    </div>
    <button type="button" class="hour-panel-close" aria-label="${esc(t("close"))}">
      <i data-lucide="x" class="hour-panel-close-ico"></i>
    </button>
  </div>
  <ul class="cw-meta hour-panel-meta">${rows.join("")}</ul>`;
}
