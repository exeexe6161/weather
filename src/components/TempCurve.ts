import type { Forecast, HourlyEntry } from "../lib/weather";
import { nightSpans, toMinutes } from "../lib/daylight";
import { formatHour, formatTemp } from "../lib/format";
import { t, getLocale } from "../i18n/ui";
import { esc } from "../dom";

// Temperaturverlauf als ruhige Linie: gefühlte Temperatur über die nächsten
// 24 Stunden, dieselben Stundenwerte wie die Leiste darüber. Handgebautes
// SVG, kein Chart-Framework. Radikale Zurückhaltung: eine Linie, Hoch- und
// Tiefpunkt, zwei Zeitanker, dezente Nacht-Tönung — kein Gitternetz, keine
// Tooltips, keine Animation, keine Füllfläche.
//
// Responsiv über Trennung von Geometrie und Text: das SVG enthält nur Linie
// und Nacht-Rechtecke und dehnt sich per preserveAspectRatio="none" auf die
// Kartenbreite (vector-effect hält die Strichstärke konstant); Punkte und
// Beschriftungen liegen als HTML-Overlay in Prozent darüber und bleiben auf
// jeder Breite in nativer Schriftgröße, unverzerrt und überlappungsfrei.

// SVG-Koordinaten- und Etagenraum: W wird auf die Kartenbreite gedehnt, H ist
// die echte Pixelhöhe (nur die x-Achse verzerrt — für Rechtecke und Linie
// unschädlich). Vertikale Etagen, von oben nach unten:
//   [0 .. H]                 Kurvenbereich inkl. ALLER Wertelabels
//   [H+AXIS_MARGIN .. ]      Zeitanker-Zeile (jetzt / Mitte / Ende)
// Wertelabels werden auf LABEL_TOP_MAX geklemmt: ihre Unterkante bleibt
// IMMER mindestens AXIS_BUFFER über der SVG-Unterkante und damit mindestens
// AXIS_BUFFER+AXIS_MARGIN über jedem der drei Zeitanker — egal wo Hoch und
// Tief liegen. Die Trennung gilt per Konstruktion, nicht per Einzelfall.
const W = 1000;
const H = 96;
const PAD_TOP = 20; // Raum für das Hoch-Label über der Linie (LABEL_H + GAP)
// Raum unter der Linie: Tief-Label unter dem Punkt (GAP + LABEL_H) plus der
// Sicherheitspuffer zur SVG-Unterkante — so passt das Label unter den
// tiefstmöglichen Punkt, ohne je an die Etagengrenze zu stoßen
const PAD_BOTTOM = 32;
const AXIS_BUFFER = 8; // Mindestluft Label-Unterkante ↔ SVG-Unterkante
const AXIS_MARGIN = 8; // Abstand SVG-Unterkante ↔ Zeitanker-Zeile (CSS margin-top)
// Mindestspanne der y-Skala in Grad: ein sehr flacher Verlauf bleibt eine
// ruhige Linie in der Mitte, statt rauschhaft die volle Höhe zu füllen
const MIN_SPAN_DEG = 2;
// Unter dieser Punktzahl ergibt sich keine sinnvolle Kurve (alte Caches):
// Diagramm weglassen, kein Fehler, kein leeres SVG
const MIN_POINTS = 12;

interface Pt {
  x: number; // SVG-Koordinate 0..W
  y: number; // SVG-Koordinate (Pixel, da H nicht gedehnt wird)
  v: number; // gefühlte Temperatur
}

// Weiche Linienführung: quadratische Kurven durch die Mittelpunkte der
// Segmente, die Stundenwerte als Kontrollpunkte — glättet ruhig, ohne über
// die echten Werte hinauszuschwingen (kein Überschießen wie bei Splines).
function smoothPath(p: Pt[]): string {
  let d = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = ((p[i].x + p[i + 1].x) / 2).toFixed(1);
    const my = ((p[i].y + p[i + 1].y) / 2).toFixed(1);
    d += ` Q ${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)} ${mx} ${my}`;
  }
  const last = p[p.length - 1];
  return `${d} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

// Nacht-Tönung aus der geteilten Tag/Nacht-Quelle (lib/daylight) — dieselben
// Intervalle, nach denen die Stundenleiste ihre Mond-Symbole wählt: beide
// kippen zur selben Minute. Fehlen die Sonnenzeiten (alte Caches), entfällt
// die Tönung einfach — die Linie steht für sich.
function nightRects(forecast: Forecast, m0: number, mEnd: number): string {
  const spans = nightSpans(forecast.daily);
  if (spans === null) return "";

  return spans
    .map(([from, to]) => {
      const a = Math.max(from, m0);
      const b = Math.min(to, mEnd);
      if (b <= a) return "";
      const x = ((a - m0) / (mEnd - m0)) * W;
      const w = ((b - a) / (mEnd - m0)) * W;
      return `<rect class="tc-night" x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}"/>`;
    })
    .join("");
}

// ── Hoch-/Tief-Markierungen: deterministisch berechnete Positionen ──
// Jedes Label bekommt fertige left/top Koordinaten aus TypeScript (keine
// bottom-Verankerung, keine 0×0-Anker mit statischer Position — deren
// Zusammenspiel war browserabhängig fragil). Kollisionsfreiheit wird hier
// im Code geprüft und aufgelöst, nicht dem CSS überlassen. Der "jetzt"-
// Zeitanker kann per Konstruktion nie kollidieren: Labels sind auf das
// SVG (y ≤ H) geklemmt, die Ankerzeile ist eine eigene Flusszeile darunter.
const LABEL_H = 12; // Zeilenhöhe der Wertelabels (fs-xs), fest fürs Layout
const LABEL_W = 30; // großzügige Labelbreite ("30°") für die Kollisionsprüfung
const LABEL_GAP = 7; // Abstand Label ↔ Punkt
const SIDE_GAP = 10; // seitlicher Abstand bei Randplatzierung
// Schmalste angenommene Kartenbreite (iPhone) — die Kollisionsprüfung
// rechnet Prozente in Pixel auf dieser engsten Breite um (worst case)
const REF_WIDTH = 280;

interface Mark {
  pct: number; // horizontale Punktposition in %
  dotY: number; // Punkt-Mitte in px
  labelTop: number; // Label-Oberkante in px (fertig berechnet)
  mode: "mid" | "side-r" | "side-l";
  text: string;
}

// Tiefste erlaubte Label-Oberkante: Unterkante bleibt AXIS_BUFFER über der
// SVG-Unterkante — die Etagengrenze, die KEIN Label überschreiten kann
const LABEL_TOP_MAX = H - LABEL_H - AXIS_BUFFER;

function clampLabelTop(top: number): number {
  return Math.min(LABEL_TOP_MAX, Math.max(0, top));
}

function placeMark(p: Pt, kind: "hi" | "lo"): Mark {
  const pct = (p.x / W) * 100;
  const text = formatTemp(p.v);
  // Am Rand (links steht darunter auch "jetzt"): Wert seitlich neben den
  // Punkt auf Punkthöhe — nie in die Ecke, nie über den Kartenrand hinaus
  if (pct < 6) return { pct, dotY: p.y, labelTop: clampLabelTop(p.y - LABEL_H / 2), mode: "side-r", text };
  if (pct > 94) return { pct, dotY: p.y, labelTop: clampLabelTop(p.y - LABEL_H / 2), mode: "side-l", text };
  // Hoch bevorzugt ÜBER dem Punkt, Tief bevorzugt DARUNTER; passt die
  // bevorzugte Seite nicht in die Etage (Punkt zu nah am Rand), wird auf
  // die andere Seite des Punktes geflippt — nie aus dem Kurvenbereich hinaus
  let labelTop = kind === "hi" ? p.y - LABEL_GAP - LABEL_H : p.y + LABEL_GAP;
  if (kind === "hi" && labelTop < 0) labelTop = p.y + LABEL_GAP;
  if (kind === "lo" && labelTop > LABEL_TOP_MAX) labelTop = p.y - LABEL_GAP - LABEL_H;
  return { pct, dotY: p.y, labelTop: clampLabelTop(labelTop), mode: "mid", text };
}

// Label-Rechteck in Pixeln auf der engsten Referenzbreite
function labelRect(m: Mark): { x1: number; x2: number; y1: number; y2: number } {
  const anchor = (m.pct / 100) * REF_WIDTH;
  const x1 =
    m.mode === "mid" ? anchor - LABEL_W / 2 : m.mode === "side-r" ? anchor + SIDE_GAP : anchor - SIDE_GAP - LABEL_W;
  return { x1, x2: x1 + LABEL_W, y1: m.labelTop, y2: m.labelTop + LABEL_H };
}

function rectsOverlap(a: ReturnType<typeof labelRect>, b: ReturnType<typeof labelRect>): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

// Überschneiden sich Hoch- und Tief-Label (möglich bei nahezu flachem
// Verlauf mit beiden Extremen nahe beieinander), wird das Hoch-Label nach
// oben ausgewichen — deterministisch, kein Zufall, kein Browser-Ermessen.
function resolveCollision(hi: Mark, lo: Mark): void {
  if (!rectsOverlap(labelRect(hi), labelRect(lo))) return;
  hi.labelTop = clampLabelTop(lo.labelTop - LABEL_H - 2);
  if (rectsOverlap(labelRect(hi), labelRect(lo))) {
    // Klemmung hat das Ausweichen begrenzt (beide am oberen Rand): dann
    // das Tief-Label nach unten schieben — unten ist durch PAD_BOTTOM Platz
    lo.labelTop = clampLabelTop(hi.labelTop + LABEL_H + 2);
  }
}

function markHtml(m: Mark): string {
  const cls = m.mode === "mid" ? "tc-val--mid" : m.mode === "side-r" ? "tc-val--side-r" : "tc-val--side-l";
  return `<span class="tc-dot" style="left:${m.pct.toFixed(2)}%;top:${m.dotY.toFixed(1)}px"></span>
    <span class="tc-val ${cls}" style="left:${m.pct.toFixed(2)}%;top:${m.labelTop.toFixed(1)}px">${m.text}</span>`;
}

export function renderTempCurve(el: HTMLElement, forecast: Forecast): void {
  const hourly: HourlyEntry[] = forecast.hourly ?? [];
  const valid = hourly.filter(
    (h) => Number.isFinite(h.apparentTemperature) && toMinutes(h.time) !== null,
  );
  if (valid.length < MIN_POINTS) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  const m0 = toMinutes(valid[0].time)!;
  const mEnd = toMinutes(valid[valid.length - 1].time)!;
  if (mEnd <= m0) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }

  // y-Skala: echtes Min/Max, aber mindestens MIN_SPAN_DEG Grad um die Mitte —
  // flache Verläufe bleiben ruhig und mittig
  const values = valid.map((h) => h.apparentTemperature);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const span = Math.max(vMax - vMin, MIN_SPAN_DEG);
  const top = (vMax + vMin) / 2 + span / 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;

  const pts: Pt[] = valid.map((h) => ({
    x: ((toMinutes(h.time)! - m0) / (mEnd - m0)) * W,
    y: PAD_TOP + ((top - h.apparentTemperature) / span) * innerH,
    v: h.apparentTemperature,
  }));

  const hiIdx = values.indexOf(vMax);
  const loIdx = values.indexOf(vMin);
  // Komplett flacher Verlauf: Hoch und Tief sind derselbe Wert — eine
  // Markierung genügt, zwei identische Zahlen wären Lärm
  const hiMark = placeMark(pts[hiIdx], "hi");
  let marks: string;
  if (hiIdx === loIdx) {
    marks = markHtml(hiMark);
  } else {
    const loMark = placeMark(pts[loIdx], "lo");
    resolveCollision(hiMark, loMark);
    marks = markHtml(hiMark) + markHtml(loMark);
  }

  const locale = getLocale();
  el.hidden = false;
  el.innerHTML = `
    <div class="tc-wrap">
      <svg class="tc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t("tc_aria"))}">
        ${nightRects(forecast, m0, mEnd)}
        <path class="tc-line" d="${smoothPath(pts)}" fill="none" vector-effect="non-scaling-stroke"/>
      </svg>
      <div aria-hidden="true">${marks}</div>
    </div>
    <div class="tc-axis" aria-hidden="true">
      <span>${esc(t("tc_now"))}</span>
      <span>${formatHour(valid[Math.floor(valid.length / 2)].time, locale)}</span>
      <span>${formatHour(valid[valid.length - 1].time, locale)}</span>
    </div>
  `;
}
