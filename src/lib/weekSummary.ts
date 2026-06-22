// Wochenüberblick: wählt den "schönsten" Tag der nächsten Woche. HYBRID — relativ
// den besten Tag küren, aber nur, wenn er ein absolutes Mindestniveau erreicht
// (warm UND trocken). Sonst null → keine Aussage (ehrlich statt schöngeredet).
// Liefert nur i18n-Key + Tagesindex; Wochentagsname und Text entstehen in der
// Render-Schicht (wie summaryFor/summaryText getrennt sind).
import type { DailyEntry } from "./weather";
import { isPrecipCode } from "./wmo";

// ── Schwellen, kalibrierbar ──
export const WARM_MIN = 18; // Grad: darunter ist kein Tag "schön"
export const DRY_MAX = 30;  // Prozent Regenwahrscheinlichkeit: darunter gilt "trocken"
export const WEEK_DAYS = 7;  // nur die nächsten ~7 Tage, nicht die unsicheren 16

export interface BestDay {
  key: string;      // "week_best_today" für heute, sonst "week_best_day"
  dayIndex: number; // Index in daily (0 = heute) für den Wochentagsnamen
}

export function bestWeatherDayKey(days: DailyEntry[]): BestDay | null {
  const week = days.slice(0, WEEK_DAYS);

  // Bester Kandidat: primär höchste tempMax, sekundär niedrigste Regenwahrschein-
  // lichkeit. Bei vollem Gleichstand bleibt der frühere Tag (erst gefundene).
  let best: { idx: number; temp: number; prob: number } | null = null;
  for (let i = 0; i < week.length; i++) {
    const d = week[i];
    // Alte Forecast-Caches ohne die Felder defensiv überspringen.
    if (
      typeof d.tempMax !== "number" || !Number.isFinite(d.tempMax) ||
      typeof d.precipitationProbabilityMax !== "number" || !Number.isFinite(d.precipitationProbabilityMax) ||
      typeof d.weatherCode !== "number"
    ) {
      continue;
    }
    // Mindestniveau (alle drei Bedingungen): warm, trocken genug, kein Niederschlagscode.
    const qualifies =
      d.tempMax >= WARM_MIN &&
      d.precipitationProbabilityMax < DRY_MAX &&
      !isPrecipCode(d.weatherCode);
    if (!qualifies) continue;

    if (
      best === null ||
      d.tempMax > best.temp ||
      (d.tempMax === best.temp && d.precipitationProbabilityMax < best.prob)
    ) {
      best = { idx: i, temp: d.tempMax, prob: d.precipitationProbabilityMax };
    }
  }

  if (best === null) return null; // kein Tag erreicht das Mindestniveau → keine Aussage
  return { key: best.idx === 0 ? "week_best_today" : "week_best_day", dayIndex: best.idx };
}
