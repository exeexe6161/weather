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

// Von außen aufrufbarer Abschluss der Suche. app.ts nutzt ihn beim Sprachwechsel:
// die Treffer kommen sprachspezifisch vom Server (searchCity mit getLang), eine
// offene Liste wäre nach dem Wechsel inhaltlich veraltet. Schließen ist dann
// ehrlicher als Nachübersetzen. Wird von initSearchBar gesetzt, vorher No-op.
// initSearchBar läuft genau einmal (app.ts, initApp), daher genügt die einfache
// Modulvariable — bei mehrfacher Initialisierung gewönne der letzte Aufruf.
let closeSearchImpl: (() => void) | null = null;

export function closeSearch(): void {
  closeSearchImpl?.();
}

function preventIosSafariFocusZoom(input: HTMLInputElement): void {
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIos = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const isSafari = /WebKit/.test(nav.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(nav.userAgent);
  const isStandalone = nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (!isIos || !isSafari || isStandalone) return;

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return;
  const original = viewport.content;
  let restoreTimer: number | undefined;

  const lock = (): void => {
    if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    if (!/maximum-scale\s*=/.test(viewport.content)) viewport.content = `${original}, maximum-scale=1`;
  };
  const restore = (): void => {
    restoreTimer = window.setTimeout(() => {
      viewport.content = original;
      restoreTimer = undefined;
    }, 350);
  };

  // touchstart läuft vor Safaris Fokusentscheidung und verhindert dadurch den
  // automatischen Zoom. focus deckt externe Tastaturen und VoiceOver ab.
  input.addEventListener("touchstart", lock, { passive: true, capture: true });
  input.addEventListener("focus", lock);
  input.addEventListener("blur", restore);
}

export function initSearchBar(root: HTMLElement, opts: SearchBarOptions): void {
  const input = root.querySelector<HTMLInputElement>("#citySearch")!;
  const list = root.querySelector<HTMLUListElement>("#searchResults")!;
  const geoBtn = root.querySelector<HTMLButtonElement>("#geoBtn")!;
  const status = root.querySelector<HTMLElement>("#searchStatus")!;
  const clearBtn = root.querySelector<HTMLButtonElement>("#searchClear")!;
  preventIosSafariFocusZoom(input);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastQuery = "";
  // Enter vor Eintreffen der Ergebnisse: die nächste Antwort wählt direkt den
  // ersten Treffer (Tippen-und-Enter-Flow), statt nur die Liste zu zeigen.
  let selectFirstOnResults = false;
  let activeIndex = -1;
  let currentPlaces: Place[] = [];

  function closeList(): void {
    list.hidden = true;
    list.innerHTML = "";
    currentPlaces = [];
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    input.removeAttribute("aria-busy");
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

  // Die Statusregion bleibt dauerhaft im Accessibility Tree — Text in einer
  // versteckten Live-Region zu setzen und sie danach einzublenden wird von
  // Screenreadern uneinheitlich angesagt. Leer nimmt sie über
  // .search-status:empty keinen Platz ein, die Optik bleibt also gleich.
  function showStatus(msg: string): void {
    status.textContent = msg;
  }

  // Wartende Suche abbrechen und lastQuery leeren: sonst würde ein laufender
  // Debounce die Liste gleich wieder öffnen bzw. eine noch fliegende Antwort
  // durchrutschen (runSearch verwirft alles, was nicht mehr lastQuery ist).
  // Der eingegebene Text bleibt stehen, damit weitergetippt werden kann.
  closeSearchImpl = (): void => {
    if (timer) clearTimeout(timer);
    lastQuery = "";
    selectFirstOnResults = false;
    closeList();
    showStatus("");
  };

  function renderResults(places: Place[]): void {
    input.removeAttribute("aria-busy");
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
    currentPlaces = places;
    activeIndex = -1;
    // Trefferzahl melden statt den Status zu leeren: sonst hört ein Screenreader
    // "Suche läuft…" und danach nichts. Genau eine Region, die Zustände Laden,
    // Trefferzahl, keine Treffer und Fehler lösen einander dort ab.
    showStatus(t(places.length === 1 ? "searchResultsOne" : "searchResultsMany").replace("{n}", String(places.length)));
    list.innerHTML = places
      .map((p, i) => {
        const region = [p.admin1, p.country].filter(Boolean).join(", ");
        return `<li role="presentation">
          <button type="button" role="option" id="searchOpt${i}" aria-selected="false" class="search-result" data-idx="${i}" tabindex="-1">
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
      btn.addEventListener("click", () => selectPlace(Number(btn.dataset.idx)));
      btn.addEventListener("pointermove", () => setActive(Number(btn.dataset.idx)));
    });
  }

  function selectPlace(index: number): void {
    const place = currentPlaces[index];
    if (!place) return;
    select(place);
  }

  function setActive(index: number): void {
    const options = Array.from(list.querySelectorAll<HTMLElement>("[role=option]"));
    if (!options.length) return;
    activeIndex = Math.max(0, Math.min(options.length - 1, index));
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === activeIndex)));
    input.setAttribute("aria-activedescendant", options[activeIndex].id);
    options[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function runSearch(query: string): void {
    lastQuery = query;
    input.setAttribute("aria-busy", "true");
    showStatus(t("searchLoading"));
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
    showStatus(t("searchLoading"));
    timer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeList();
      showStatus("");
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !list.hidden) {
      e.preventDefault();
      const next = activeIndex < 0 ? (e.key === "ArrowDown" ? 0 : currentPlaces.length - 1) : activeIndex + (e.key === "ArrowDown" ? 1 : -1);
      setActive(next);
    } else if (e.key === "Enter") {
      // Tippen-und-Enter: sichtbares erstes Ergebnis direkt übernehmen; läuft
      // die Suche noch (Debounce), sofort suchen und die Antwort wählt selbst.
      e.preventDefault();
      if (!list.hidden && currentPlaces.length > 0) {
        selectPlace(activeIndex >= 0 ? activeIndex : 0);
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
