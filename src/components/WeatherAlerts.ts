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

// Urgency ruhig abgebildet: nur die drei aussagekräftigen Stufen. "Past",
// "Unknown", fehlend oder alte Caches liefern null, dann wird keine Zeile
// gezeigt (kein leerer oder verwirrender Hinweis).
type UrgencyKey = "immediate" | "expected" | "future";
const URGENCY_KEYS: UrgencyKey[] = ["immediate", "expected", "future"];
function urgencyKey(value: string | null | undefined): UrgencyKey | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (URGENCY_KEYS as string[]).includes(normalized) ? (normalized as UrgencyKey) : null;
}

// Formatiert eine ISO Zeit (effective/expires) in Stationszeit. null bei
// fehlendem oder ungültigem Wert (alte Caches, API-Lücke) → Zeile entfällt.
function formatAlertTime(value: string | null | undefined, timezone: string): string | null {
  if (typeof value !== "string" || value === "") return null;
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
    const from = formatAlertTime(alert.effective, timezone);
    const until = formatAlertTime(alert.expires, timezone);
    const title = alert.event || alert.headline;
    const detail = alert.headline && alert.headline !== title ? alert.headline : null;
    const severity = severityKey(alert.severity);
    const urgency = urgencyKey(alert.urgency);
    // Severe/Extreme wirken klarer als ein normaler Hinweis: rotes statt
    // orangefarbenes Symbol, zusätzlich die ausgeschriebene Stufe als Badge.
    const critical = severity === "severe" || severity === "extreme";
    const badge = severity ? `<span class="alert-badge alert-badge--${severity}">${esc(t(`severity_${severity}`))}</span>` : "";
    // Beschreibung und Handlungshinweis nur, wenn wirklich Text da ist. Fehlt
    // beides, gibt es gar kein details-Element (kein leerer Aufklappbereich).
    const desc = typeof alert.desc === "string" ? alert.desc.trim() : "";
    const instruction = typeof alert.instruction === "string" ? alert.instruction.trim() : "";
    const more = desc || instruction ? `<details class="alert-more">
      <summary class="alert-more-summary">${esc(t("alert_details"))}</summary>
      ${desc ? `<p class="alert-more-desc">${esc(desc)}</p>` : ""}
      ${instruction ? `<p class="alert-more-instruction"><strong>${esc(t("alert_instruction"))}</strong> ${esc(instruction)}</p>` : ""}
    </details>` : "";
    return `<div class="alert-row">
      <i data-lucide="triangle-alert" class="alert-ico${critical ? " alert-ico--critical" : ""}"></i>
      <div class="alert-copy">
        <div class="alert-title-row"><strong>${esc(title)}</strong>${badge}</div>
        ${detail ? `<span>${esc(detail)}</span>` : ""}
        ${urgency ? `<span class="alert-urgency">${esc(t(`urgency_${urgency}`))}</span>` : ""}
        ${from ? `<span>${esc(t("alert_from").replace("{time}", from))}</span>` : ""}
        ${until ? `<span>${esc(t("alert_until").replace("{time}", until))}</span>` : ""}
        ${more}
      </div>
    </div>`;
  }).join("") + `<p class="alert-note">${esc(t("alert_note"))}</p>`;
}
