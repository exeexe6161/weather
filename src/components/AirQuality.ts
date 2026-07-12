import type { AirQuality } from "../lib/weather";
import { aqiHintKey } from "../lib/airQuality";
import { getLocale, t } from "../i18n/ui";
import { esc } from "../dom";

const LEVEL_KEYS = ["aqi_good", "aqi_moderate", "aqi_sensitive", "aqi_unhealthy", "aqi_very_unhealthy", "aqi_hazardous"];

function concentration(value: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value)} µg/m³`;
}

// Delegierter Klick-Listener für den Messwerte-Toggle, genau EINMAL pro Container
// gebunden (der Container ist statisch und überlebt jeden innerHTML-Neuaufbau).
// Gleiches Muster wie WeatherAlerts: kein natives <details> (Safari/WebKit bricht
// das Umschalten bei inline-flex summary), stattdessen Button plus verstecktes
// Body-div mit voller Kontrolle über den Startzustand (immer geschlossen).
const boundContainers = new WeakSet<HTMLElement>();
function bindDetails(el: HTMLElement): void {
  if (boundContainers.has(el)) return;
  boundContainers.add(el);
  el.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>(".alert-more-toggle") : null;
    if (!btn || !el.contains(btn)) return;
    const body = btn.nextElementSibling;
    if (!(body instanceof HTMLElement) || !body.classList.contains("aqi-details-body")) return;
    const willOpen = body.hidden;
    body.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
    const label = willOpen ? btn.dataset.hide : btn.dataset.show;
    if (label) btn.textContent = label;
  });
}

export function renderAirQuality(el: HTMLElement, heading: HTMLElement, data: AirQuality | null | undefined): void {
  bindDetails(el); // einmalig; delegiert das Auf- und Zuklappen der Messwerte
  const index = typeof data?.usEpaIndex === "number" && data.usEpaIndex >= 1 && data.usEpaIndex <= 6
    ? Math.round(data.usEpaIndex)
    : null;
  // Ruhiger Untertext: ab usEpaIndex 3 der Handlungshinweis (aqiHintKey), bei
  // guter oder mäßiger Luft (1 bis 2) ein neutraler Hinweis. Keine Gesundheits-
  // versprechen. Ohne gültigen Index kein Untertext.
  const hintKey = index !== null ? aqiHintKey(index) : null;
  const subtextKey = hintKey ?? (index !== null ? "aqi_calm" : null);
  // Technische Messwerte, nur die vom Provider gelieferten Konzentrationen.
  // Fehlende Werte werden ausgeblendet, nichts erfunden, keine Umrechnung.
  const pm25 = concentration(data?.pm25 ?? null);
  const pm10 = concentration(data?.pm10 ?? null);
  const ozone = concentration(data?.ozone ?? null);
  const nitrogenDioxide = concentration(data?.nitrogenDioxide ?? null);
  const sulphurDioxide = concentration(data?.sulphurDioxide ?? null);
  const carbonMonoxide = concentration(data?.carbonMonoxide ?? null);
  const hasDetails = [pm25, pm10, ozone, nitrogenDioxide, sulphurDioxide, carbonMonoxide].some(Boolean);
  const show = index !== null || hasDetails;
  heading.hidden = !show;
  el.hidden = !show;
  if (!show) {
    el.replaceChildren();
    return;
  }
  // Standardzustand: Titel (heading), Stufe, Label und ruhiger Untertext. Die
  // technischen Messwerte liegen zugeklappt hinter "Details anzeigen".
  el.innerHTML = `
    ${index !== null ? `<div class="environment-lead"><i data-lucide="wind" class="environment-ico"></i><div><span class="environment-label">${t("aqi_index")}</span><strong class="environment-value">${esc(t(LEVEL_KEYS[index - 1]))}</strong>${subtextKey ? `<span class="cw-uv-hint">${esc(t(subtextKey))}</span>` : ""}</div></div>` : ""}
    ${hasDetails ? `<button type="button" class="alert-more-toggle" aria-expanded="false" data-show="${esc(t("aqi_details_show"))}" data-hide="${esc(t("aqi_details_hide"))}">${esc(t("aqi_details_show"))}</button>
    <div class="aqi-details-body" hidden>
      <span class="environment-label">${t("aqi_measurements")}</span>
      <div class="environment-grid">
        ${pm25 ? `<div><span class="environment-label">${t("aqi_pm25")}</span><strong class="environment-value">${esc(pm25)}</strong></div>` : ""}
        ${pm10 ? `<div><span class="environment-label">${t("aqi_pm10")}</span><strong class="environment-value">${esc(pm10)}</strong></div>` : ""}
        ${ozone ? `<div><span class="environment-label">${t("aqi_o3")}</span><strong class="environment-value">${esc(ozone)}</strong></div>` : ""}
        ${nitrogenDioxide ? `<div><span class="environment-label">${t("aqi_no2")}</span><strong class="environment-value">${esc(nitrogenDioxide)}</strong></div>` : ""}
        ${sulphurDioxide ? `<div><span class="environment-label">${t("aqi_so2")}</span><strong class="environment-value">${esc(sulphurDioxide)}</strong></div>` : ""}
        ${carbonMonoxide ? `<div><span class="environment-label">${t("aqi_co")}</span><strong class="environment-value">${esc(carbonMonoxide)}</strong></div>` : ""}
      </div>
    </div>` : ""}`;
}
