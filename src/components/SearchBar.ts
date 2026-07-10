// Suche + Geolocation opt-in. Suche ist Default; die Standortabfrage
// startet ausschließlich nach Klick auf die klar beschriftete Schaltfläche
// (Einwilligung), Koordinaten werden nicht persistiert.
import { searchCity, GEO_PLACE_ID, type Place } from "../lib/geocoding";
import { t, getLang } from "../i18n/ui";
import { esc } from "../dom";
import { renderIcons } from "../icons";

export interface SearchBarOptions {
  onSelect(place: Place): void;
}

const DEBOUNCE_MS = 500;

export function initSearchBar(root: HTMLElement, opts: SearchBarOptions): void {
  const input = root.querySelector<HTMLInputElement>("#citySearch")!;
  const list = root.querySelector<HTMLUListElement>("#searchResults")!;
  const geoBtn = root.querySelector<HTMLButtonElement>("#geoBtn")!;
  const status = root.querySelector<HTMLElement>("#searchStatus")!;
  const clearBtn = root.querySelector<HTMLButtonElement>("#searchClear")!;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastQuery = "";
  // Enter vor Eintreffen der Ergebnisse: die nächste Antwort wählt direkt den
  // ersten Treffer (Tippen-und-Enter-Flow), statt nur die Liste zu zeigen.
  let selectFirstOnResults = false;

  function closeList(): void {
    list.hidden = true;
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
  }

  // Leeren-Knopf nur zeigen, wenn Text im Feld steht ([hidden] sonst).
  function syncClear(): void {
    clearBtn.hidden = input.value === "";
  }

  // Gemeinsamer Abschluss der Auswahl (Klick aufs Ergebnis, Enter):
  // Feld leeren, Tastatur einklappen (blur), Liste zu, Ort melden.
  function select(place: Place): void {
    input.value = "";
    syncClear();
    input.blur();
    closeList();
    opts.onSelect(place);
  }

  function showStatus(msg: string): void {
    status.textContent = msg;
    status.hidden = msg === "";
  }

  function renderResults(places: Place[]): void {
    if (!places.length) {
      selectFirstOnResults = false;
      closeList();
      showStatus(t("searchNoResults"));
      return;
    }
    // Enter war schneller als die Antwort: ersten Treffer direkt übernehmen,
    // keine Liste mehr zeigen.
    if (selectFirstOnResults) {
      selectFirstOnResults = false;
      select(places[0]);
      return;
    }
    showStatus("");
    list.innerHTML = places
      .map((p, i) => {
        const region = [p.admin1, p.country].filter(Boolean).join(", ");
        return `<li role="option" id="searchOpt${i}" aria-selected="false">
          <button type="button" class="search-result" data-idx="${i}">
            <i data-lucide="map-pin" class="search-result-ico"></i>
            <span class="search-result-name">${esc(p.name)}</span>
            <span class="search-result-region">${esc(region)}</span>
          </button>
        </li>`;
      })
      .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderIcons();
    list.querySelectorAll<HTMLButtonElement>(".search-result").forEach((btn) => {
      btn.addEventListener("click", () => select(places[Number(btn.dataset.idx)]));
    });
  }

  function runSearch(query: string): void {
    lastQuery = query;
    searchCity(query, getLang())
      .then((places) => {
        if (query !== lastQuery) return; // veraltete Antwort verwerfen
        renderResults(places);
      })
      .catch(() => {
        if (query !== lastQuery) return;
        closeList();
        showStatus(t("searchError"));
      });
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    syncClear();
    selectFirstOnResults = false; // neues Tippen hebt eine wartende Enter-Wahl auf
    if (timer) clearTimeout(timer);
    if (q.length < 3) {
      lastQuery = "";
      closeList();
      showStatus("");
      return;
    }
    timer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeList();
      showStatus("");
    } else if (e.key === "ArrowDown" && !list.hidden) {
      e.preventDefault();
      list.querySelector<HTMLButtonElement>(".search-result")?.focus();
    } else if (e.key === "Enter") {
      // Tippen-und-Enter: sichtbares erstes Ergebnis direkt übernehmen; läuft
      // die Suche noch (Debounce), sofort suchen und die Antwort wählt selbst.
      e.preventDefault();
      const first = list.querySelector<HTMLButtonElement>(".search-result");
      if (!list.hidden && first) {
        first.click();
        return;
      }
      const q = input.value.trim();
      if (q.length < 3) return;
      if (timer) clearTimeout(timer);
      selectFirstOnResults = true;
      runSearch(q);
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    lastQuery = "";
    selectFirstOnResults = false;
    if (timer) clearTimeout(timer);
    closeList();
    showStatus("");
    syncClear();
    input.focus(); // direkt weitertippen können
  });

  list.addEventListener("keydown", (e) => {
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>(".search-result"));
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" && idx < items.length - 1) {
      e.preventDefault();
      items[idx + 1].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) items[idx - 1].focus();
      else input.focus();
    } else if (e.key === "Escape") {
      closeList();
      input.focus();
    }
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target as Node)) closeList();
  });

  geoBtn.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      showStatus(t("geoUnsupported"));
      return;
    }
    geoBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoBtn.disabled = false;
        showStatus("");
        opts.onSelect({
          id: GEO_PLACE_ID, // nie persistiert: dieselbe Identität, an der alle Geo-Guards hängen
          // Kein eingefrorener String: die Anzeige löst den Namen zur Renderzeit
          // über t("myLocation") auf (CurrentWeather, an GEO_PLACE_ID erkannt).
          // Nur ein neutraler Marker hier, sonst bliebe der Name nach einem
          // Sprachwechsel in der bei der Standortabfrage aktiven Sprache stehen.
          name: "myLocation",
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          country: "",
          countryCode: "",
        });
      },
      (err) => {
        geoBtn.disabled = false;
        showStatus(err.code === err.PERMISSION_DENIED ? t("geoDenied") : t("geoFailed"));
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  });
}
