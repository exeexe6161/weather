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
