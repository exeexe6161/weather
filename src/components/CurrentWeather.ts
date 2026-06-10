import type { Place } from "../lib/geocoding";
import type { Forecast } from "../lib/weather";
import { pickIcon } from "../lib/wmo";
import { getWmo } from "../lib/wmo";
import { weatherLabel } from "../i18n/weather-labels";
import { formatTemp, formatWind, formatHour } from "../lib/format";
import { t, getLang, getLocale } from "../i18n/ui";
import { esc } from "../dom";

export interface CurrentWeatherProps {
  place: Place;
  forecast: Forecast;
  isFav: boolean;
  fromCache: boolean;
  updatedAt: string; // ISO Zeitpunkt des letzten erfolgreichen Abrufs
}

export function renderCurrentWeather(el: HTMLElement, props: CurrentWeatherProps): void {
  const { place, forecast, isFav, fromCache, updatedAt } = props;
  const c = forecast.current;
  const icon = pickIcon(c.weatherCode, c.isDay);
  const label = weatherLabel(getWmo(c.weatherCode).labelKey, getLang());
  const region = [place.admin1, place.country].filter(Boolean).join(", ");

  el.innerHTML = `
    <div class="cw-head">
      <div class="cw-place">
        <div class="cw-place-name">${esc(place.name)}</div>
        ${region ? `<div class="cw-place-region">${esc(region)}</div>` : ""}
      </div>
      <button type="button" class="fav-toggle" id="favToggle"
        aria-pressed="${isFav}"
        aria-label="${isFav ? t("favRemove") : t("favAdd")}">
        <i data-lucide="star" class="fav-toggle-ico${isFav ? " fav-toggle-ico--on" : ""}"></i>
      </button>
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
        <span class="cw-meta-val">${Math.round(c.humidity)} %</span>
      </li>
      <li class="cw-meta-item">
        <i data-lucide="wind" class="cw-meta-ico"></i>
        <span class="cw-meta-lbl">${t("wind")}</span>
        <span class="cw-meta-val">${formatWind(c.windSpeed)}</span>
      </li>
    </ul>
    ${fromCache ? `<div class="cw-offline" role="status">${t("offlineNote")} ${t("updatedAt")}: ${formatHour(updatedAt, getLocale())}</div>` : ""}
  `;
}
