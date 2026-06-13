// TempCurve.ts — Temperaturverlauf als ruhige Linie.
//
// Architekturprinzip: ALLES in EINEM SVG (Linie, Flaeche, Punkte, Werte, Zeitachse).
// Ein Koordinatensystem, kein HTML-Overlay, keine Prozent-Positionen, kein separates
// CSS-Layout fuer die Beschriftung. Was die Geometrie berechnet, rendert der Browser
// pixelgenau identisch — das schliesst Label-Ueberlappungen konstruktiv aus.
//
// Design:
//  - Linie mit weichem Farbverlauf: nachts gedaempft, tags Zenit-Anklang, sanft
//    geblendet ueber die echte Daemmerungsgrenze (aus daylight.ts).
//  - sanfte Flaechenfuellung unter der Linie.
//  - durchgehend echte Uhrzeiten als Achse; linke Marke = aktuelle Stunde.
//    Wo ein Hoch/Tief-Wert sitzt, weicht die Zeitmarke (Wert hat Vorrang).
//  - jetzt-Punkt am Linienanfang, Hoch/Tief als feine Ringe.

import { esc } from "../dom";

export interface TempCurveInput {
  feels: number[];          // gefuehlte Temperatur je Stunde ab jetzt (apparentTemperature)
  hourTimes: string[];      // "YYYY-MM-DDTHH:mm" in STATIONSZEIT, gleiche Laenge wie feels
  // Nacht je Stunde (true = Nacht), aus daylight.ts. Gleiche Laenge wie feels.
  // Leeres Array oder andere Laenge -> kein Farbverlauf, Linie einfarbig Tag.
  nightFlags: boolean[];
  ariaLabel: string;        // i18n t("tc_aria")
}

const MIN_POINTS = 12;
const TICK_STEP_HOURS = 3;     // Achse alle 3 Stunden (plus aktuelle Stunde links)
const TICK_VALUE_GUARD = 30;   // viewBox-Einheiten Mindestabstand Tick<->Wert

export function renderTempCurve(container: HTMLElement, input: TempCurveInput): void {
  const temps = input.feels.filter((v) => Number.isFinite(v));
  if (temps.length < MIN_POINTS) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;

  const W = 340, H = 118;
  const padL = 14, padR = 14, padT = 22, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = temps.length;

  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 2);
  const center = (min + max) / 2;
  const lo = center - span / 2;
  const hi = center + span / 2;

  const xAt = (i: number) => padL + (n <= 1 ? 0 : (plotW * i) / (n - 1));
  const yAt = (t: number) => padT + plotH * (1 - (t - lo) / (hi - lo));
  const pts = temps.map((t, i) => ({ i, t, x: xAt(i), y: yAt(t) }));

  let hiI = 0, loI = 0;
  temps.forEach((t, i) => { if (t > temps[hiI]) hiI = i; if (t < temps[loI]) loI = i; });

  // --- Pfade: Linie + Flaeche ---
  const lineD = buildSmoothPath(pts);
  const areaD = `${lineD} L ${pts[n - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  // --- Farbverlauf-Stops aus den Nacht-Flags (weiche Blendung an Grenzen) ---
  const lineStops = buildGradientStops(input.nightFlags, n);

  // --- Zeitachse: aktuelle Stunde links + alle TICK_STEP_HOURS; Wert hat Vorrang ---
  const ticks = buildTicks(input.hourTimes, pts, [pts[hiI].x, pts[loI].x], padL);

  // --- SVG zusammensetzen ---
  const grid = ticks
    .filter((t) => t.anchor !== 'start')
    .map((t) => `<line x1="${t.x.toFixed(1)}" y1="${padT}" x2="${t.x.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" class="tc-grid"/>`)
    .join('');

  const nowDot = `<circle cx="${pts[0].x.toFixed(1)}" cy="${pts[0].y.toFixed(1)}" r="2.6" class="tc-now"/>`;

  const hiNight = nightAt(input.nightFlags, hiI);
  const loNight = nightAt(input.nightFlags, loI);
  const ring = (p: { x: number; y: number }, night: boolean) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" class="tc-ring ${night ? 'tc-ring-night' : 'tc-ring-day'}"/>`;
  const rings = ring(pts[hiI], hiNight) + (loI !== hiI ? ring(pts[loI], loNight) : '');

  // Werte: Hoch ueber Punkt, Tief unter Punkt, in obere Etage geklemmt (nie in die Achse)
  const baselineMax = H - padB - 3;
  const baselineMin = 10;
  const placeVal = (idx: number, prefer: 'above' | 'below') => {
    const p = pts[idx];
    let by = prefer === 'above' ? p.y - 7 : p.y + 14;
    if (by < baselineMin) by = baselineMin;
    if (by > baselineMax) { const up = p.y - 7; by = up >= baselineMin ? up : baselineMax; }
    return by;
  };
  const valHi = `<text x="${pts[hiI].x.toFixed(1)}" y="${placeVal(hiI, 'above').toFixed(1)}" class="tc-val" text-anchor="middle">${Math.round(temps[hiI])}\u00B0</text>`;
  const valLo = loI !== hiI
    ? `<text x="${pts[loI].x.toFixed(1)}" y="${placeVal(loI, 'below').toFixed(1)}" class="tc-val" text-anchor="middle">${Math.round(temps[loI])}\u00B0</text>`
    : '';

  const axis = ticks
    .map((t) => `<text x="${t.x.toFixed(1)}" y="${(H - 7).toFixed(1)}" class="tc-axis" text-anchor="${t.anchor}">${esc(t.label)}</text>`)
    .join('');

  const defs =
    `<defs>` +
    `<linearGradient id="tcLine" x1="${pts[0].x}" y1="0" x2="${pts[n - 1].x}" y2="0" gradientUnits="userSpaceOnUse">${lineStops}</linearGradient>` +
    `<linearGradient id="tcArea" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" class="tc-area-top"/><stop offset="1" class="tc-area-bottom"/></linearGradient>` +
    `</defs>`;

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" class="tc-svg" role="img" aria-label="${esc(input.ariaLabel)}" preserveAspectRatio="none">` +
    defs + grid +
    `<path d="${areaD}" class="tc-area" fill="url(#tcArea)"/>` +
    `<path d="${lineD}" class="tc-line" fill="none" stroke="url(#tcLine)" vector-effect="non-scaling-stroke"/>` +
    nowDot + rings + valHi + valLo + axis +
    `</svg>`;

  container.replaceChildren();
  container.insertAdjacentHTML('afterbegin', svg);
}

interface Tick { x: number; label: string; anchor: 'start' | 'middle' | 'end'; }

function buildTicks(
  hourTimes: string[],
  pts: { x: number }[],
  valueXs: number[],
  padL: number,
): Tick[] {
  const n = pts.length;
  const hourOf = (iso: string): number | null => {
    const m = iso.length >= 16 ? iso.slice(11, 13) : '';
    const h = Number(m);
    return Number.isFinite(h) ? h : null;
  };
  const fmt = (iso: string): string => (iso.length >= 16 ? iso.slice(11, 16) : '');

  const all: Tick[] = [];
  const firstLabel = fmt(hourTimes[0] ?? '');
  if (firstLabel) all.push({ x: padL, label: firstLabel, anchor: 'start' });

  for (let i = 1; i < n && i < hourTimes.length; i++) {
    const h = hourOf(hourTimes[i]);
    if (h === null) continue;
    if (h % TICK_STEP_HOURS === 0 && i >= 2) {
      all.push({ x: pts[i].x, label: fmt(hourTimes[i]), anchor: 'middle' });
    }
  }

  // Wert hat Vorrang: Tick faellt weg, wenn er einem Hoch/Tief-x zu nahe ist
  return all.filter((t, idx) =>
    idx === 0 || !valueXs.some((vx) => Math.abs(vx - t.x) < TICK_VALUE_GUARD));
}

function buildGradientStops(nightFlags: boolean[], n: number): string {
  const DAY = '#3f6ea5';
  const NIGHT = '#9aa5b3';
  // Wenn keine brauchbaren Flags: einfarbig Tag.
  if (!nightFlags || nightFlags.length !== n) {
    return `<stop offset="0%" stop-color="${DAY}"/><stop offset="100%" stop-color="${DAY}"/>`;
  }
  // Stops je Stunde; an Grenzen weich blenden (halbe Stunde vor/nach uebernimmt der Verlauf).
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const off = ((i / (n - 1)) * 100).toFixed(1);
    stops.push(`<stop offset="${off}%" stop-color="${nightFlags[i] ? NIGHT : DAY}"/>`);
  }
  return stops.join('');
}

function nightAt(flags: boolean[], i: number): boolean {
  return Array.isArray(flags) && flags.length > i ? !!flags[i] : false;
}

function buildSmoothPath(P: { x: number; y: number }[]): string {
  if (P.length < 2) return '';
  let d = `M ${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[i + 2] || P[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    let c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    let c2y = p2.y - (p3.y - p1.y) / 6;
    const yHi = Math.max(p1.y, p2.y), yLo = Math.min(p1.y, p2.y);
    c1y = Math.max(Math.min(c1y, yHi), yLo);
    c2y = Math.max(Math.min(c2y, yHi), yLo);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Hilfsfunktion fuer app.ts: erzeugt die Nacht-Flags je Stunde aus euren daylight.ts-
// Funktionen. isNight(stationMinutes) und toMinutes(iso) kommen aus daylight.ts;
// bei abweichender Signatur einen schlanken Adapter bauen.
export function nightFlagsFromStationTimes(
  hourTimes: string[],
  isNight: (stationMinutes: number) => boolean,
  toMinutes: (iso: string) => number,
): boolean[] {
  return hourTimes.map((s) => {
    const m = toMinutes(s);
    return Number.isFinite(m) ? isNight(m) : false;
  });
}
