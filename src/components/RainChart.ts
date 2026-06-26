// RainChart.ts — Niederschlagsmenge der naechsten 24 Stunden als ruhiges
// Balkendiagramm. Schwester der TempCurve: gleiche Kartenbreite, gleiche
// x-Geometrie (padL/padR/hoursSpan identisch), damit beide Diagramme zeitlich
// DECKUNGSGLEICH untereinander sitzen. Regen ist stueckweise (mm je Stunde),
// daher Balken statt Linie.
//
// Designentscheidungen:
//  - ROLLENDE 24-Stunden-Ansicht ab jetzt, exakt dasselbe Fenster wie die
//    TempCurve (25 Werte, jetzt..+24h). Der jetzt-Balken sitzt ganz LINKS.
//  - Y-Achse auf das Maximum im Fenster normiert: der hoechste Balken nutzt die
//    volle Hoehe. So bleiben Niesel und Starkregen beide sichtbar.
//  - MIN_BAR: ein von 0 verschiedener, aber winziger Wert (Spur-Regen) wuerde
//    sonst <1px hoch und unsichtbar — daher mind. 2px, sobald v > 0.
//  - Balken einfarbig (CSS .rc-bar -> var(--rc-bar)), leicht abgerundete obere
//    Ecken. Farbe zentral in EINER CSS-Variable gekapselt.
//  - Maxwert oben rechts als leise Orientierung (fmtMm, locale-aware, identisch
//    zum Stundenpanel), darunter wenige Zeitmarken — sonst nichts: kein Gitter,
//    kein Rahmen, keine Legende.
//
// SICHTBARKEIT: Das Diagramm zeigt sich NUR, wenn im Fenster nennenswerter Regen
// vorkommt (peak >= VISIBLE_MIN_MM). Sonst versteckt es sich selbst
// (container.hidden = true), wie die Wochenzusammenfassung, wenn sie nichts
// Ehrliches zu sagen hat. Ein dauerhaft leeres Regen-Diagramm waere schlechter
// als keins.

import { fmtMm } from "../lib/format";

export interface RainChartInput {
  // Niederschlag (mm) fuer jetzt..+24h, dieselbe Fensterlaenge wie die TempCurve.
  // Fehlende Werte (alte Caches ohne precipitation) sind als 0 zu uebergeben.
  precip: number[];
  // Ganzzahlige aktuelle Stunde in STATIONSZEIT (0..23) fuer die Achsenmarken.
  // Ausserhalb 0..23 -> Marken zeigen nur Offsets ab "jetzt" (+Nh).
  startHour: number;
  // BCP-47 Locale fuer den mm-Wert (de-DE / en / tr), via getLocale().
  locale: string;
  // Aria-Label fuers SVG, i18n t("rain_aria").
  ariaLabel: string;
}

const MARKS = 5;                // jetzt + 4 weitere, wie die TempCurve
const VISIBLE_MIN_MM = 0.1;     // Spitze darunter -> ganze Sektion versteckt
const MIN_BAR = 2;              // px Mindesthoehe fuer v > 0 (Spur-Regen sichtbar)

export function renderRainChart(container: HTMLElement, input: RainChartInput): void {
  const raw = Array.isArray(input.precip) ? input.precip : [];
  // Defensiv: jeder nicht-endliche Wert (undefined aus altem Cache, NaN) -> 0.
  const vals = raw.map((v) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0));
  if (vals.length === 0) { hide(container); return; }

  const peak = Math.max(...vals);
  if (!(peak >= VISIBLE_MIN_MM)) { hide(container); return; } // deckt 0 und NaN-Peak

  container.hidden = false;

  // Gleiche Maße/Padding wie die TempCurve, damit die x-Positionen der Balken
  // exakt unter den Kurvenpunkten liegen (W, padL, padR, hoursSpan identisch;
  // beide SVGs strecken via preserveAspectRatio="none" auf dieselbe Kartenbreite).
  const W = 340, H = 96;
  const padL = 16, padR = 16;
  const padT = 18;             // Maxwert-Zeile oben
  const padB = 22;             // Uhrzeit-Zeile unten
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;  // Nulllinie der Balken
  const hoursSpan = vals.length - 1;

  const xAt = (i: number) => padL + (hoursSpan <= 0 ? 0 : (plotW * i) / hoursSpan);
  // Balkenbreite: knapp halber Schrittabstand, gedeckelt fuer ruhige, schlanke
  // Optik; Balken um den Stundenpunkt zentriert.
  const step = hoursSpan <= 0 ? plotW : plotW / hoursSpan;
  const barW = Math.max(2, Math.min(6, step * 0.45));
  const rx = Math.min(2, barW / 2);

  // Grundlinie: zarte durchgehende Linie bei baseY, auf der die Balken stehen —
  // gibt dem Diagramm Halt, statt die Balken frei schweben zu lassen. Farbe ueber
  // .rc-base (alpha-basierter Token, theme-aware).
  const base = `<line x1="${padL.toFixed(2)}" y1="${baseY.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${baseY.toFixed(2)}" class="rc-base" vector-effect="non-scaling-stroke"/>`;

  // Leer-Spur: an JEDER Stunde ein sehr leiser Sockel-Stummel auf der Grundlinie
  // (auch bei precip 0). Erzeugt gleichmaessiges Raster/Rhythmus, ohne laut zu
  // werden; echte Balken ueberdecken ihren Sockel.
  const SOCKET_H = 3;
  const sockets = vals.map((_v, i) => {
    const x = xAt(i) - barW / 2;
    const y = baseY - SOCKET_H;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${SOCKET_H.toFixed(2)}" rx="${rx.toFixed(2)}" class="rc-socket"/>`;
  }).join("");

  const bars = vals.map((v, i) => {
    if (v <= 0) return "";
    const h = Math.max(MIN_BAR, (plotH * v) / peak);
    const x = xAt(i) - barW / 2;
    const y = baseY - h;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="${rx.toFixed(2)}" class="rc-bar"/>`;
  }).join("");

  // Fuenf gleichmaessig verteilte Zeitmarken (x nach Index, nicht nach Uhrzeit),
  // exakt wie die TempCurve — "jetzt" plus vier Uhrzeiten bzw. +Nh ohne timezone.
  const startOk = Number.isFinite(input.startHour) && input.startHour >= 0 && input.startHour <= 23;
  const axis: string[] = [];
  for (let k = 0; k < MARKS; k++) {
    const idx = Math.round((k / (MARKS - 1)) * hoursSpan);
    const label = k === 0
      ? "jetzt"
      : startOk
        ? `${String((input.startHour + idx) % 24).padStart(2, "0")}:00`
        : `+${idx}h`;
    const anchor = idx === 0 ? "start" : idx === hoursSpan ? "end" : "middle";
    axis.push(`<text x="${xAt(idx).toFixed(2)}" y="${(H - 7).toFixed(2)}" class="rc-axis" text-anchor="${anchor}">${esc(label)}</text>`);
  }

  // Maxwert oben rechts als leise Orientierung, identisch zum Stundenpanel
  // formatiert (fmtMm, locale-aware, eine Nachkommastelle).
  const peakLabel = `<text x="${(W - padR).toFixed(2)}" y="11" class="rc-peak" text-anchor="end">${esc(fmtMm(peak, input.locale))}</text>`;

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" class="rc-svg" role="img" aria-label="${esc(input.ariaLabel)}" preserveAspectRatio="none">` +
    base + sockets + bars + peakLabel + axis.join("") +
    `</svg>`;

  container.replaceChildren();
  container.insertAdjacentHTML("afterbegin", svg);
}

function hide(container: HTMLElement): void {
  container.hidden = true;
  container.replaceChildren();
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
