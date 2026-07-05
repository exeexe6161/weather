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

// Delegierter Klick-Listener für das Auf- und Zuklappen, genau EINMAL pro
// Container gebunden (der Container #weatherAlerts ist statisch und überlebt
// jeden innerHTML-Neuaufbau, der Listener bleibt also gültig). Kein natives
// <details>, daher volle Kontrolle über den Startzustand (immer geschlossen).
const boundAlertContainers = new WeakSet<HTMLElement>();
function bindAlertMore(el: HTMLElement): void {
  if (boundAlertContainers.has(el)) return;
  boundAlertContainers.add(el);
  el.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>(".alert-more-toggle") : null;
    if (!btn || !el.contains(btn)) return;
    const body = btn.nextElementSibling;
    if (!(body instanceof HTMLElement) || !body.classList.contains("alert-more-body")) return;
    const willOpen = body.hidden; // aktuell versteckt → jetzt öffnen
    body.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
    const label = willOpen ? btn.dataset.hide : btn.dataset.show;
    if (label) btn.textContent = label;
  });
}

export function renderWeatherAlerts(el: HTMLElement, heading: HTMLElement, alerts: WeatherAlert[] | undefined, timezone: string): void {
  bindAlertMore(el); // einmalig; delegiert das Auf- und Zuklappen
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
    // Originalmeldung und Hinweis stehen IMMER zugeklappt: eigener Button plus
    // verstecktes Body-div statt nativem <details>. Grund: Safari/WebKit bricht
    // das native <details> Umschalten, sobald das <summary> ein display wie
    // inline-flex bekommt (Panel erschien dauerhaft offen). Der Button startet
    // mit aria-expanded="false" und Label "Details anzeigen"; erst ein Klick
    // (toggleAlertMore) öffnet. Nur wenn wirklich Text da ist, gibt es den
    // Aufklappbereich (kein leerer Block).
    const desc = typeof alert.desc === "string" ? alert.desc.trim() : "";
    const instruction = typeof alert.instruction === "string" ? alert.instruction.trim() : "";
    const more = desc || instruction ? `<div class="alert-more">
      <button type="button" class="alert-more-toggle" aria-expanded="false" data-show="${esc(t("alert_details"))}" data-hide="${esc(t("alert_details_hide"))}">${esc(t("alert_details"))}</button>
      <div class="alert-more-body" hidden>
        ${moreBlock("alert_desc", desc)}
        ${moreBlock("alert_instruction", instruction)}
      </div>
    </div>` : "";
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
