import type { Forecast, HourlyEntry } from "../lib/weather";
import { pickIcon, getWmo } from "../lib/wmo";
import { nightSpans, isNightAt } from "../lib/daylight";
import { weatherLabel } from "../i18n/weather-labels";
import { formatHour, formatTemp, formatPercent, formatWind, fmtMm } from "../lib/format";
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

export function renderHourlyStrip(el: HTMLElement, forecast: Forecast, autoOpen = false): boolean {
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
  // didAutoOpen meldet dem Aufrufer (app.ts), ob wirklich ein Panel geöffnet
  // wurde — nur dann darf das Auto-Open-Flag entwaffnen (Befund 2: ein
  // degenerierter Render mit leerem hourly öffnet nicht und soll daher auch nicht
  // entwaffnen, sonst öffnet kein späterer Render mehr).
  let didAutoOpen = false;
  if (autoOpen && forecast.hourly.length > 0) {
    // Aktuelle Stunde = erster Eintrag mit Zeit >= jetzt (dieselbe Prädikat-Logik
    // wie normalize()); Fallback Index 0 bei keinem Treffer.
    const autoIdx = Math.max(0, forecast.hourly.findIndex((h) => h.time >= forecast.current.time));
    const autoHour = forecast.hourly[autoIdx];
    const autoBtn = el.querySelector<HTMLButtonElement>(`.hour-cell[data-hour-index="${autoIdx}"]`);
    if (autoBtn) {
      const icon = pickIcon(autoHour.weatherCode, hourIsDay(autoHour.time, spans));
      openHourDetail(autoHour, autoIdx, autoBtn, icon, false);
      didAutoOpen = panelOpen(); // tatsächlich offen? (deckt openHourDetail-Frühausstieg ab)
    }
  }
  return didAutoOpen;
}

// Einmalige Event-Delegation auf dem (statischen) Container plus die globalen
// Schließ-Listener (Escape, Klick außerhalb) — gebunden nach dem Muster des
// Sprachmenüs (main.ts). Ein echtes <button> ist nativ fokussierbar und löst
// bei Enter/Space von selbst ein click aus → EIN click-Listener für Maus, Touch
// und Tastatur. Der Container bleibt über Re-Render bestehen, der Listener also
// gültig und nie doppelt.
function bindHourlyStrip(el: HTMLElement): void {
  // Strip merken: der (nur bei offenem Panel scharfe) Outside-Klick-Listener
  // braucht ihn, um Klicks innerhalb der Leiste auszunehmen.
  boundStripEl = el;
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
  // Klick außerhalb schließt — aber NICHT der Klick, der gerade geöffnet hat.
  // Daher KEIN dauerhafter document-Listener mehr (der wäre vom öffnenden Klick
  // mit-getroffen worden, Befund 1): armOutsideClick schaltet ihn erst im nächsten
  // Task scharf (s. openHourDetail), disarmOutsideClick meldet ihn beim Schließen
  // wieder ab. Kein Fokus-Rückwurf beim Outside-Schließen: der Klick hat den Fokus
  // bewusst woandershin gesetzt.
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
// Vom bindHourlyStrip gemerkter Strip; der Outside-Klick-Handler nimmt Klicks
// darin aus (Zellen verwalten Öffnen/Umschalten/Toggle selbst).
let boundStripEl: HTMLElement | null = null;
// Pending-Timer, der den Outside-Klick-Listener verzögert scharf schaltet.
let outsideClickTimer: number | null = null;

// Outside-Klick schließt das offene Panel. Klicks IM Panel und IN der Leiste sind
// ausgenommen (Letztere verwalten Öffnen/Umschalten/Toggle selbst).
function handleOutsideClick(e: MouseEvent): void {
  if (!panelOpen()) return;
  const target = e.target as Node | null;
  const panel = getPanel();
  if (!target || !panel) return;
  if (panel.contains(target) || (boundStripEl?.contains(target) ?? false)) return;
  closeHourDetail(false);
}

// Scharf schalten ERST im nächsten Makro-Task (setTimeout 0), nachdem der
// öffnende Klick komplett durchgelaufen ist. queueMicrotask reicht NICHT: nach
// jedem Event-Listener wird ein Microtask-Checkpoint abgearbeitet, der Listener
// wäre also noch im selben blubbernden Klick aktiv und würde sofort schließen.
function armOutsideClick(): void {
  if (outsideClickTimer !== null) return; // schon geplant
  outsideClickTimer = window.setTimeout(() => {
    outsideClickTimer = null;
    if (panelOpen()) document.addEventListener("click", handleOutsideClick);
  }, 0);
}

function disarmOutsideClick(): void {
  if (outsideClickTimer !== null) {
    clearTimeout(outsideClickTimer);
    outsideClickTimer = null;
  }
  document.removeEventListener("click", handleOutsideClick);
}

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

  // Outside-Klick-Listener erst nach dem aktuellen Event scharf schalten, damit
  // der öffnende Klick (z.B. Favoriten-Chip → Cache-Auto-Open) ihn nicht selbst
  // auslöst (Befund 1).
  armOutsideClick();

  // Fokus nur beim Nutzer-Klick ins Panel (Escape/X geben ihn zurück); beim
  // Auto-Open (focusPanel=false) NICHT, damit die Seite beim Laden nicht scrollt.
  if (focusPanel) panel.focus();
}

function closeHourDetail(returnFocus = false): void {
  disarmOutsideClick(); // Outside-Klick-Listener immer mit abmelden
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
// Schlanke, konsistente Formatierung für die neuen Einheiten (hPa, Richtung).
// mm läuft über das geteilte fmtMm aus ../lib/format (auch vom Regen-Diagramm
// genutzt); bestehende Werte über formatTemp/formatPercent/formatWind.
function fmtHpa(v: number): string {
  return `${Math.round(v)} hPa`;
}
// Schneefall in cm, eine Nachkommastelle, locale-aware — analog zu fmtMm (mm).
// Lokal, da nur das Panel ihn nutzt (kein geteiltes Diagramm wie bei mm).
function fmtCm(v: number, locale: string): string {
  return `${v.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm`;
}
// Sichtweite: Open-Meteo liefert METER. Unter 1 km in ganzen Metern ("800 m"),
// ab 1 km in km mit einer Nachkommastelle ("3,2 km"), locale-aware.
function fmtVisibility(meter: number, locale: string): string {
  if (meter < 1000) return `${Math.round(meter)} m`;
  return `${(meter / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}
function fmtDir(deg: number): string {
  const pts = t("compassPoints").split(",");
  const dir = pts[Math.round(deg / 45) % 8] ?? "";
  return dir ? `${dir} ${Math.round(deg)}°` : `${Math.round(deg)}°`;
}

// Sichtweite nur bei auffällig niedriger Sicht zeigen: ab klarer Sicht trägt
// "10 km" nichts bei. 5000 m (5 km) ist die meteorologische Dunst-Grenze (haze);
// Nebel liegt darunter (< 1 km). So erscheint die Zeile bei Dunst/Nebel und
// bleibt an klaren Tagen weg.
const SICHT_GRENZE = 5000; // Meter

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
  // Schnee nahe dem Niederschlag: nur wenn in dieser Stunde wirklich Schnee fällt
  // (Sommer/snowfall 0 → Zeile entfällt, genau so gewollt).
  if (isNum(hour.snowfall) && hour.snowfall > 0) rows.push(metaRow(t("snow"), fmtCm(hour.snowfall, locale)));
  if (isNum(hour.windSpeed)) rows.push(metaRow(t("wind"), formatWind(hour.windSpeed)));
  if (isNum(hour.windDirection)) rows.push(metaRow(t("windDirection"), fmtDir(hour.windDirection)));
  if (isNum(hour.windGusts)) rows.push(metaRow(t("windGusts"), formatWind(hour.windGusts)));
  if (isNum(hour.relativeHumidity)) rows.push(metaRow(t("humidity"), formatPercent(hour.relativeHumidity)));
  if (isNum(hour.dewPoint)) rows.push(metaRow(t("dewPoint"), formatTemp(hour.dewPoint)));
  if (isNum(hour.cloudCover)) rows.push(metaRow(t("cloudCover"), formatPercent(hour.cloudCover)));
  // Sichtweite bei den atmosphärischen Werten, aber NUR bei niedriger Sicht
  // (Dunst/Nebel < SICHT_GRENZE); klare Sicht trägt nichts bei → Zeile entfällt.
  if (isNum(hour.visibility) && hour.visibility < SICHT_GRENZE) rows.push(metaRow(t("visibility"), fmtVisibility(hour.visibility, locale)));
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
