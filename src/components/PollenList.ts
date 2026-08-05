import { POLLEN_KINDS, countPollen, stageFor, type PollenResult } from "../lib/pollen";
import { pollenSectionState } from "../lib/sectionState";
import { t } from "../i18n/ui";
import { esc } from "../dom";

// Zeigt die Arten mit aktueller Belastung über der untersten Schwelle.
//
// Früher verschwanden Überschrift und Karte in JEDEM anderen Fall, also auch
// dann, wenn der Abruf gescheitert war oder für den Ort keine Werte vorliegen.
// Der Nutzer konnte Entwarnung, Datenlücke und Fehlschlag nicht unterscheiden.
// Jetzt entscheidet pollenSectionState anhand des Abrufstatus, und jede Lage
// bekommt eine eigene, belegbare Aussage:
//
//   list          – Liste wie bisher
//   none-notable  – Werte liegen vor, alle unter der Schwelle (echte Entwarnung)
//   unavailable   – Serverantwort ohne verwertbare Werte (nur Verfügbarkeit)
//   failed        – Abruf gescheitert, KEINE Entwarnung
//   hidden        – noch kein Abruf abgeschlossen, keine Aussage
//
// Das role="list" aus dem Markup gilt nur für die echte Liste. In den
// Textzuständen wird es entfernt, sonst stünde ein Absatz ohne role="listitem"
// als Kind einer Liste im Accessibility Tree.
export function renderPollenList(el: HTMLElement, heading: HTMLElement, result: PollenResult): void {
  const counts = result.status === "ok" ? countPollen(result.levels) : { measured: 0, notable: 0 };
  const section = pollenSectionState(result.status, counts.measured, counts.notable);

  heading.hidden = section === "hidden";
  el.hidden = section === "hidden";

  // Liste nur, wenn wirklich Werte vorliegen. Die zweite Bedingung ist für den
  // Typprüfer und kann zur Laufzeit nicht anders ausgehen: "list" entsteht in
  // pollenSectionState ausschließlich aus dem Status "ok".
  if (section === "list" && result.status === "ok") {
    const levels = result.levels;
    el.setAttribute("role", "list");
    el.innerHTML = POLLEN_KINDS
      .flatMap((kind) => {
        const stage = stageFor(kind, levels[kind]);
        if (stage === null) return [];
        return [`<div class="pollen-row" role="listitem">
        <span class="pollen-name">${esc(t(`pollen_${kind}`))}</span>
        <span class="pollen-stage pollen-stage--${stage.slice("pollen_".length)}">${esc(t(stage))}</span>
      </div>`];
      })
      .join("");
    return;
  }

  el.removeAttribute("role");

  if (section === "hidden") {
    el.replaceChildren();
    return;
  }

  const key =
    section === "none-notable" ? "pollen_none_notable"
    : section === "unavailable" ? "pollen_unavailable"
    : "pollen_failed";
  el.innerHTML = `<p class="section-empty">${esc(t(key))}</p>`;
}
