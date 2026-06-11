import { POLLEN_KINDS, stageFor, type PollenLevels } from "../lib/pollen";
import { t } from "../i18n/ui";

// Zeigt nur Arten mit aktueller Belastung über der untersten Schwelle. Ohne
// relevante Art (Winter, außerhalb Europas, API Ausfall) verschwinden
// Überschrift und Karte komplett — kein leerer Kasten, keine Fehlermeldung.
export function renderPollenList(el: HTMLElement, heading: HTMLElement, levels: PollenLevels | null): void {
  const rows = levels
    ? POLLEN_KINDS.map((kind) => ({ kind, stage: stageFor(kind, levels[kind]) })).filter(
        (row): row is { kind: (typeof POLLEN_KINDS)[number]; stage: NonNullable<ReturnType<typeof stageFor>> } =>
          row.stage !== null
      )
    : [];
  const show = rows.length > 0;
  heading.hidden = !show;
  el.hidden = !show;
  el.innerHTML = rows
    .map(
      ({ kind, stage }) => `<div class="pollen-row" role="listitem">
        <span class="pollen-name">${t(`pollen_${kind}`)}</span>
        <span class="pollen-stage pollen-stage--${stage.slice("pollen_".length)}">${t(stage)}</span>
      </div>`
    )
    .join("");
}
