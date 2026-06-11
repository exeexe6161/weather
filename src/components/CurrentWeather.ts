import { GEO_PLACE_ID, type Place } from "../lib/geocoding";
import type { Forecast } from "../lib/weather";
import { uvHintKey } from "../lib/uv";
import { pickIcon } from "../lib/wmo";
import { getWmo } from "../lib/wmo";
import { weatherLabel } from "../i18n/weather-labels";
import { formatTemp, formatWind, formatHour, formatPercent, formatTimeInZone } from "../lib/format";
import { t, getLang, getLocale } from "../i18n/ui";
import { esc } from "../dom";

export interface CurrentWeatherProps {
  place: Place;
  forecast: Forecast;
  isFav: boolean;
  fromCache: boolean;
  updatedAt: string; // ISO Zeitpunkt des letzten erfolgreichen Abrufs
}

// Ticker für die lokale Ortszeit neben dem Ortsnamen. Modulweit genau einer:
// jedes Re-Render (Stadtwechsel, Sprachwechsel, Favoriten-Toggle) stoppt den
// alten Timer, bevor ein neuer startet — kein Leak.
let localTimeTimer: ReturnType<typeof setTimeout> | undefined;

function stopLocalTimeTicker(): void {
  if (localTimeTimer !== undefined) {
    clearTimeout(localTimeTimer);
    localTimeTimer = undefined;
  }
}

// Aktualisiert den Zeit-Span immer kurz NACH dem echten Minutenwechsel (statt
// eines starren 60s-Intervalls, das bis zu 59s hinterherhinken würde). Die
// Zeit wird je Tick frisch aus der echten Uhrzeit berechnet, nie aufaddiert.
function startLocalTimeTicker(span: HTMLElement, timezone: unknown, locale: string): void {
  const tick = (): void => {
    const msToNextMinute = 60_000 - (Date.now() % 60_000) + 250;
    localTimeTimer = setTimeout(() => {
      const text = formatTimeInZone(timezone, locale);
      // Span nicht mehr im DOM (inzwischen neu gerendert) → Kette beenden
      if (text === null || !span.isConnected) return;
      span.textContent = text;
      tick();
    }, msToNextMinute);
  };
  tick();
}

// Liegt die aktuelle Zeit zwischen Sonnenaufgang und Sonnenuntergang?
// sunrise/sunset sind ISO-Strings in Stationszeit; "jetzt" muss daher ebenfalls
// in Stationszeit vorliegen (Intl mit forecast.timezone), nicht in Nutzerzeit —
// sonst stimmt der Vergleich bei entfernten Städten nicht. sv-SE formatiert als
// YYYY-MM-DD HH:mm und ist nach dem Tausch des Trenners lexikalisch vergleichbar.
// Alte Forecast-Caches ohne timezone fallen auf das is_day Flag zurück.
function isDaytimeNow(sunrise: string, sunset: string, timezone: unknown, fallbackIsDay: boolean): boolean {
  // Expliziter Check: Intl fiele bei undefined STILL auf die Nutzer-Zeitzone
  // zurück statt zu werfen — der catch-Fallback griffe sonst nie.
  if (typeof timezone !== "string" || timezone === "") return fallbackIsDay;
  try {
    const now = new Intl.DateTimeFormat("sv-SE", {
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
    return now >= sunrise && now <= sunset;
  } catch {
    return fallbackIsDay;
  }
}

export function renderCurrentWeather(el: HTMLElement, props: CurrentWeatherProps): void {
  stopLocalTimeTicker();
  const { place, forecast, isFav, fromCache, updatedAt } = props;
  const c = forecast.current;
  const icon = pickIcon(c.weatherCode, c.isDay);
  const label = weatherLabel(getWmo(c.weatherCode).labelKey, getLang());
  const region = [place.admin1, place.country].filter(Boolean).join(", ");

  // Heutiger Daily Eintrag; typeof Checks fangen Forecast Caches aus
  // localStorage ab, die die Felder noch nicht kennen (dann einzeln ausblenden)
  const today = forecast.daily[0];
  const rainProb = typeof today?.precipitationProbabilityMax === "number" ? today.precipitationProbabilityMax : null;
  const sunrise = typeof today?.sunrise === "string" ? today.sunrise : null;
  const sunset = typeof today?.sunset === "string" ? today.sunset : null;
  const uvRounded = typeof today?.uvIndexMax === "number" ? Math.round(today.uvIndexMax) : null;
  const uvKey = uvRounded !== null ? uvHintKey(uvRounded) : null;
  // uv_index_max ist der Tagesspitzenwert, nicht der Wert jetzt: nachts wäre
  // eine Warnung vor der Mittagssonne sinnlos. Daher nur tagsüber zeigen
  // (zusätzlich zur Schwelle in uvHintKey).
  const showUv =
    uvKey !== null &&
    sunrise !== null &&
    sunset !== null &&
    isDaytimeNow(sunrise, sunset, forecast.timezone, c.isDay);
  const locale = getLocale();
  // Lokale Ortszeit; null ohne timezone (alte Caches) → Zeile entfällt einfach
  const localTime = formatTimeInZone(forecast.timezone, locale);

  el.innerHTML = `
    <div class="cw-head">
      <div class="cw-place">
        <div class="cw-place-name">${esc(place.name)}</div>
        ${region || localTime ? `<div class="cw-place-region">${esc(region)}${region && localTime ? " · " : ""}${localTime ? `<span class="cw-local-time">${localTime}</span>` : ""}</div>` : ""}
      </div>
      ${place.id !== GEO_PLACE_ID ? `<button type="button" class="fav-toggle" id="favToggle"
        aria-pressed="${isFav}"
        aria-label="${isFav ? t("favRemove") : t("favAdd")}">
        <i data-lucide="star" class="fav-toggle-ico${isFav ? " fav-toggle-ico--on" : ""}"></i>
      </button>` : ""}
    </div>
    <div class="cw-main">
      <i data-lucide="${icon}" class="cw-ico"></i>
      <div class="cw-temp">${formatTemp(c.temperature)}</div>
    </div>
    <div class="cw-label">${esc(label)}</div>
    <ul class="cw-meta" aria-label="${esc(label)}">
      <li class="cw-meta-item">
        <i data-lucide="thermometer" class="cw-meta-ico"></i>
        <span class="cw-meta-lbl">${t("feelsLike")}</span>
        <span class="cw-meta-val">${formatTemp(c.apparentTemperature)}</span>
      </li>
      <li class="cw-meta-item">
        <i data-lucide="droplets" class="cw-meta-ico"></i>
        <span class="cw-meta-lbl">${t("humidity")}</span>
        <span class="cw-meta-val">${formatPercent(c.humidity)}</span>
      </li>
      <li class="cw-meta-item">
        <i data-lucide="wind" class="cw-meta-ico"></i>
        <span class="cw-meta-lbl">${t("wind")}</span>
        <span class="cw-meta-val">${formatWind(c.windSpeed)}</span>
      </li>
      ${rainProb !== null ? `<li class="cw-meta-item">
        <i data-lucide="cloud-rain" class="cw-meta-ico"></i>
        <span class="cw-meta-lbl">${t("metric_rain_today")}</span>
        <span class="cw-meta-val">${formatPercent(rainProb)}</span>
      </li>` : ""}
    </ul>
    ${sunrise || sunset || showUv ? `<div class="wp-riss-divider" aria-hidden="true"></div>
    <div class="cw-sun">
      ${sunrise ? `<div class="cw-sun-item">
        <i data-lucide="sunrise" class="cw-sun-ico"></i>
        <span class="cw-sun-lbl">${t("sun_rise")}</span>
        <span class="cw-sun-val">${formatHour(sunrise, locale)}</span>
      </div>` : ""}
      ${sunset ? `<div class="cw-sun-item">
        <i data-lucide="sunset" class="cw-sun-ico"></i>
        <span class="cw-sun-lbl">${t("sun_set")}</span>
        <span class="cw-sun-val">${formatHour(sunset, locale)}</span>
      </div>` : ""}
      ${showUv ? `<div class="cw-sun-item">
        <i data-lucide="sun" class="cw-sun-ico"></i>
        <span class="cw-sun-lbl">${t("uv_label")}</span>
        <span class="cw-sun-val">${uvRounded}</span>
        <span class="cw-uv-hint">${esc(t(uvKey!))}</span>
      </div>` : ""}
    </div>` : ""}
    ${fromCache ? `<div class="cw-offline" role="status">${t("offlineNote")} ${t("updatedAt")}: ${formatHour(updatedAt, locale)}</div>` : ""}
  `;

  const timeSpan = el.querySelector<HTMLElement>(".cw-local-time");
  if (timeSpan) startLocalTimeTicker(timeSpan, forecast.timezone, locale);
}
