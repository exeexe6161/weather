import type { DailyEntry } from "./weather";

// Echte Tag/Nacht-Grenzen aus den sunrise/sunset Zeiten der daily Daten
// (Stationszeit). Gemeinsame Quelle für die Mond-Symbole der Stundenleiste
// und die Nacht-Tönung des Temperaturverlaufs — beide kippen zur selben
// Minute, sonst widersprechen sich die beiden Anzeigen übereinander.

// "YYYY-MM-DDTHH:mm" (Stationszeit) → Minuten auf einer linearen Skala.
// Bewusst über Date.UTC statt new Date(iso): der String trägt keine Zone,
// und nur Differenzen zählen — so rechnet keine Nutzer-Zeitzone (DST) hinein.
export function toMinutes(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60_000;
}

export type Span = [number, number];

// Nacht-Intervalle rund um das 24h-Fenster: vor Sonnenaufgang heute, zwischen
// Sonnenuntergang heute und Sonnenaufgang morgen, nach Sonnenuntergang morgen
// (das Fenster kann alle drei berühren). null wenn die heutigen Zeiten fehlen
// (alte Caches) — Aufrufer fallen dann auf ihr bisheriges Verhalten zurück.
export function nightSpans(daily: DailyEntry[] | undefined): Span[] | null {
  const d0 = daily?.[0];
  const d1 = daily?.[1];
  const sr0 = toMinutes(d0?.sunrise);
  const ss0 = toMinutes(d0?.sunset);
  const sr1 = toMinutes(d1?.sunrise);
  const ss1 = toMinutes(d1?.sunset);
  if (sr0 === null || ss0 === null) return null;

  const spans: Span[] = [
    [Number.NEGATIVE_INFINITY, sr0],
    [ss0, sr1 ?? Number.POSITIVE_INFINITY],
  ];
  if (sr1 !== null && ss1 !== null) spans.push([ss1, Number.POSITIVE_INFINITY]);
  return spans;
}

// Kern der Nachtprüfung auf Minutenebene — von isNightAt (Stundenleiste)
// und vom TempCurve-Adapter in app.ts genutzt: wörtlich dieselbe Prüfung,
// damit Mond-Symbole und Nacht-Tönung nie auseinanderlaufen können.
export function isNightAtMinutes(stationMinutes: number, spans: Span[]): boolean {
  return spans.some(([from, to]) => stationMinutes >= from && stationMinutes < to);
}

export function isNightAt(iso: string, spans: Span[]): boolean {
  const m = toMinutes(iso);
  if (m === null) return false;
  return isNightAtMinutes(m, spans);
}
