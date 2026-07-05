// Pollenbelastung über die eigene Server Route und WeatherAPI.
// Bewusst ein eigenes Modul, getrennt von weather.ts: eigener Endpoint, und
// sein Ausfall darf die Wetteranzeige nicht blockieren. Alle Fehler werden
// still zu null — dann erscheint schlicht keine Pollensektion.
import { fetchWithTimeout, apiUrl } from "./http.js";

export const POLLEN_KINDS = ["alder", "birch", "grass", "mugwort", "hazel", "oak", "ragweed"] as const;
export type PollenKind = (typeof POLLEN_KINDS)[number];

// Aktueller Stundenwert je Art in Körnern pro Kubikmeter; null = keine Daten
// (außerhalb Europas liefert die API die Pollenfelder oft gar nicht)
export type PollenLevels = Record<PollenKind, number | null>;

export type PollenStageKey = "pollen_low" | "pollen_moderate" | "pollen_high";

// Stufengrenzen je Art in Körnern pro Kubikmeter: [gering→mittel, mittel→hoch].
// WeatherAPI beschreibt die einheitlichen Grenzen 1 bis 20, 20 bis 100 und
// über 100. Die UI übernimmt diese Skala für alle gelieferten Arten.
export const POLLEN_THRESHOLDS: Record<PollenKind, [number, number]> = {
  alder: [20, 100],
  birch: [20, 100],
  grass: [20, 100],
  mugwort: [20, 100],
  hazel: [20, 100],
  oak: [20, 100],
  ragweed: [20, 100],
};

// Unterste Anzeigeschwelle je Art (Körner pro Kubikmeter): darunter gilt die
// Belastung als sehr gering und die Art wird gar nicht gelistet. Kalibrierbar.
export const POLLEN_MIN_SHOW: Record<PollenKind, number> = {
  alder: 1,
  birch: 1,
  grass: 1,
  mugwort: 1,
  hazel: 1,
  oak: 1,
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
    const res = await fetchWithTimeout(apiUrl(`/api/pollen?${params}`));
    if (!res.ok) return null;
    return (await res.json()) as PollenLevels | null;
  } catch {
    return null;
  }
}
