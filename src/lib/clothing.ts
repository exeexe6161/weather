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
