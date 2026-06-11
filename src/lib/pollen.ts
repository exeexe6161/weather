// Pollenbelastung über die Open-Meteo Air Quality API. Bewusst ein eigenes
// Modul und ein eigener Abruf, getrennt von weather.ts: die Air Quality API
// liegt auf einer eigenen Domain (air-quality-api.open-meteo.com, in der
// Datenschutzerklärung ausgewiesen), und ihr Ausfall darf die Wetteranzeige
// nicht blockieren. Alle Fehler werden still zu null — dann erscheint schlicht
// keine Pollensektion.
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

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

// "Jetzt" in der Stationszeitzone als YYYY-MM-DDTHH:mm, lexikalisch
// vergleichbar mit den hourly.time Strings (gleiche Intl-Mechanik wie die
// UV-Tageslicht-Prüfung; nie Stunden von Hand addieren).
function nowInZone(timezone: unknown): string | null {
  if (typeof timezone !== "string" || timezone === "") return null;
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replace(" ", "T");
  } catch {
    return null;
  }
}

export async function fetchPollen(latitude: number, longitude: number): Promise<PollenLevels | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      hourly: POLLEN_KINDS.map((k) => `${k}_pollen`).join(","),
      timezone: "auto",
    });
    const res = await fetch(`${AIR_QUALITY_URL}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const h = data?.hourly;
    if (!h?.time?.length) return null;

    // Erste Stunde >= jetzt, dieselbe Logik wie beim Wetterabruf
    const now = nowInZone(data.timezone);
    const idx = now === null ? 0 : Math.max(0, h.time.findIndex((t: string) => t >= now));

    const levels = {} as PollenLevels;
    for (const kind of POLLEN_KINDS) {
      const value = h[`${kind}_pollen`]?.[idx];
      levels[kind] = typeof value === "number" ? value : null;
    }
    return levels;
  } catch {
    return null;
  }
}
