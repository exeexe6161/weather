// UV Hinweis: Stufen nach uv_index_max, analog zu clothing.ts nur i18n Keys.
// Unterhalb der Anzeigeschwelle wird gar nichts gezeigt (null).

export type UvHintKey = "uv_high" | "uv_very_high" | "uv_extreme";

// Schwellen zum Kalibrieren; Anzeige erst ab UV_SHOW_THRESHOLD
export const UV_SHOW_THRESHOLD = 6;
export const UV_VERY_HIGH_MIN = 8;
export const UV_EXTREME_MIN = 11;

export function uvHintKey(uvIndexMax: number): UvHintKey | null {
  if (uvIndexMax >= UV_EXTREME_MIN) return "uv_extreme";
  if (uvIndexMax >= UV_VERY_HIGH_MIN) return "uv_very_high";
  if (uvIndexMax >= UV_SHOW_THRESHOLD) return "uv_high";
  return null;
}
