import type { Place } from "../lib/geocoding";
import type { FavWeather } from "../lib/favoritesWeather";
import { pickIcon, getWmo } from "../lib/wmo";
import { weatherLabel } from "../i18n/weather-labels";
import { formatTemp } from "../lib/format";
import { t, getLang } from "../i18n/ui";
import { esc } from "../dom";

export interface FavoritesListOptions {
  onSelect(place: Place): void;
  onRemove(place: Place): void;
}

export function renderFavoritesList(
  el: HTMLElement,
  favorites: Place[],
  activeId: number | null,
  opts: FavoritesListOptions,
  // Gecachtes Favoriten-Wetter, placeId → {temp, code, isDay}. Optional und nur
  // lesend: fehlt der Eintrag (frisch hinzugefügt, noch nicht geladen), bleiben
  // Subline und Werteblock LEER, behalten aber per CSS ihre feste Höhe/Breite —
  // so springt die Zeile beim Nachladen nicht (kein Shimmer, nur reservierter
  // Platz). Wettercode → Zustand-Label wie in CurrentWeather, Code+isDay → Icon
  // über dieselbe pickIcon-Zuordnung wie überall sonst.
  weather: ReadonlyMap<number, FavWeather> = new Map()
): void {
  const section = el.closest("section");
  if (section) (section as HTMLElement).hidden = favorites.length === 0;
  const lang = getLang();
  el.innerHTML = favorites
    .map((p, i) => {
      const active = p.id === activeId;
      const wx = weather.get(p.id);
      const sub = wx ? esc(weatherLabel(getWmo(wx.code).labelKey, lang)) : "";
      const vals = wx
        ? `<i data-lucide="${pickIcon(wx.code, wx.isDay)}" class="fav-row-wx-ico"></i><span class="fav-row-temp">${esc(formatTemp(wx.temp))}</span>`
        : "";
      return `<li class="fav-row${active ? " fav-row--active" : ""}">
        <button type="button" class="fav-row-select" data-idx="${i}" aria-current="${active}" aria-label="${t("favSelectAria").replace("{place}", esc(p.name))}">
          <span class="fav-row-id">
            <span class="fav-row-name">${esc(p.name)}</span>
            <span class="fav-row-sub">${sub}</span>
          </span>
          <span class="fav-row-vals">${vals}</span>
        </button>
        <button type="button" class="fav-row-x" data-idx="${i}" aria-label="${t("favRemove")}: ${esc(p.name)}">
          <i data-lucide="x" class="fav-row-x-ico"></i>
        </button>
      </li>`;
    })
    .join("");
  el.querySelectorAll<HTMLButtonElement>(".fav-row-select").forEach((btn) => {
    btn.addEventListener("click", () => opts.onSelect(favorites[Number(btn.dataset.idx)]));
  });
  el.querySelectorAll<HTMLButtonElement>(".fav-row-x").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // Entfernen darf die Zeile nicht mit auswählen.
      e.stopPropagation();
      opts.onRemove(favorites[Number(btn.dataset.idx)]);
    });
  });
}
