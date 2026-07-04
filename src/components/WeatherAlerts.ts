import type { WeatherAlert } from "../lib/weather";
import { getLocale, t } from "../i18n/ui";
import { esc } from "../dom";

function expiry(value: string | null, timezone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  } catch {
    return null;
  }
}

export function renderWeatherAlerts(el: HTMLElement, heading: HTMLElement, alerts: WeatherAlert[] | undefined, timezone: string): void {
  const visible = Array.isArray(alerts) ? alerts.slice(0, 3) : [];
  const show = visible.length > 0;
  heading.hidden = !show;
  el.hidden = !show;
  if (!show) {
    el.replaceChildren();
    return;
  }
  el.innerHTML = visible.map((alert) => {
    const until = expiry(alert.expires, timezone);
    const title = alert.event || alert.headline;
    const detail = alert.headline && alert.headline !== title ? alert.headline : null;
    return `<div class="alert-row">
      <i data-lucide="triangle-alert" class="alert-ico"></i>
      <div class="alert-copy"><strong>${esc(title)}</strong>${detail ? `<span>${esc(detail)}</span>` : ""}${until ? `<span>${esc(t("alert_until").replace("{time}", until))}</span>` : ""}</div>
    </div>`;
  }).join("") + `<p class="alert-note">${esc(t("alert_note"))}</p>`;
}
