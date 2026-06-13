// TempCurve.ts — Temperaturverlauf des heutigen Tages als ruhige Linie.
//
// Architekturprinzip: ALLES in EINEM SVG (Linie, Flaeche, Punkte, Werte, Zeitachse).
// Ein Koordinatensystem, kein HTML-Overlay, keine Prozent-Positionen, kein separates
// CSS-Layout fuer die Beschriftung. Was die Geometrie berechnet, rendert der Browser
// pixelgenau identisch — das schliesst Label-Ueberlappungen konstruktiv aus.
//
// Designentscheidung (mit dem Nutzer abgestimmt):
//  - Fester Kalendertag 00:00..24:00 (nicht "naechste 24h ab jetzt"). Zeigt den
//    ganzen Tagesbogen inkl. bereits vergangener Stunden.
//  - Sechs Zeitmarken OPTISCH GLEICHMAESSIG verteilt (00,04,08,12,18,22): gleicher
//    Pixelabstand, ruhige lineal-artige Achse. Marke = Orientierung, kein
//    millimetergenauer Koordinatenpunkt.
//  - Linie in EINER ruhigen Farbe (Zenit-Anklang), kein Vergangenheit/Zukunft-Split.
//    Der wandernde jetzt-Punkt allein markiert die aktuelle Position im Tag.
//  - Flaeche unter der Linie mit dezentem WAERME-HAUCH: horizontaler, sehr blasser
//    Verlauf von kuehl (kalter Moment des Tages) zu warm (waermster Moment).
//    RELATIV zur Tagesspanne, also an jedem Tag lebendig. Bewusste Dekoration:
//    die exakte Temperatur steht ohnehin als Zahl/Hoehe, der Hauch deutet nur den
//    Tagesrhythmus an. Laeuft nach unten sanft aus.
//  - Hoch/Tief als feine Ringe, Werte kollisionsfrei in der oberen Etage.

export interface TempCurveInput {
  // Gefuehlte Temperatur Stunde 0..24 des HEUTIGEN Tages in Stationszeit.
  // Idealerweise 25 Werte; Luecken werden linear ueberbrueckt. Min. 13 gueltige.
  dayFeels: (number | null)[];
  // Aktuelle Dezimalstunde in STATIONSZEIT (z.B. 14.5). Ausserhalb 0..24 -> kein Punkt.
  nowHour: number;
  ariaLabel: string;  // i18n t("tc_aria")
}

const MIN_POINTS = 13;
const TICK_LABELS = ['00:00', '04:00', '08:00', '12:00', '18:00', '22:00'];

export function renderTempCurve(container: HTMLElement, input: TempCurveInput): void {
  const raw = input.dayFeels;
  let lastValid = -1;
  for (let i = 0; i < raw.length; i++) if (Number.isFinite(raw[i] as number)) lastValid = i;
  if (lastValid < 0) { hide(container); return; }

  const temps: number[] = [];
  for (let i = 0; i <= lastValid; i++) {
    const v = raw[i];
    temps.push(Number.isFinite(v as number) ? (v as number) : interp(raw, i, lastValid));
  }
  const validCount = raw.filter((v) => Number.isFinite(v as number)).length;
  if (validCount < MIN_POINTS) { hide(container); return; }

  container.hidden = false;

  const W = 340, H = 118;
  const padL = 14, padR = 14, padT = 22, padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const hoursSpan = temps.length - 1;

  // Skala: an ruhigen Tagen flach bleiben statt winzige Schwankungen auf die volle
  // Hoehe zu spreizen (sonst zackt eine 14..15-Grad-Kurve nervoes). Die Skalenspanne
  // waechst erst ab einer echten Tagesspanne von FLAT_RANGE; darunter bleibt sie auf
  // FLAT_RANGE fixiert, sodass kleine Schwankungen nur einen kleinen Teil der Hoehe
  // nutzen und die Linie ruhig in der Mitte liegt.
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const realRange = max - min;
  const FLAT_RANGE = 8;                            // unter 8 Grad Tagesspanne: ruhige, flache Kurve
  const span = Math.max(realRange, FLAT_RANGE);
  const center = (min + max) / 2;
  const lo = center - span / 2;
  const hi = center + span / 2;

  const xAtHour = (h: number) => padL + (hoursSpan <= 0 ? 0 : (plotW * h) / hoursSpan);
  const yAt = (t: number) => padT + plotH * (1 - (t - lo) / (hi - lo));
  const pts = temps.map((t, h) => ({ h, t, x: xAtHour(h), y: yAt(t) }));
  const n = pts.length;

  let hiI = 0, loI = 0;
  temps.forEach((t, i) => { if (t > temps[hiI]) hiI = i; if (t < temps[loI]) loI = i; });

  const lineD = buildSmoothPath(pts);
  const areaD = `${lineD} L ${pts[n - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  // Waerme-Hauch: horizontaler Verlauf, Farbe je Stunde nach RELATIVER Tagestemperatur.
  // Sehr blass; das vertikale Auslaufen uebernimmt die Maske + Gruppen-Opazitaet.
  const warmRange = Math.max(max - min, 1);
  const areaStops = temps.map((t, i) => {
    const tn = (t - min) / warmRange;             // 0 (kuehlster) .. 1 (waermster Moment)
    const c = mixWarm(tn);
    return `<stop offset="${((i / (n - 1)) * 100).toFixed(1)}%" stop-color="rgb(${c[0]},${c[1]},${c[2]})"/>`;
  }).join('');

  // jetzt-Punkt
  const now = input.nowHour;
  const showNow = Number.isFinite(now) && now >= 0 && now <= hoursSpan;
  const nowX = showNow ? xAtHour(now) : 0;
  const nowY = showNow ? yAtHourInterp(pts, now) : 0;

  // Sechs Marken optisch gleichmaessig (x nach Index, nicht nach Uhrzeit)
  const m = TICK_LABELS.length;
  const ticks = TICK_LABELS.map((label, k) => ({
    x: padL + (plotW * k) / (m - 1),
    label,
    anchor: k === 0 ? 'start' : k === m - 1 ? 'end' : 'middle',
  }));

  const grid = ticks
    .filter((t) => t.anchor === 'middle')
    .map((t) => `<line x1="${t.x.toFixed(1)}" y1="${padT}" x2="${t.x.toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" class="tc-grid"/>`)
    .join('');

  const ring = (p: { x: number; y: number }) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" class="tc-ring"/>`;
  const rings = ring(pts[hiI]) + (loI !== hiI ? ring(pts[loI]) : '');

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

  const nowDot = showNow ? `<circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="3" class="tc-now"/>` : '';

  const axis = ticks
    .map((t) => `<text x="${t.x.toFixed(1)}" y="${(H - 6).toFixed(1)}" class="tc-axis" text-anchor="${t.anchor}">${esc(t.label)}</text>`)
    .join('');

  const defs =
    `<defs>` +
    `<linearGradient id="tcArea" x1="${pts[0].x}" y1="0" x2="${pts[n - 1].x}" y2="0" gradientUnits="userSpaceOnUse">${areaStops}</linearGradient>` +
    `<linearGradient id="tcFade" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<mask id="tcMask"><rect x="0" y="${padT}" width="${W}" height="${plotH}" fill="url(#tcFade)"/></mask>` +
    `</defs>`;

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" class="tc-svg" role="img" aria-label="${esc(input.ariaLabel)}" preserveAspectRatio="none">` +
    defs + grid +
    `<g class="tc-area-group"><path d="${areaD}" fill="url(#tcArea)" mask="url(#tcMask)"/></g>` +
    `<path d="${lineD}" class="tc-line" fill="none" vector-effect="non-scaling-stroke"/>` +
    rings + nowDot + valHi + valLo + axis +
    `</svg>`;

  container.replaceChildren();
  container.insertAdjacentHTML('afterbegin', svg);
}

function hide(container: HTMLElement): void {
  container.hidden = true;
  container.replaceChildren();
}

// Blasse Kuehl->Warm-Mischung fuer den Waerme-Hauch (relativ, sehr gedaempft).
function mixWarm(tn: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, tn));
  const cold = [207, 224, 240];   // blasses Kuehlblau
  const warm = [243, 217, 196];   // blasses Warmsand
  return [
    Math.round(cold[0] + (warm[0] - cold[0]) * t),
    Math.round(cold[1] + (warm[1] - cold[1]) * t),
    Math.round(cold[2] + (warm[2] - cold[2]) * t),
  ];
}

function interp(raw: (number | null)[], i: number, last: number): number {
  let a = i; while (a >= 0 && !Number.isFinite(raw[a] as number)) a--;
  let b = i; while (b <= last && !Number.isFinite(raw[b] as number)) b++;
  const va = a >= 0 ? (raw[a] as number) : (raw[b] as number);
  const vb = b <= last ? (raw[b] as number) : (raw[a] as number);
  if (!Number.isFinite(va)) return vb;
  if (!Number.isFinite(vb)) return va;
  if (b === a) return va;
  return va + (vb - va) * ((i - a) / (b - a));
}

function yAtHourInterp(pts: { h: number; x: number; y: number }[], hour: number): number {
  const i = Math.floor(hour);
  const a = pts[Math.max(0, Math.min(i, pts.length - 1))];
  const b = pts[Math.max(0, Math.min(i + 1, pts.length - 1))];
  const f = hour - i;
  return a.y * (1 - f) + b.y * f;
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

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Hilfsfunktion fuer app.ts: baut dayFeels (Stunde 0..24, Stationszeit) und nowHour
// aus dem vollen heutigen Tag. hourlyToday = die nach heutigem Stationsdatum
// gefilterten Stundenwerte (aus weather.ts, siehe Verdrahtungshinweis).
export function dayFeelsFromHourly(
  hourlyToday: { time: string; apparentTemperature: number }[],
  nextMidnight: { time: string; apparentTemperature: number } | null,
  nowHourDecimal: number,
): { dayFeels: (number | null)[]; nowHour: number } {
  const byHour = new Map<number, number>();
  for (const e of hourlyToday) {
    if (typeof e.time !== 'string') continue;
    const h = Number(e.time.slice(11, 13));
    if (Number.isFinite(h)) byHour.set(h, e.apparentTemperature);
  }
  const dayFeels: (number | null)[] = [];
  for (let h = 0; h <= 24; h++) {
    if (h < 24) dayFeels.push(byHour.has(h) ? byHour.get(h)! : null);
    else dayFeels.push(nextMidnight ? nextMidnight.apparentTemperature : null);
  }
  return { dayFeels, nowHour: nowHourDecimal };
}
