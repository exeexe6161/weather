// Wochenüberblick: wählt den "schönsten" Tag der nächsten Woche. HYBRID — relativ
// den besten Tag küren, aber nur, wenn er ein absolutes Mindestniveau erreicht
// (warm UND trocken). Sonst null → keine Aussage (ehrlich statt schöngeredet).
// Liefert nur i18n-Key + Tagesindex; Wochentagsname und Text entstehen in der
// Render-Schicht (wie summaryFor/summaryText getrennt sind).
import type { DailyEntry } from "./weather";

// ── Schwellen, kalibrierbar ──
export const WARM_MIN = 18; // Grad: darunter ist kein Tag "schön"
export const DRY_MAX = 30;  // Prozent Regenwahrscheinlichkeit: darunter gilt "trocken"
export const WEEK_DAYS = 7;  // nur die nächsten ~7 Tage, nicht die unsicheren 16

export interface BestDay {
  key: string;      // "week_best_today" für heute, sonst "week_best_day"
  dayIndex: number; // Index in daily (0 = heute) für den Wochentagsnamen
}

// Klarheits-Stufe aus dem WMO-Code: je höher, desto klarer/schöner. Bewusst lokal
// und schlank gehalten (entkoppelt von der internen skyFor in summary.ts).
//   0 → 3 (klar), 1 → 2 (überwiegend klar), 2 → 1 (teils bewölkt, niedrigste
//   "schön"-Stufe), alles andere → 0 (bedeckt 3, Nebel 45/48, jeder Niederschlag).
// "Schön" heißt clearnessRank >= 1; rank 0 deckt auch alle Niederschlagscodes ab,
// ein zusätzlicher isPrecipCode-Check ist damit überflüssig.
function clearnessRank(code: number): number {
  if (code === 0) return 3;
  if (code === 1) return 2;
  if (code === 2) return 1;
  return 0;
}

export function bestWeatherDayKey(days: DailyEntry[]): BestDay | null {
  const week = days.slice(0, WEEK_DAYS);

  // Bester Kandidat: primär klarster Himmel, sekundär höchste tempMax, tertiär
  // niedrigste Regenwahrscheinlichkeit. Bei vollem Gleichstand bleibt der frühere Tag.
  let best: { idx: number; clear: number; temp: number; prob: number } | null = null;
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
    const clear = clearnessRank(d.weatherCode);
    // Mindestniveau (alle drei Bedingungen): warm, trocken genug, und ein schöner
    // Himmel (clear >= 1) — das schließt bedeckt, Nebel UND jeden Niederschlag aus.
    const qualifies =
      d.tempMax >= WARM_MIN &&
      d.precipitationProbabilityMax < DRY_MAX &&
      clear >= 1;
    if (!qualifies) continue;

    // Rangfolge: Himmel führt, dann Wärme, dann Trockenheit.
    if (
      best === null ||
      clear > best.clear ||
      (clear === best.clear && d.tempMax > best.temp) ||
      (clear === best.clear && d.tempMax === best.temp && d.precipitationProbabilityMax < best.prob)
    ) {
      best = { idx: i, clear, temp: d.tempMax, prob: d.precipitationProbabilityMax };
    }
  }

  if (best === null) return null; // kein Tag erreicht das Mindestniveau → keine Aussage
  return { key: best.idx === 0 ? "week_best_today" : "week_best_day", dayIndex: best.idx };
}
