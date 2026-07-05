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

// Ausklappblock für Originalmeldung bzw. Hinweis: eigenes Label plus Text, nur
// wenn wirklich Text vorhanden ist (kein leerer Block).
function moreBlock(labelKey: string, text: string): string {
  if (!text) return "";
  return `<div class="alert-more-block"><span class="alert-more-lbl">${esc(t(labelKey))}</span><p class="alert-more-desc">${esc(text)}</p></div>`;
}

// Maximal drei Warnungen zeigen; die eigentliche Ortsfilterung passiert schon im
// Provider (WeatherApiProvider.weatherAlerts). Sind nach der Filterung mehr als
// drei relevant, folgt ein ruhiger Sammelhinweis statt eines langen Blocks.
const MAX_VISIBLE = 3;

export function renderWeatherAlerts(el: HTMLElement, heading: HTMLElement, alerts: WeatherAlert[] | undefined, timezone: string): void {
  const all = Array.isArray(alerts) ? alerts : [];
  const visible = all.slice(0, MAX_VISIBLE);
  const show = visible.length > 0;
  heading.hidden = !show;
  el.hidden = !show;
  if (!show) {
    el.replaceChildren();
    return;
  }
  const rows = visible.map((alert) => {
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
    // Originalmeldung und Hinweis stehen IMMER zugeklappt (kein open-Attribut).
    // Nur wenn wirklich Text da ist, gibt es das details-Element (kein leerer
    // Aufklappbereich). Das Summary-Label wechselt rein per CSS über [open].
    const desc = typeof alert.desc === "string" ? alert.desc.trim() : "";
    const instruction = typeof alert.instruction === "string" ? alert.instruction.trim() : "";
    const more = desc || instruction ? `<details class="alert-more">
      <summary class="alert-more-summary"><span class="alert-more-show">${esc(t("alert_details"))}</span><span class="alert-more-hide">${esc(t("alert_details_hide"))}</span></summary>
      ${moreBlock("alert_desc", desc)}
      ${moreBlock("alert_instruction", instruction)}
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
  }).join("");
  const moreCount = all.length > visible.length
    ? `<p class="alert-more-count">${esc(t("alert_more_count"))}</p>`
    : "";
  el.innerHTML = rows + moreCount + `<p class="alert-note">${esc(t("alert_note"))}</p>`;
}
