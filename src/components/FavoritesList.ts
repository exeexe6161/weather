import type { Place } from "../lib/geocoding";
import { t } from "../i18n/ui";
import { esc } from "../dom";

export interface FavoritesListOptions {
  onSelect(place: Place): void;
  onRemove(place: Place): void;
}

export function renderFavoritesList(
  el: HTMLElement,
  favorites: Place[],
  activeId: number | null,
  opts: FavoritesListOptions
): void {
  const section = el.closest("section");
  if (section) (section as HTMLElement).hidden = favorites.length === 0;
  el.innerHTML = favorites
    .map(
      (p, i) => `<li class="fav-chip${p.id === activeId ? " fav-chip--active" : ""}">
        <button type="button" class="fav-chip-btn" data-idx="${i}" aria-current="${p.id === activeId}"><i data-lucide="map-pin" class="fav-chip-ico"></i>${esc(p.name)}</button>
        <button type="button" class="fav-chip-x" data-idx="${i}" aria-label="${t("favRemove")}: ${esc(p.name)}">
          <i data-lucide="x" class="fav-chip-x-ico"></i>
        </button>
      </li>`
    )
    .join("");
  el.querySelectorAll<HTMLButtonElement>(".fav-chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => opts.onSelect(favorites[Number(btn.dataset.idx)]));
  });
  el.querySelectorAll<HTMLButtonElement>(".fav-chip-x").forEach((btn) => {
    btn.addEventListener("click", () => opts.onRemove(favorites[Number(btn.dataset.idx)]));
  });
}
