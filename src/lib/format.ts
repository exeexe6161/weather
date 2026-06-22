export function formatHour(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
export function formatWeekday(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: "short" });
}
// Voller Wochentagsname für Prosa ("Mittwoch" statt "Mi."); dieselbe Intl-Quelle
// wie formatWeekday, daher konsistent mit den Kürzeln der Tagesliste.
export function formatWeekdayLong(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: "long" });
}
export function formatTemp(value: number): string {
  return `${Math.round(value)}°`;
}
export function formatWind(value: number): string {
  return `${Math.round(value)} km/h`;
}
export function formatPercent(value: number): string {
  return `${Math.round(value)}\u202F%`; // schmales geschütztes Leerzeichen
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
export function formatDayMonth(iso: string, locale = "de-DE"): string {
  const d = new Date(iso);
  if (locale.startsWith("en")) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}
