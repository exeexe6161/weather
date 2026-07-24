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
  onMove(place: Place, dir: "up" | "down"): void;
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
  // Umsortier-Pfeile nur ab zwei Favoriten — bei genau einem gäbe es nichts zu
  // verschieben, dann ist die Zeile ruhiger ohne (deaktivierte) Chevrons.
  const showMove = favorites.length > 1;
  const comparable = favorites.flatMap((place) => {
    const wx = weather.get(place.id);
    return wx ? [{ place, wx }] : [];
  });
  const temperatureSpread = comparable.length > 1
    ? Math.max(...comparable.map((item) => item.wx.temp)) - Math.min(...comparable.map((item) => item.wx.temp))
    : 0;
  const warmest = temperatureSpread >= 0.5 ? comparable.reduce((best, item) => item.wx.temp > best.wx.temp ? item : best) : null;
  const withRain = comparable.filter((item) => typeof item.wx.rainChance === "number");
  const rainSpread = withRain.length > 1
    ? Math.max(...withRain.map((item) => item.wx.rainChance ?? 0)) - Math.min(...withRain.map((item) => item.wx.rainChance ?? 0))
    : 0;
  const driest = rainSpread >= 1 ? withRain.reduce((best, item) => (item.wx.rainChance ?? 101) < (best.wx.rainChance ?? 101) ? item : best) : null;
  const comparison = warmest || driest
    ? `<li class="fav-compare">${warmest ? `<span>${esc(t("favWarmest"))}: <strong>${esc(warmest.place.name)}</strong></span>` : ""}${driest ? `<span>${esc(t("favDriest"))}: <strong>${esc(driest.place.name)}</strong></span>` : ""}</li>`
    : "";
  el.innerHTML = comparison + favorites
    .map((p, i) => {
      const active = p.id === activeId;
      const wx = weather.get(p.id);
      const condition = wx ? weatherLabel(getWmo(wx.code).labelKey, lang) : "";
      const rain = wx && typeof wx.rainChance === "number" ? `${Math.round(wx.rainChance)} %` : "";
      const sub = wx ? esc([condition, rain ? `${rain} ${t("favRain")}` : ""].filter(Boolean).join(" · ")) : "";
      const vals = wx
        ? `${wx.hasAlert ? `<i data-lucide="triangle-alert" class="fav-row-alert" aria-hidden="true"></i>` : ""}<i data-lucide="${pickIcon(wx.code, wx.isDay)}" class="fav-row-wx-ico"></i><span class="fav-row-temp">${esc(formatTemp(wx.temp))}</span>`
        : "";
      // Pfeil hoch in der ersten, Pfeil runter in der letzten Zeile deaktiviert
      // (echtes disabled → nicht fokussierbar/auslösbar, kein Out-of-bounds).
      const move = showMove
        ? `<span class="fav-row-move">
            <button type="button" class="fav-row-move-btn fav-row-up" data-idx="${i}" data-dir="up"${i === 0 ? " disabled" : ""} aria-label="${t("favMoveUp").replace("{place}", esc(p.name))}">
              <i data-lucide="chevron-up" class="fav-row-move-ico"></i>
            </button>
            <button type="button" class="fav-row-move-btn fav-row-down" data-idx="${i}" data-dir="down"${i === favorites.length - 1 ? " disabled" : ""} aria-label="${t("favMoveDown").replace("{place}", esc(p.name))}">
              <i data-lucide="chevron-down" class="fav-row-move-ico"></i>
            </button>
          </span>`
        : "";
      // data-id: app.ts hebt nach dem Umsortieren die bewegte Zeile darüber hervor.
      return `<li class="fav-row${active ? " fav-row--active" : ""}" data-id="${p.id}">
        <button type="button" class="fav-row-select" data-idx="${i}" aria-current="${active}" aria-label="${t("favSelectAria").replace("{place}", esc(p.name))}${wx?.hasAlert ? `. ${esc(t("favAlert"))}` : ""}">
          <span class="fav-row-id">
            <span class="fav-row-name">${esc(p.name)}</span>
            <span class="fav-row-sub">${sub}</span>
          </span>
          <span class="fav-row-vals">${vals}</span>
        </button>
        ${move}
        <button type="button" class="fav-row-x" data-idx="${i}" aria-label="${t("favRemove")}: ${esc(p.name)}">
          <i data-lucide="x" class="fav-row-x-ico"></i>
        </button>
      </li>`;
    })
    .join("");
  el.querySelectorAll<HTMLButtonElement>(".fav-row-select").forEach((btn) => {
    btn.addEventListener("click", () => opts.onSelect(favorites[Number(btn.dataset.idx)]));
  });
  el.querySelectorAll<HTMLButtonElement>(".fav-row-move-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // Verschieben darf die Zeile nicht mit auswählen.
      e.stopPropagation();
      const dir = btn.dataset.dir === "up" ? "up" : "down";
      opts.onMove(favorites[Number(btn.dataset.idx)], dir);
    });
  });
  el.querySelectorAll<HTMLButtonElement>(".fav-row-x").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // Entfernen darf die Zeile nicht mit auswählen.
      e.stopPropagation();
      opts.onRemove(favorites[Number(btn.dataset.idx)]);
    });
  });
}
