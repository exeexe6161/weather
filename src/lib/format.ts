export function formatHour(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
export function formatWeekday(iso: string, locale = "de-DE"): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: "short" });
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
// Aktuelle Uhrzeit in einer IANA-Zeitzone (24h, lokalisiert). Wie bei der
// UV-Tageslicht-Prüfung über Intl statt manueller Offsets — deckt halbe und
// viertel Stunden (Indien, Nepal) und Sommerzeit ab. null wenn timezone fehlt
// (alte Forecast-Caches; Intl fiele sonst STILL auf die Nutzer-Zeitzone
// zurück) oder ungültig ist.
export function formatTimeInZone(timezone: unknown, locale = "de-DE"): string | null {
  if (typeof timezone !== "string" || timezone === "") return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return null;
  }
}
