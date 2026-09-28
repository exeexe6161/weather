import type { Forecast } from "./weather";

// Der Kalendertag gehört zum Wetterort, nicht zur Zeitzone des Geräts.
export function localDateAt(timezone: unknown, nowMs: number): string | null {
  if (typeof timezone !== "string" || !timezone || !Number.isFinite(nowMs)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(nowMs));
    const value = (type: string): string | undefined => parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export function isForecastForCurrentLocalDay(forecast: Forecast, nowMs = Date.now()): boolean {
  const date = forecast.daily?.[0]?.date;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date === localDateAt(forecast.timezone, nowMs);
}
