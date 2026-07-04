// TempCurve.ts — Gefuehlte Temperatur der naechsten 24 Stunden als ruhige Linie.
//
// Architekturprinzip: ALLES in EINEM SVG (Linie, Flaeche, Punkte, Werte, Zeitachse,
// Bezugslinien, Ueberschrift). Ein Koordinatensystem, kein HTML-Overlay, keine
// Prozent-Positionen, kein separates CSS-Layout fuer die Beschriftung. Was die
// Geometrie berechnet, rendert der Browser pixelgenau identisch — das schliesst
// Label-Ueberlappungen konstruktiv aus.
//
// Designentscheidung (mit dem Nutzer ueber viele Iterationen abgestimmt):
//  - ROLLENDE 24-Stunden-Ansicht ab jetzt. Wer um 17 Uhr reinschaut, sieht
//    17 Uhr heute -> 17 Uhr morgen. Reine Vorschau, kein vergangenes Wetter.
//    Der jetzt-Punkt sitzt immer ganz LINKS (Index 0).
//  - Fuenf Zeitmarken optisch GLEICHMAESSIG verteilt: "jetzt" plus vier echte
//    Uhrzeiten (startHour + Offset). Bewusst gleicher Pixelabstand; die Uhrzeiten
//    wechseln also je nach Tageszeit (Preis fuer den Blick nach vorn).
//  - Temperaturwerte in einer ruhigen OBEREN ZEILE, gleiche Hoehe, jeder ueber
//    seinem Punkt; eine sehr feine Bezugslinie fuehrt vom Wert zur Kurve. Werte und
//    Uhrzeiten rahmen die Kurve als zwei saubere Zeilen — nichts in die Kurve
//    gequetscht.
//  - Linie EINFARBIG (Zenit). Mittlere Markierungspunkte als feine hohle Ringe;
//    der jetzt-Punkt gefuellt mit hellem Hof.
//  - Flaeche mit dezentem WAERME-HAUCH (relativ zur Spanne, sehr blass, laeuft nach
//    unten aus). Dekoration: die exakte Temperatur steht als Zahl, der Hauch deutet
//    nur den Rhythmus an.
//  - Ruhige Tage (kleine Spanne) bleiben flach statt nervoes zu zacken (FLAT_RANGE).

export interface TempCurveInput {
  // Gefuehlte Temperatur fuer jetzt..+24h (idealerweise 25 Werte). Luecken werden
  // linear ueberbrueckt. Mindestens 13 gueltige Werte noetig, sonst versteckt.
  feels: (number | null)[];
  // Ganzzahlige erste Forecast Stunde (0..23) fuer die Achsenbeschriftung.
  // Ausserhalb 0..23 -> Marken zeigen nur Offsets ab "jetzt" ohne Uhrzeit.
  startHour: number;
  // Hinweis: Die sichtbare Ueberschrift ("GEFÜHLTE TEMPERATUR · 24 STUNDEN") wird
  // NICHT hier gezeichnet, sondern als normaler Kartentitel im HTML ueber der Karte
  // gesetzt — gleiches Muster wie "HEUTE ANZIEHEN" / "NÄCHSTE 24 STUNDEN". So bleiben
  // alle Karten konsistent. Diese Komponente rendert nur das Diagramm-SVG.
  ariaLabel: string;  // i18n t("tc_aria")
}

const MIN_POINTS = 13;
const MARKS = 5;            // jetzt + 4 weitere
const FLAT_RANGE = 8;       // unter 8 Grad Spanne: ruhige, flache Kurve

export function renderTempCurve(container: HTMLElement, input: TempCurveInput): void {
  const raw = input.feels;
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

  const W = 340, H = 116;
  const padL = 16, padR = 16;
  const valRowY = 14;          // feste Wertezeile oben
  const padT = 30;             // Kurve beginnt darunter
  const padB = 22;             // Uhrzeit-Zeile unten
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const hoursSpan = temps.length - 1;

  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const realRange = max - min;
  const span = Math.max(realRange, FLAT_RANGE);
  const center = (min + max) / 2;
  const lo = center - span / 2;
  const hi = center + span / 2;

  const xAt = (i: number) => padL + (hoursSpan <= 0 ? 0 : (plotW * i) / hoursSpan);
  const yAt = (t: number) => padT + plotH * (1 - (t - lo) / (hi - lo));
  const pts = temps.map((t, i) => ({ i, t, x: xAt(i), y: yAt(t) }));
  const n = pts.length;

  const lineD = buildSmoothPath(pts);
  const areaD = `${lineD} L ${pts[n - 1].x.toFixed(2)} ${(padT + plotH).toFixed(2)} L ${pts[0].x.toFixed(2)} ${(padT + plotH).toFixed(2)} Z`;

  // Waerme-Hauch: horizontaler, sehr blasser Verlauf nach RELATIVER Tagestemperatur.
  const warmRange = Math.max(realRange, 1);
  const areaStops = temps.map((t, i) => {
    const c = mixWarm((t - min) / warmRange);
    return `<stop offset="${((i / (n - 1)) * 100).toFixed(1)}%" stop-color="rgb(${c[0]},${c[1]},${c[2]})"/>`;
  }).join('');

  // Fuenf gleichmaessig verteilte Markierungen (x nach Index, nicht nach Uhrzeit).
  const startOk = Number.isFinite(input.startHour) && input.startHour >= 0 && input.startHour <= 23;
  const marks = [];
  for (let k = 0; k < MARKS; k++) {
    const idx = Math.round((k / (MARKS - 1)) * hoursSpan);
    const label = k === 0
      ? 'jetzt'
      : startOk
        ? `${String((input.startHour + idx) % 24).padStart(2, '0')}:00`
        : `+${idx}h`;
    const anchor = idx === 0 ? 'start' : idx === hoursSpan ? 'end' : 'middle';
    marks.push({ idx, x: pts[idx].x, y: pts[idx].y, t: pts[idx].t, label, anchor });
  }

  // Feine Bezugslinien vom Wert (oben) zur Kurve, einheitlich 8px ueber dem Punkt endend.
  const guides = marks
    .map((mk) => `<line x1="${mk.x.toFixed(2)}" y1="${valRowY + 6}" x2="${mk.x.toFixed(2)}" y2="${(mk.y - 8).toFixed(2)}" class="tc-guide"/>`)
    .join('');

  // Werte oben, ausgerichtet an Punkt-x.
  const vals = marks
    .map((mk) => `<text x="${mk.x.toFixed(2)}" y="${valRowY}" class="tc-val" text-anchor="${mk.anchor}">${Math.round(mk.t)}\u00B0</text>`)
    .join('');

  // Punkte: jetzt gefuellt mit Hof, uebrige hohle Ringe.
  const dots = marks.map((mk) => {
    if (mk.idx === 0) {
      return `<circle cx="${mk.x.toFixed(2)}" cy="${mk.y.toFixed(2)}" r="6.5" class="tc-now-halo"/>` +
             `<circle cx="${mk.x.toFixed(2)}" cy="${mk.y.toFixed(2)}" r="3.6" class="tc-now"/>` +
             `<circle cx="${mk.x.toFixed(2)}" cy="${mk.y.toFixed(2)}" r="1.5" class="tc-now-core"/>`;
    }
    return `<circle cx="${mk.x.toFixed(2)}" cy="${mk.y.toFixed(2)}" r="3" class="tc-ring"/>`;
  }).join('');

  const axis = marks
    .map((mk) => `<text x="${mk.x.toFixed(2)}" y="${(H - 7).toFixed(2)}" class="tc-axis" text-anchor="${mk.anchor}">${esc(mk.label)}</text>`)
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
    defs + guides +
    `<g class="tc-area-group"><path d="${areaD}" fill="url(#tcArea)" mask="url(#tcMask)"/></g>` +
    `<path d="${lineD}" class="tc-line" fill="none" vector-effect="non-scaling-stroke"/>` +
    dots + vals + axis +
    `</svg>`;

  container.replaceChildren();
  container.insertAdjacentHTML('afterbegin', svg);
}

function hide(container: HTMLElement): void {
  container.hidden = true;
  container.replaceChildren();
}

function mixWarm(tn: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, tn));
  const cold = [207, 224, 240];
  const warm = [243, 217, 196];
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

function buildSmoothPath(P: { x: number; y: number }[]): string {
  if (P.length < 2) return '';
  let d = `M ${P[0].x.toFixed(2)} ${P[0].y.toFixed(2)}`;
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
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Achsenstart direkt aus forecast.hourly[0].time. So bleiben Labels auch bei
// Offline Daten und rund um einen Stundenwechsel exakt an den Kurvenwerten.
export function forecastStartHour(firstForecastTime: string | undefined): number {
  if (typeof firstForecastTime !== 'string') return -1;
  const hour = Number(firstForecastTime.slice(11, 13));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : -1;
}
