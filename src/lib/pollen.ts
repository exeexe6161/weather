// Pollenbelastung über die eigene Server Route (dahinter die Open-Meteo Air
// Quality API, siehe src/server/weather/providers/OpenMeteoProvider.ts).
// Bewusst ein eigenes Modul, getrennt von weather.ts: eigener Endpoint, und
// sein Ausfall darf die Wetteranzeige nicht blockieren. Alle Fehler werden
// still zu null — dann erscheint schlicht keine Pollensektion.
import { fetchWithTimeout } from "./http.js";

export const POLLEN_KINDS = ["alder", "birch", "grass", "mugwort", "olive", "ragweed"] as const;
export type PollenKind = (typeof POLLEN_KINDS)[number];

// Aktueller Stundenwert je Art in Körnern pro Kubikmeter; null = keine Daten
// (außerhalb Europas liefert die API die Pollenfelder oft gar nicht)
export type PollenLevels = Record<PollenKind, number | null>;

export type PollenStageKey = "pollen_low" | "pollen_moderate" | "pollen_high";

// Stufengrenzen je Art in Körnern pro Kubikmeter: [gering→mittel, mittel→hoch].
// Kalibrierbar — die Arten skalieren unterschiedlich (Gräser und Birke schlagen
// früher aus als Olive, Ambrosia ist schon in kleinen Mengen potent); im
// Zweifel konservativ angesetzt.
export const POLLEN_THRESHOLDS: Record<PollenKind, [number, number]> = {
  alder: [10, 70],
  birch: [10, 90],
  grass: [6, 30],
  mugwort: [5, 25],
  olive: [25, 120],
  ragweed: [4, 15],
};

// Unterste Anzeigeschwelle je Art (Körner pro Kubikmeter): darunter gilt die
// Belastung als sehr gering und die Art wird gar nicht gelistet. Kalibrierbar.
export const POLLEN_MIN_SHOW: Record<PollenKind, number> = {
  alder: 3,
  birch: 3,
  grass: 2,
  mugwort: 2,
  olive: 8,
  ragweed: 1,
};

// Stufen Key für die Anzeige (i18n Key, kein Text); null unterhalb der
// untersten Schwelle oder ohne Daten → Art wird nicht gezeigt.
export function stageFor(kind: PollenKind, value: number | null): PollenStageKey | null {
  if (value === null || value < POLLEN_MIN_SHOW[kind]) return null;
  const [moderate, high] = POLLEN_THRESHOLDS[kind];
  if (value >= high) return "pollen_high";
  if (value >= moderate) return "pollen_moderate";
  return "pollen_low";
}

export async function fetchPollen(latitude: number, longitude: number): Promise<PollenLevels | null> {
  try {
    const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
    const res = await fetchWithTimeout(`/api/pollen?${params}`);
    if (!res.ok) return null;
    return (await res.json()) as PollenLevels | null;
  } catch {
    return null;
  }
}
