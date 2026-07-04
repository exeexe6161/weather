import type { AirQuality } from "../lib/weather";
import { getLocale, t } from "../i18n/ui";
import { esc } from "../dom";

const LEVEL_KEYS = ["aqi_good", "aqi_moderate", "aqi_sensitive", "aqi_unhealthy", "aqi_very_unhealthy", "aqi_hazardous"];

function concentration(value: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value)} µg/m³`;
}

export function renderAirQuality(el: HTMLElement, heading: HTMLElement, data: AirQuality | null | undefined): void {
  const index = typeof data?.usEpaIndex === "number" && data.usEpaIndex >= 1 && data.usEpaIndex <= 6
    ? Math.round(data.usEpaIndex)
    : null;
  const pm25 = concentration(data?.pm25 ?? null);
  const pm10 = concentration(data?.pm10 ?? null);
  const show = index !== null || pm25 !== null || pm10 !== null;
  heading.hidden = !show;
  el.hidden = !show;
  if (!show) {
    el.replaceChildren();
    return;
  }
  el.innerHTML = `
    ${index !== null ? `<div class="environment-lead"><i data-lucide="wind" class="environment-ico"></i><div><span class="environment-label">${t("aqi_index")}</span><strong class="environment-value">${esc(t(LEVEL_KEYS[index - 1]))}</strong></div></div>` : ""}
    <div class="environment-grid">
      ${pm25 ? `<div><span class="environment-label">PM2.5</span><strong class="environment-value">${esc(pm25)}</strong></div>` : ""}
      ${pm10 ? `<div><span class="environment-label">PM10</span><strong class="environment-value">${esc(pm10)}</strong></div>` : ""}
    </div>`;
}
