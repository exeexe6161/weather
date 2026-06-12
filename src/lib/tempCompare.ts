// Vergleich zu gestern: heutiger Tageshöchstwert gegen den gestrigen.
// Bewusst die echte Temperatur (nicht gefühlt) — der Tageshöchstwert ist die
// intuitive Größe hinter "wärmer als gestern". Rein beschreibend, die Zeile
// schweigt bei nicht spürbarem Unterschied.

// Kalibrierbare Schwellen in Grad, symmetrisch für kühler:
// |diff| >= WARM_MUCH → "deutlich", |diff| >= WARM_SOME → "etwas",
// darunter keine Zeile (zu klein, kein Mehrwert).
export const WARM_MUCH = 5;
export const WARM_SOME = 2;

export type TempCompareKey =
  | "cmp_much_warmer"
  | "cmp_bit_warmer"
  | "cmp_bit_cooler"
  | "cmp_much_cooler";

// unknown statt number: gestriger Wert kann fehlen (API-Lücke) oder in
// Forecast-Caches vor diesem Feature gar nicht existieren — dann null,
// die Zeile entfällt ohne Fehler.
export function tempCompareKey(todayMax: unknown, yesterdayMax: unknown): TempCompareKey | null {
  if (typeof todayMax !== "number" || !Number.isFinite(todayMax)) return null;
  if (typeof yesterdayMax !== "number" || !Number.isFinite(yesterdayMax)) return null;
  const diff = todayMax - yesterdayMax;
  if (diff >= WARM_MUCH) return "cmp_much_warmer";
  if (diff >= WARM_SOME) return "cmp_bit_warmer";
  if (diff <= -WARM_MUCH) return "cmp_much_cooler";
  if (diff <= -WARM_SOME) return "cmp_bit_cooler";
  return null;
}
