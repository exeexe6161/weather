import type { Place } from "../lib/geocoding";
import type { FavWeather } from "../lib/favoritesWeather";
import { pickIcon } from "../lib/wmo";
import { formatTemp } from "../lib/format";
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
  opts: FavoritesListOptions,
  // Gecachtes Favoriten-Wetter, placeId → {temp, code}. Optional und nur lesend:
  // fehlt die Map oder ein Eintrag, rendert der Chip wie bisher nur den Namen
  // (kein Platzhalter, kein leeres Grad-Zeichen). Wettercode → Icon über dieselbe
  // pickIcon-Zuordnung wie überall sonst, mit der echten Tag-/Nacht-Variante aus
  // wx.isDay (alte Cache-Einträge ohne Feld fallen auf Tag zurück).
  weather: ReadonlyMap<number, FavWeather> = new Map()
): void {
  const section = el.closest("section");
  if (section) (section as HTMLElement).hidden = favorites.length === 0;
  el.innerHTML = favorites
    .map((p, i) => {
      const wx = weather.get(p.id);
      const wxHtml = wx
        ? `<i data-lucide="${pickIcon(wx.code, wx.isDay)}" class="fav-chip-wx-ico"></i><span class="fav-chip-temp">${esc(formatTemp(wx.temp))}</span>`
        : "";
      return `<li class="fav-chip${p.id === activeId ? " fav-chip--active" : ""}">
        <button type="button" class="fav-chip-btn" data-idx="${i}" aria-current="${p.id === activeId}"><i data-lucide="map-pin" class="fav-chip-ico"></i><span class="fav-chip-name">${esc(p.name)}</span>${wxHtml}</button>
        <button type="button" class="fav-chip-x" data-idx="${i}" aria-label="${t("favRemove")}: ${esc(p.name)}">
          <i data-lucide="x" class="fav-chip-x-ico"></i>
        </button>
      </li>`;
    })
    .join("");
  el.querySelectorAll<HTMLButtonElement>(".fav-chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => opts.onSelect(favorites[Number(btn.dataset.idx)]));
  });
  el.querySelectorAll<HTMLButtonElement>(".fav-chip-x").forEach((btn) => {
    btn.addEventListener("click", () => opts.onRemove(favorites[Number(btn.dataset.idx)]));
  });
}
