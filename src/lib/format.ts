export function formatHour(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
// Date-only Strings ("YYYY-MM-DD", Stationszeit-Kalendertag) zonenfrei verankern:
// Komponenten parsen und über Date.UTC bauen — dieselbe Mechanik wie daylight.ts
// toMinutes. new Date("2026-06-23") läge sonst auf UTC-Mitternacht, und ein
// negativer Geräte-Offset (Amerika) zöge das Datum beim Formatieren auf den
// Vortag. Beim Formatieren immer timeZone:"UTC" setzen, dann bleibt es der Tag,
// den der String benennt. Nur für reine Datums-Strings, nicht für formatHour.
function utcCalendarDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(iso);
}
export function formatWeekday(iso: string, locale = "de-DE"): string {
  return utcCalendarDate(iso).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
}
// Voller Wochentagsname für Prosa ("Mittwoch" statt "Mi."); dieselbe Intl-Quelle
// wie formatWeekday, daher konsistent mit den Kürzeln der Tagesliste.
export function formatWeekdayLong(iso: string, locale = "de-DE"): string {
  return utcCalendarDate(iso).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
}
// Platzhalter für einen fehlenden Messwert (null/undefined/NaN aus teil-
// degradierter API-Antwort oder altem Forecast-Cache). Ohne diesen Guard würde
// Math.round(undefined) als "NaN°" sichtbar oder Math.round(null) fälschlich als
// "0°". Bewusst Number.isFinite (wie isCompleteDay in weather.ts): 0 °C / 0 km/h
// / 0 % sind gültige Werte (Number.isFinite(0) === true) und bleiben erhalten —
// nur echte Fehlwerte zeigen den Platzhalter. Eine Quelle für alle Aufrufer
// (current, Tages- und Stundenwerte, Favoriten-Chip, Tab-Titel).
const MISSING = "–";
export function formatTemp(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°` : MISSING;
}
export function formatWind(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} km/h` : MISSING;
}
// 8-Punkt Kompass Kürzel aus einem Gradwert. Die Kürzel kommen aus dem i18n Wert
// compassPoints (sprachabhängig, vom Aufrufer übergeben, damit dieses Modul
// i18n-frei bleibt). Ungültiger Grad oder leerer/kaputter compassPoints → "".
export function compassPointFor(deg: number, compassPoints: string): string {
  if (!Number.isFinite(deg)) return "";
  const pts = compassPoints.split(",");
  return pts[Math.round(deg / 45) % 8] ?? "";
}
// Niederschlagsmenge in mm, locale-aware, immer eine Nachkommastelle. Eine Quelle
// für alle Aufrufer (Stundenpanel und Regen-Diagramm), damit "1,2 mm" / "1.2 mm"
// überall identisch formatiert sind.
export function fmtMm(value: number, locale = "de-DE"): string {
  return `${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;
}
export function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}\u202F%` : MISSING; // schmales geschütztes Leerzeichen
}
// Uhrzeit in einer IANA-Zeitzone (24h, lokalisiert), standardmäßig "jetzt",
// optional ein konkreter Zeitpunkt (z. B. der savedAt des letzten Stands).
// Wie bei der UV-Tageslicht-Prüfung über Intl statt manueller Offsets — deckt
// halbe und viertel Stunden (Indien, Nepal) und Sommerzeit ab. null wenn
// timezone fehlt (alte Forecast-Caches; Intl fiele sonst STILL auf die
// Nutzer-Zeitzone zurück) oder ungültig ist.
export function formatTimeInZone(timezone: unknown, locale = "de-DE", at: Date = new Date()): string | null {
  if (typeof timezone !== "string" || timezone === "") return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return null;
  }
}
// Wie formatTimeInZone, aber datumsbewusst: liegt der Zeitpunkt NICHT am selben
// Kalendertag (in der Ortszeit) wie jetzt, wird das Datum vorangestellt
// ("22.06. 14:30" bzw. englisch "Jun 22 14:30"), damit ein alter Stand als alt
// erkennbar ist. Am selben Ortstag nur die Uhrzeit (wie bisher). "heute" wird
// also in der Zeitzone des angezeigten Orts bestimmt, nicht in Gerätezeit.
// null ohne gültige timezone (alte Caches) — Aufrufer fällt dann auf formatHour.
export function formatStampInZone(
  timezone: unknown,
  locale = "de-DE",
  at: Date = new Date(),
  now: Date = new Date(),
): string | null {
  if (typeof timezone !== "string" || timezone === "") return null;
  try {
    const dayKey = (d: Date): string =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
    if (dayKey(at) === dayKey(now)) return time;
    const date = new Intl.DateTimeFormat(locale.startsWith("en") ? "en-US" : locale, {
      timeZone: timezone,
      day: locale.startsWith("en") ? "numeric" : "2-digit",
      month: locale.startsWith("en") ? "short" : "2-digit",
    }).format(at);
    return `${date} ${time}`;
  } catch {
    return null;
  }
}
export function formatDayMonth(iso: string, locale = "de-DE"): string {
  const d = utcCalendarDate(iso);
  if (locale.startsWith("en")) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
