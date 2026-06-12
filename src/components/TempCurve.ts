import type { Forecast, HourlyEntry } from "../lib/weather";
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

// SVG-Koordinatenraum: W wird auf die Kartenbreite gedehnt, H ist die echte
// Pixelhöhe (nur die x-Achse verzerrt — für Rechtecke und Linie unschädlich)
const W = 1000;
const H = 88;
const PAD_TOP = 18; // Raum für das Hoch-Label über der Linie
const PAD_BOTTOM = 22; // Raum für das Tief-Label unter der Linie
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

// "YYYY-MM-DDTHH:mm" (Stationszeit) → Minuten auf einer linearen Skala.
// Bewusst über Date.UTC statt new Date(iso): der String trägt keine Zone,
// und nur Differenzen zählen — so rechnet keine Nutzer-Zeitzone (DST) hinein.
function toMinutes(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60_000;
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

// Nacht-Tönung: Rechtecke für die Zeiträume vor Sonnenaufgang heute, zwischen
// Sonnenuntergang heute und Sonnenaufgang morgen, und nach Sonnenuntergang
// morgen (das 24h-Fenster kann beide berühren). Fehlen die heutigen Zeiten
// (alte Caches), entfällt die Tönung einfach — die Linie steht für sich.
function nightRects(forecast: Forecast, m0: number, mEnd: number): string {
  const d0 = forecast.daily?.[0];
  const d1 = forecast.daily?.[1];
  const sr0 = toMinutes(d0?.sunrise);
  const ss0 = toMinutes(d0?.sunset);
  const sr1 = toMinutes(d1?.sunrise);
  const ss1 = toMinutes(d1?.sunset);
  if (sr0 === null || ss0 === null) return "";

  const spans: Array<[number, number]> = [
    [Number.NEGATIVE_INFINITY, sr0],
    [ss0, sr1 ?? Number.POSITIVE_INFINITY],
  ];
  if (sr1 !== null && ss1 !== null) spans.push([ss1, Number.POSITIVE_INFINITY]);

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

// Hoch-/Tief-Markierung als HTML: Punkt exakt auf der Linie (Prozent/Pixel),
// Wert darüber bzw. darunter; an den Rändern wird nur das Label umgelenkt,
// nie der Punkt — der muss auf der Linie sitzen.
function markHtml(p: Pt, kind: "hi" | "lo"): string {
  const pct = (p.x / W) * 100;
  const edge = pct < 5 ? " tc-val--left" : pct > 95 ? " tc-val--right" : "";
  return `<div class="tc-mark" style="left:${pct.toFixed(2)}%;top:${p.y.toFixed(1)}px">
    <span class="tc-dot"></span>
    <span class="tc-val tc-val--${kind}${edge}">${formatTemp(p.v)}</span>
  </div>`;
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
  const marks =
    hiIdx === loIdx
      ? markHtml(pts[hiIdx], "hi")
      : markHtml(pts[hiIdx], "hi") + markHtml(pts[loIdx], "lo");

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
      <span>${formatHour(valid[valid.length - 1].time, locale)}</span>
    </div>
  `;
}
