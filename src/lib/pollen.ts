// Pollenbelastung über die eigene Server Route und WeatherAPI.
// Bewusst ein eigenes Modul, getrennt von weather.ts: eigener Endpoint, und
// sein Ausfall darf die Wetteranzeige nicht blockieren.
//
// Der Ausgang wird als Status zurückgegeben, nicht mehr als `null`. Vorher
// lieferten ein Fehlerstatus, ein Netzfehler und eine erfolgreiche Antwort ohne
// Pollenfelder alle dasselbe `null`, und die Oberfläche konnte "hier gibt es
// keine Daten" nicht von "der Abruf ist gescheitert" trennen.
import { fetchWithTimeout, apiUrl } from "./http.js";
import type { PollenStatus } from "./sectionState.js";

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

// Ergebnis eines Abrufs. "loading" gehört zum Anzeigezustand und wird hier nie
// zurückgegeben; die App setzt ihn selbst, solange kein Abruf abgeschlossen ist.
export type PollenResult =
  | { status: Extract<PollenStatus, "loading"> }
  | { status: Extract<PollenStatus, "ok">; levels: PollenLevels }
  | { status: Extract<PollenStatus, "unavailable"> }
  | { status: Extract<PollenStatus, "failed"> };

// Startwert für die App: noch kein Abruf abgeschlossen.
export const POLLEN_LOADING: PollenResult = { status: "loading" };

// Wirft nie. Die Unterscheidung:
//   failed      – Fehlerstatus, Zeitüberschreitung, Netzfehler, defekter Body
//   unavailable – HTTP 200, aber Body `null` bzw. kein Objekt
//   ok          – HTTP 200 mit Pollenobjekt
//
// Ehrliche Einschränkung: die Server Route fängt einen Providerfehler intern ab
// und antwortet dann ebenfalls mit 200 und `null`. Dieser Fall ist hier nicht
// von echter regionaler Nichtverfügbarkeit unterscheidbar, solange api/ und
// src/server/ unverändert bleiben. Der sichtbare Text zu "unavailable" spricht
// deshalb nur über Verfügbarkeit und behauptet weder eine Abdeckungslücke des
// Anbieters noch das Ausbleiben von Pollen.
export async function fetchPollen(latitude: number, longitude: number): Promise<PollenResult> {
  try {
    const res = await fetchWithTimeout(apiUrl("/api/pollen"), 12000, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: latitude, lon: longitude }),
    });
    if (!res.ok) return { status: "failed" };
    const body = (await res.json()) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body)) return { status: "unavailable" };
    return { status: "ok", levels: body as PollenLevels };
  } catch {
    return { status: "failed" };
  }
}

// Zählt aus einem Pollenobjekt die Arten mit einer echten Zahl und davon die
// über der Anzeigeschwelle. Beide Zahlen entscheiden in pollenSectionState, ob
// eine Liste, eine Entwarnung oder ein Verfügbarkeitshinweis erscheint. Reine
// Funktion, defensiv gegen fehlende oder unerwartete Felder.
export function countPollen(levels: PollenLevels): { measured: number; notable: number } {
  let measured = 0;
  let notable = 0;
  for (const kind of POLLEN_KINDS) {
    const value = levels[kind];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    measured++;
    if (stageFor(kind, value) !== null) notable++;
  }
  return { measured, notable };
}
