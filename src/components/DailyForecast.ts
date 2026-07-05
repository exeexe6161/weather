import type { DailyEntry } from "../lib/weather";
import { pickIcon, getWmo, isPrecipCode } from "../lib/wmo";
import { weatherLabel, moonPhaseLabel } from "../i18n/weather-labels";
import { formatWeekday, formatDayMonth, formatTemp, formatPercent, formatWind, formatHour, fmtMm } from "../lib/format";
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

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Zahlenkachel im bestehenden cw-meta-Stil (gleiches Aussehen wie die aktuelle
// Wetterkarte und das Stundenpanel, Komponenten-Konsistenz).
function metaTile(icon: string, lbl: string, val: string): string {
  return `<li class="cw-meta-item"><i data-lucide="${icon}" class="cw-meta-ico"></i><span class="cw-meta-lbl">${esc(lbl)}</span><span class="cw-meta-val">${esc(val)}</span></li>`;
}
// Sonnen-/Mond-Item im bestehenden cw-sun-Stil.
function sunItem(icon: string, lbl: string, val: string, hint = ""): string {
  return `<div class="cw-sun-item"><i data-lucide="${icon}" class="cw-sun-ico"></i><span class="cw-sun-lbl">${esc(lbl)}</span><span class="cw-sun-val">${esc(val)}</span>${hint}</div>`;
}

// Delegierter Klick-Listener fürs Auf- und Zuklappen der Tagespanels, EINMAL pro
// Container gebunden (#dailyForecast ist statisch und überlebt jeden innerHTML-
// Neuaufbau). Nur ein Panel gleichzeitig offen; erneuter Tipp auf denselben Tag
// schließt. Kein natives <details> (WebKit bricht dessen Umschalten bei
// Flex-summary), stattdessen Button plus verstecktes Panel mit voller Kontrolle.
const boundDayContainers = new WeakSet<HTMLElement>();
function bindDayPanels(el: HTMLElement): void {
  if (boundDayContainers.has(el)) return;
  boundDayContainers.add(el);
  el.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>(".day-row[data-day-index]") : null;
    if (!btn || !el.contains(btn)) return;
    const panel = btn.parentElement?.querySelector<HTMLElement>(".day-panel");
    if (!panel) return;
    const willOpen = panel.hidden; // aktuell versteckt → jetzt öffnen
    // Alle anderen schließen (nur einer offen).
    el.querySelectorAll<HTMLElement>(".day-panel").forEach((p) => { if (p !== panel) p.hidden = true; });
    el.querySelectorAll<HTMLButtonElement>(".day-row[data-day-index]").forEach((b) => { if (b !== btn) b.setAttribute("aria-expanded", "false"); });
    panel.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
  });
}

// autoOpenToday: klappt beim Rendern den Tag "Heute" (Index 0) direkt auf, sofern
// er Detailwerte hat. Rückgabe: ob wirklich auto-geöffnet wurde (der Aufrufer in
// app.ts entwaffnet sein Flag nur dann, analog zum Stundenpanel).
export function renderDailyForecast(el: HTMLElement, daily: DailyEntry[], days: number, autoOpenToday = false): boolean {
  bindDayPanels(el); // einmalig; delegiert das Auf- und Zuklappen
  const locale = getLocale();
  let didAutoOpen = false;

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
      // Der aktuelle Zustand steht bereits in der grossen Karte. In der
      // Tagesliste soll auch bei "Heute" die Prognose fuer den ganzen Tag stehen.
      const code = d.weatherCode;
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

      const rowInner = `<div class="day-name"><span class="day-dow">${day}</span><span class="day-date">${dateLabel}</span></div>
        <i data-lucide="${icon}" class="day-ico" role="img" aria-label="${esc(label)}"></i>
        <div class="day-label">${esc(label)}</div>
        <div class="day-rain">${rain !== null ? `<i data-lucide="droplets" class="day-rain-ico"></i><span>${formatPercent(rain)}</span>` : ""}</div>
        <div class="day-temps">
          <span class="day-max">${formatTemp(d.tempMax)}</span>
          <span class="day-min">${formatTemp(d.tempMin)}</span>
        </div>
        <div class="day-bar" aria-hidden="true"><div class="day-bar-fill"></div></div>`;

      // Tages-Detailwerte, NUR echte Werte (kein Fake, kein 0-mm-Rauschen). Alle
      // Felder optional → alte Caches ohne die neuen Werte lassen die Kacheln aus.
      const tiles: string[] = [];
      if (isNum(d.windMax)) tiles.push(metaTile("wind", t("day_wind_max"), formatWind(d.windMax)));
      if (isNum(d.precipTotal) && d.precipTotal > 0) tiles.push(metaTile("cloud-rain", t("day_precip_total"), fmtMm(d.precipTotal, locale)));
      if (isNum(d.humidityAvg)) tiles.push(metaTile("droplets", t("humidity"), formatPercent(d.humidityAvg)));
      if (isNum(d.uvIndexMax) && Math.round(d.uvIndexMax) >= 1) tiles.push(metaTile("sun", t("uv_label"), String(Math.round(d.uvIndexMax))));

      const sunItems: string[] = [];
      const sunrise = typeof d.sunrise === "string" ? d.sunrise : null;
      const sunset = typeof d.sunset === "string" ? d.sunset : null;
      if (sunrise) sunItems.push(sunItem("sunrise", t("sun_rise"), formatHour(sunrise, locale)));
      if (sunset) sunItems.push(sunItem("sunset", t("sun_set"), formatHour(sunset, locale)));
      const moonPhaseText = typeof d.moonPhase === "string" ? moonPhaseLabel(d.moonPhase, getLang()) : null;
      if (moonPhaseText) {
        const hint = isNum(d.moonIllumination)
          ? `<span class="cw-uv-hint">${esc(t("moon_illumination").replace("{percent}", String(Math.round(d.moonIllumination))))}</span>`
          : "";
        sunItems.push(sunItem("moon", t("moon_label"), moonPhaseText, hint));
      }

      const hasDetail = tiles.length + sunItems.length > 0;
      // Ohne echte Detailwerte kein Panel und kein Button (kein leerer Kasten):
      // die Zeile bleibt eine reine Anzeige wie bisher.
      if (!hasDetail) {
        return `${divider}<div class="day-item" role="listitem"><div class="day-row${outlook ? " day-row--outlook" : ""}">${rowInner}</div></div>`;
      }
      // Auto-Open nur für Heute (Index 0) und nur wenn der Aufrufer es scharf
      // gestellt hat (neue Wetterdaten). So erkennt der Nutzer sofort, dass die
      // Tageszeilen antippbar sind. Alle anderen Tage bleiben geschlossen.
      const openToday = autoOpenToday && i === 0;
      if (openToday) didAutoOpen = true;
      const panel = `<div class="day-panel" id="dayPanel-${i}"${openToday ? "" : " hidden"}>
        ${tiles.length ? `<ul class="cw-meta day-panel-meta">${tiles.join("")}</ul>` : ""}
        ${sunItems.length ? `<div class="cw-sun day-panel-sun">${sunItems.join("")}</div>` : ""}
      </div>`;
      return `${divider}<div class="day-item" role="listitem">
        <button type="button" class="day-row${outlook ? " day-row--outlook" : ""}" data-day-index="${i}" aria-expanded="${openToday ? "true" : "false"}" aria-controls="dayPanel-${i}">${rowInner}</button>
        ${panel}
      </div>`;
    })
    .join("");

  // Balkenposition über CSSOM (style-Property-Setter, KEIN style-Attribut im
  // Markup): die strenge CSP (style-src 'self', kein unsafe-inline) blockt
  // inline style="" Attribute — einzelne style-Properties setzt CSP nicht.
  // Reihenfolge der Füllungen == visible-Reihenfolge (1 Balken je Zeile). Der
  // Ausblick-Trenner und die Tagespanels tragen KEIN .day-bar-fill, stören die
  // Zählung also nicht.
  const fills = el.querySelectorAll<HTMLElement>(".day-bar-fill");
  visible.forEach((d, i) => {
    const fill = fills[i];
    if (!fill) return;
    const { left, width } = barPos(d);
    fill.style.left = `${left.toFixed(2)}%`;
    fill.style.width = `${width.toFixed(2)}%`;
  });
  return didAutoOpen;
}
