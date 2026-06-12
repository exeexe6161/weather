// Anziehempfehlung: Stufen nach gefühlter Temperatur (apparent_temperature).
// Liefert nur i18n Keys und Stundenwerte; die sichtbare Copy entsteht in der
// Komponente über die uiLabels.
import type { HourlyEntry } from "./weather";

export type StageKey =
  | "stage_shirt"
  | "stage_shirt_layer"
  | "stage_light_jacket"
  | "stage_jacket"
  | "stage_heavy_jacket"
  | "stage_winter";

// Untergrenzen der Stufen in Grad Celsius (gefühlt), zum Kalibrieren
export const SHIRT_MIN = 24;
export const SHIRT_LAYER_MIN = 18;
export const LIGHT_JACKET_MIN = 12;
export const JACKET_MIN = 5;
export const HEAVY_JACKET_MIN = -2;

// Ab dieser Regenwahrscheinlichkeit (Prozent) wird ein Regenfenster gemeldet
export const RAIN_PROB_THRESHOLD = 40;

export function stageFor(apparentTemp: number): StageKey {
  if (apparentTemp >= SHIRT_MIN) return "stage_shirt";
  if (apparentTemp >= SHIRT_LAYER_MIN) return "stage_shirt_layer";
  if (apparentTemp >= LIGHT_JACKET_MIN) return "stage_light_jacket";
  if (apparentTemp >= JACKET_MIN) return "stage_jacket";
  if (apparentTemp >= HEAVY_JACKET_MIN) return "stage_heavy_jacket";
  return "stage_winter";
}

export function hourOf(iso: string): number {
  return Number(iso.slice(11, 13));
}

// hourly beginnt bereits bei der ersten Stunde >= current.time (normalize in
// weather.ts); hier bleibt nur der heutige Rest bis 23 Uhr lokaler Zeit übrig.
export function todayHours(hourly: HourlyEntry[], currentTime: string): HourlyEntry[] {
  const day = currentTime.slice(0, 10);
  return hourly.filter((h) => h.time.slice(0, 10) === day);
}

export interface StageSegment {
  stage: StageKey;
  fromHour: number;
  toHour: number; // exklusiv: Startstunde des nächsten Segments bzw. Tagesende
}

// Aufeinanderfolgende Stunden gleicher Stufe zu Segmenten zusammenfassen
export function segmentsFor(hours: HourlyEntry[]): StageSegment[] {
  const segments: StageSegment[] = [];
  for (const h of hours) {
    const stage = stageFor(h.apparentTemperature);
    const hour = hourOf(h.time);
    const last = segments[segments.length - 1];
    if (last && last.stage === stage) last.toHour = hour + 1;
    else segments.push({ stage, fromHour: hour, toHour: hour + 1 });
  }
  return segments;
}

// ── Verlaufszeile kompakt halten (nur die Anzeige, nicht die Headline) ──
// Höchstens so viele Abschnitte; sehr kurze Stufen gelten als Lärm und gehen im
// Nachbarn auf. Beide Schwellen kalibrierbar.
export const MAX_SEGMENTS = 3;
export const MIN_SEGMENT_HOURS = 3;

// Stufen von warm nach kalt; der Abstand im Array misst die Ähnlichkeit zweier
// Stufen (Nachbarn = fast gleich, z. B. Shirt und Shirt mit dünner Lage).
const STAGE_ORDER: StageKey[] = [
  "stage_shirt",
  "stage_shirt_layer",
  "stage_light_jacket",
  "stage_jacket",
  "stage_heavy_jacket",
  "stage_winter",
];
const stageRank = (stage: StageKey): number => STAGE_ORDER.indexOf(stage);
const stageGap = (a: StageKey, b: StageKey): number => Math.abs(stageRank(a) - stageRank(b));
const durationOf = (s: StageSegment): number => s.toHour - s.fromHour;

// Verschmilzt zwei benachbarte Segmente; das längere bestimmt die Stufe (bei
// Gleichstand die wärmere, also frühere im STAGE_ORDER).
function mergeSegments(a: StageSegment, b: StageSegment): StageSegment {
  const stage =
    durationOf(a) > durationOf(b) ? a.stage
    : durationOf(b) > durationOf(a) ? b.stage
    : stageRank(a.stage) <= stageRank(b.stage) ? a.stage : b.stage;
  return { stage, fromHour: a.fromHour, toHour: b.toHour };
}

// Aufeinanderfolgende Segmente gleicher Stufe zusammenziehen
function coalesceSegments(segments: StageSegment[]): StageSegment[] {
  const out: StageSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.stage === seg.stage) out[out.length - 1] = { ...last, toHour: seg.toHour };
    else out.push({ ...seg });
  }
  return out;
}

// Kurzes Segment in den ähnlichsten Nachbarn schlucken (bei gleicher Nähe in
// den längeren). Am Rand gibt es nur einen Nachbarn.
function absorbSegment(segments: StageSegment[], i: number): StageSegment[] {
  const left = i > 0 ? segments[i - 1] : null;
  const right = i < segments.length - 1 ? segments[i + 1] : null;
  let intoLeft: boolean;
  if (left && right) {
    const gl = stageGap(segments[i].stage, left.stage);
    const gr = stageGap(segments[i].stage, right.stage);
    intoLeft = gl < gr ? true : gr < gl ? false : durationOf(left) >= durationOf(right);
  } else {
    intoLeft = left !== null;
  }
  if (intoLeft) {
    return [...segments.slice(0, i - 1), mergeSegments(left!, segments[i]), ...segments.slice(i + 1)];
  }
  return [...segments.slice(0, i), mergeSegments(segments[i], right!), ...segments.slice(i + 2)];
}

// Verlaufssegmente entschlacken: kurze Blitzstufen schlucken, gleiche Nachbarn
// zusammenziehen, Anzahl deckeln. Liefert evtl. nur ein Segment, dann entfällt
// die Verlaufszeile (die Komponente rendert sie erst ab zwei Segmenten).
export function simplifySegments(input: StageSegment[]): StageSegment[] {
  let segs = coalesceSegments(input);

  // 1) Kürzeste Stufe unter der Schwelle in den Nachbarn schlucken, bis keine
  //    zu kurze mehr übrig ist (kürzeste zuerst: der größte Lärm geht zuerst)
  while (segs.length > 1) {
    let shortest = -1;
    for (let i = 0; i < segs.length; i++) {
      if (durationOf(segs[i]) < MIN_SEGMENT_HOURS &&
          (shortest === -1 || durationOf(segs[i]) < durationOf(segs[shortest]))) {
        shortest = i;
      }
    }
    if (shortest === -1) break;
    segs = coalesceSegments(absorbSegment(segs, shortest));
  }

  // 2) Anzahl deckeln: das ähnlichste Nachbarpaar verschmelzen (bei gleicher
  //    Nähe das kürzeste), bis MAX_SEGMENTS erreicht ist
  while (segs.length > MAX_SEGMENTS) {
    let bestI = 0;
    let bestGap = Infinity;
    let bestDur = Infinity;
    for (let i = 0; i < segs.length - 1; i++) {
      const gap = stageGap(segs[i].stage, segs[i + 1].stage);
      const dur = durationOf(segs[i]) + durationOf(segs[i + 1]);
      if (gap < bestGap || (gap === bestGap && dur < bestDur)) {
        bestGap = gap;
        bestDur = dur;
        bestI = i;
      }
    }
    segs = coalesceSegments([
      ...segs.slice(0, bestI),
      mergeSegments(segs[bestI], segs[bestI + 1]),
      ...segs.slice(bestI + 2),
    ]);
  }

  return segs;
}

export interface RainWindow {
  maxProb: number;
  fromHour: number;
  toHour: number; // exklusiv: ein Stundenwert deckt [Stunde, Stunde + 1) ab
}

// Erster zusammenhängender Block mit Regenwahrscheinlichkeit >= Schwelle,
// null wenn keine Stunde die Schwelle erreicht
export function rainWindowFor(hours: HourlyEntry[]): RainWindow | null {
  let window: RainWindow | null = null;
  for (const h of hours) {
    if (h.precipitationProbability >= RAIN_PROB_THRESHOLD) {
      const hour = hourOf(h.time);
      if (!window) window = { maxProb: h.precipitationProbability, fromHour: hour, toHour: hour + 1 };
      else {
        window.toHour = hour + 1;
        window.maxProb = Math.max(window.maxProb, h.precipitationProbability);
      }
    } else if (window) {
      break;
    }
  }
  return window;
}
