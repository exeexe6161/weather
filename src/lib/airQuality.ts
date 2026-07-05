// Luftqualitaets Hinweis: Stufen nach usEpaIndex (US EPA Skala 1 bis 6), analog
// zu uv.ts nur i18n Keys. Unterhalb der Anzeigeschwelle wird nichts gezeigt
// (null): bei gutem oder maessigem Wert braucht es keinen Handlungshinweis.

export type AqiHintKey = "aqi_hint_sensitive" | "aqi_hint_unhealthy" | "aqi_hint_severe";

// Schwellen auf der US EPA Skala; Hinweis erst ab AQI_SHOW_THRESHOLD.
// 1 Gut und 2 Maessig bleiben ohne Hinweis (nicht ueberladen).
export const AQI_SHOW_THRESHOLD = 3;
export const AQI_UNHEALTHY_MIN = 4;
export const AQI_SEVERE_MIN = 5;

export function aqiHintKey(usEpaIndex: number): AqiHintKey | null {
  if (usEpaIndex >= AQI_SEVERE_MIN) return "aqi_hint_severe";       // 5 sehr ungesund, 6 gefaehrlich
  if (usEpaIndex >= AQI_UNHEALTHY_MIN) return "aqi_hint_unhealthy"; // 4 ungesund
  if (usEpaIndex >= AQI_SHOW_THRESHOLD) return "aqi_hint_sensitive";// 3 empfindliche Gruppen
  return null;
}
