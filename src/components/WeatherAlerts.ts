import type { WeatherAlert } from "../lib/weather";
import { getLocale, t } from "../i18n/ui";
import { esc } from "../dom";

type SeverityKey = "minor" | "moderate" | "severe" | "extreme";
const SEVERITY_KEYS: SeverityKey[] = ["minor", "moderate", "severe", "extreme"];

// Roh-Wert der API ("Minor" | "Moderate" | "Severe" | "Extreme" | "Unknown" |
// fehlt) auf eine der vier bekannten Stufen abgebildet. Alles andere (auch
// "Unknown" und alte Caches ohne das Feld) liefert null, die Zeile bleibt dann
// wie bisher ohne Stufenkennzeichnung.
function severityKey(value: string | null | undefined): SeverityKey | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (SEVERITY_KEYS as string[]).includes(normalized) ? (normalized as SeverityKey) : null;
}

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
    const severity = severityKey(alert.severity);
    // Severe/Extreme wirken klarer als ein normaler Hinweis: rotes statt
    // orangefarbenes Symbol, zusätzlich die ausgeschriebene Stufe als Badge.
    const critical = severity === "severe" || severity === "extreme";
    const badge = severity ? `<span class="alert-badge alert-badge--${severity}">${esc(t(`severity_${severity}`))}</span>` : "";
    return `<div class="alert-row">
      <i data-lucide="triangle-alert" class="alert-ico${critical ? " alert-ico--critical" : ""}"></i>
      <div class="alert-copy"><div class="alert-title-row"><strong>${esc(title)}</strong>${badge}</div>${detail ? `<span>${esc(detail)}</span>` : ""}${until ? `<span>${esc(t("alert_until").replace("{time}", until))}</span>` : ""}</div>
    </div>`;
  }).join("") + `<p class="alert-note">${esc(t("alert_note"))}</p>`;
}
