// TempCurve.ts — Temperaturverlauf als ruhige Linie.
//
// Architekturprinzip: ALLES in EINEM SVG (Linie, Werte, Punkte, Zeitanker, Nacht-Toenung)
// in EINEM Koordinatensystem. Kein HTML-Overlay, keine Prozent-Positionen, kein separates
// CSS-Layout fuer die Beschriftung. Was die Geometrie berechnet, rendert der Browser
// pixelgenau identisch — das schliesst die frueheren Label-Ueberlappungen konstruktiv aus.
//
// Nacht-Toenung kommt von AUSSEN (nightSpans aus daylight.ts), damit Toenung und die
// Mondsymbole der Stundenleiste garantiert dieselbe Quelle nutzen.

import { esc } from "../dom";

export interface TempCurveInput {
  feels: number[];        // gefuehlte Temperatur je Stunde ab "jetzt" (apparentTemperature)
  hourTimes: string[];    // "YYYY-MM-DDTHH:mm" in STATIONSZEIT, gleiche Laenge wie feels
  // Nacht-Spannen als [startFraction, endFraction] ueber die Stundenachse (0..1),
  // vom Aufrufer aus daylight.ts erzeugt. Leer = keine Toenung.
  nightFractions: [number, number][];
  midLabel: string;       // z.B. "11:00" (Ortszeit, vom Aufrufer via formatHour)
  endLabel: string;       // z.B. "22:00"
  nowLabel: string;       // i18n t("tc_now")
  ariaLabel: string;      // i18n t("tc_aria")
}

const MIN_POINTS = 12;

export function renderTempCurve(container: HTMLElement, input: TempCurveInput): void {
  const temps = input.feels.filter((v) => Number.isFinite(v));
  if (temps.length < MIN_POINTS) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;

  // --- Geometrie (viewBox-Einheiten; SVG skaliert per CSS auf Kartenbreite) ---
  const W = 340, H = 132;
  const padL = 16, padR = 16, padT = 24, padB = 30; // padB: reservierte Etage fuer Anker
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = temps.length;

  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 2);           // 2-Grad-Mindestspanne haelt flachen Tag ruhig
  const center = (min + max) / 2;
  const lo = center - span / 2;
  const hi = center + span / 2;

  const xAt = (i: number) => padL + (n <= 1 ? 0 : (plotW * i) / (n - 1));
  const yAt = (t: number) => padT + plotH * (1 - (t - lo) / (hi - lo));
  const pts = temps.map((t, i) => ({ i, t, x: xAt(i), y: yAt(t) }));

  let hiI = 0, loI = 0;
  temps.forEach((t, i) => { if (t > temps[hiI]) hiI = i; if (t < temps[loI]) loI = i; });

  const pathD = buildSmoothPath(pts);

  // --- Nacht-Toenung: Fractions kommen von aussen (daylight.ts), hier nur zeichnen ---
  const nightRects = input.nightFractions
    .filter(([a, b]) => b > a)
    .map(([a, b]) => {
      const x0 = padL + plotW * clamp01(a);
      const x1 = padL + plotW * clamp01(b);
      return `<rect x="${x0.toFixed(1)}" y="${(padT - 2).toFixed(1)}" width="${Math.max(0, x1 - x0).toFixed(1)}" height="${(plotH + 4).toFixed(1)}" rx="2" class="tc-night"/>`;
    })
    .join('');

  // --- Werte-Labels: obere Etage, nie in die Ankerzeile (konstruktiv) ---
  const baselineMax = H - padB - 5;   // Unterkante der Werte bleibt ueber der Ankerzeile
  const baselineMin = 11;
  const place = (idx: number, prefer: 'above' | 'below') => {
    const p = pts[idx];
    let by = prefer === 'above' ? p.y - 8 : p.y + 15;
    if (by < baselineMin) by = baselineMin;
    if (by > baselineMax) {
      const up = p.y - 8;             // Flip nach oben, falls unten kein Platz
      by = up >= baselineMin ? up : baselineMax;
    }
    return { idx, x: p.x, by, t: temps[idx] };
  };
  const labels = [place(hiI, 'above')];
  if (loI !== hiI) labels.push(place(loI, 'below'));

  // Label-gegen-Label entzerren, falls Hoch und Tief x-nah liegen
  if (labels.length === 2) {
    const [a, b] = labels;
    if (Math.abs(a.x - b.x) < 34 && Math.abs(a.by - b.by) < 14) {
      if (a.by <= b.by) { a.by -= 7; b.by += 7; } else { a.by += 7; b.by -= 7; }
      for (const L of labels) L.by = Math.max(baselineMin, Math.min(baselineMax, L.by));
    }
  }

  // --- Zeitanker: eigene Zeile im selben SVG ---
  const ankY = H - 6;
  const anchors = [
    { x: padL, t: input.nowLabel, anchor: 'start' },
    { x: padL + plotW / 2, t: input.midLabel, anchor: 'middle' },
    { x: padL + plotW, t: input.endLabel, anchor: 'end' },
  ];

  const dots = labels
    .map((L) => `<circle cx="${pts[L.idx].x.toFixed(1)}" cy="${pts[L.idx].y.toFixed(1)}" r="2.5" class="tc-dot"/>`)
    .join('');
  const vals = labels
    // Anzeige gerundet wie \u00FCberall in der Karte (Wiring-Anpassung; die
    // Kurve selbst rechnet weiter mit den ungerundeten Werten)
    .map((L) => `<text x="${L.x.toFixed(1)}" y="${L.by.toFixed(1)}" class="tc-val" text-anchor="middle">${Math.round(L.t)}\u00B0</text>`)
    .join('');
  const anks = anchors
    .map((A) => `<text x="${A.x.toFixed(1)}" y="${ankY}" class="tc-anchor" text-anchor="${A.anchor}">${esc(A.t)}</text>`)
    .join('');

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" class="tc-svg" role="img" aria-label="${esc(input.ariaLabel)}" preserveAspectRatio="none">` +
    nightRects +
    `<path d="${pathD}" class="tc-line" fill="none" vector-effect="non-scaling-stroke"/>` +
    dots + vals + anks +
    `</svg>`;

  container.replaceChildren();
  container.insertAdjacentHTML('afterbegin', svg);
}

// Hilfsfunktion fuer den Aufrufer (app.ts): erzeugt aus Stationszeit-Strings und den
// Nacht-Spannen aus daylight.ts die [startFrac,endFrac]-Paare ueber die sichtbare Achse.
// Erwartet nightSpansMinutes als Liste absoluter Nacht-Intervalle in "Minuten seit Epoche
// in Stationszeit" ODER kompatibel zu eurem daylight.ts; siehe Verdrahtungshinweis.
export function nightFractionsFromStationTimes(
  hourTimes: string[],
  isNightAt: (stationMinutes: number) => boolean,
  toMinutes: (iso: string) => number,
): [number, number][] {
  if (hourTimes.length < 2) return [];
  const flags = hourTimes.map((s) => isNightAt(toMinutes(s)));
  const segs: [number, number][] = [];
  const denom = hourTimes.length - 1;
  let start = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start < 0) start = i;
    const end = !flags[i] || i === flags.length - 1;
    if (start >= 0 && end) {
      const last = flags[i] ? i : i - 1;
      segs.push([start / denom, last / denom]);
      start = -1;
    }
  }
  return segs;
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
    c1y = Math.max(Math.min(c1y, yHi), yLo);     // kein Ueberschwingen ueber echte Werte
    c2y = Math.max(Math.min(c2y, yHi), yLo);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
