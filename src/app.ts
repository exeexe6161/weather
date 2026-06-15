// WeatherApp: hält State (Ort, Forecast) und orchestriert die Komponenten.
// Local first: letzter Ort + letzter Forecast liegen in localStorage, damit
// die App offline mit den zuletzt geladenen Daten startet.
import { GEO_PLACE_ID, searchCity, type Place } from "./lib/geocoding";
import { fetchWeather, type Forecast } from "./lib/weather";
import { fetchPollen, type PollenLevels } from "./lib/pollen";
import { renderPollenList } from "./components/PollenList";
import { getFavorites, isFavorite, addFavorite, removeFavorite, pruneGeoFavorites } from "./lib/favorites";
import { getLang, getLocale, t } from "./i18n/ui";
import { getWmo } from "./lib/wmo";
import { weatherLabelShort } from "./i18n/weather-labels";
import { formatTemp, formatTimeInZone, formatHour } from "./lib/format";
import { initSearchBar } from "./components/SearchBar";
import { renderCurrentWeather } from "./components/CurrentWeather";
import { renderDressToday } from "./components/DressRecommendation";
import { renderHourlyStrip } from "./components/HourlyStrip";
import { renderTempCurve, stationStartHour, type TempCurveInput } from "./components/TempCurve";
import { renderDailyForecast } from "./components/DailyForecast";
import { renderFavoritesList } from "./components/FavoritesList";
import { renderIcons } from "./icons";
import { byId } from "./dom";

const LAST_PLACE_KEY = "weather:last-place";
const FORECAST_CACHE_KEY = "weather:last-forecast";
const DAYS_KEY = "weather:forecast-days"; // gemerkte Vorhersage-Länge (7/10/16)
const CITY_PARAM = "stadt"; // teilbare URL: ?stadt=trabzon

// Erlaubte Vorhersage-Längen und Default. Etappe 1 zeigt weiterhin 7 Tage:
// die Daten enthalten 16, die Anzeige kürzt clientseitig auf forecastDays.
const FORECAST_DAY_OPTIONS = [7, 10, 16] as const;
const DEFAULT_FORECAST_DAYS = 7;

interface ForecastCache {
  placeId: number;
  latitude: number;
  longitude: number;
  savedAt: string;
  forecast: Forecast;
}

// Frische der Anzeige: "fresh" = aktuelle Netzdaten, "stale" = Sofort-Anzeige
// des letzten Stands während der Netzabruf läuft (Hinweis "Stand HH:MM"),
// "offline" = Netzabruf gescheitert, letzter Stand bleibt mit Offline-Hinweis
type Freshness = "fresh" | "stale" | "offline";

interface State {
  place: Place | null;
  forecast: Forecast | null;
  // Bewusst ohne localStorage Cache (kein eigener Key nötig): offline oder bei
  // API Ausfall fehlt die Pollensektion einfach, statt veraltete Werte zu zeigen
  pollen: PollenLevels | null;
  freshness: Freshness;
  updatedAt: string;
  // Sichtbare Vorhersage-Länge (Tage). Die Forecast-Daten enthalten bis zu 16
  // Tage; die Tagesliste rendert nur die ersten forecastDays davon.
  forecastDays: number;
}

const state: State = { place: null, forecast: null, pollen: null, freshness: "fresh", updatedAt: "", forecastDays: DEFAULT_FORECAST_DAYS };

function readJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Gemerkte Vorhersage-Länge lesen: nur 7/10/16 sind gültig, alles andere
// (leer, defekt, Altwert) fällt auf den Default 7 zurück.
function readForecastDays(): number {
  if (typeof localStorage === "undefined") return DEFAULT_FORECAST_DAYS;
  try {
    const raw = Number(localStorage.getItem(DAYS_KEY));
    return (FORECAST_DAY_OPTIONS as readonly number[]).includes(raw) ? raw : DEFAULT_FORECAST_DAYS;
  } catch {
    return DEFAULT_FORECAST_DAYS;
  }
}

// Vorhersage-Länge setzen: State aktualisieren, merken, neu rendern. Wird in
// Etappe 2 vom 7/10/16-Umschalter aufgerufen — JETZT nur angelegt, nicht
// verdrahtet. Ungültige Werte werden ignoriert (keine Render-Schleife).
export function setForecastDays(days: number): void {
  if (!(FORECAST_DAY_OPTIONS as readonly number[]).includes(days)) return;
  if (state.forecastDays === days) return;
  state.forecastDays = days;
  writeJson(DAYS_KEY, days);
  renderContent(); // ruft intern syncDaysSwitch() → aktiver Zustand folgt
  renderIcons();
}

// Spiegelt state.forecastDays in die Radiogruppe: aktiver Radio aria-checked,
// rovendes tabindex (nur der aktive ist per Tab erreichbar, Pfeile wechseln),
// und das aria-Label je Sprache ("7 Tage"). Der Umschalter steht statisch im
// Markup (wird nicht neu gerendert), daher von Hand synchronisiert.
function syncDaysSwitch(): void {
  const group = document.getElementById("daysSwitch");
  if (!group) return;
  const unit = t("daysUnit");
  group.querySelectorAll<HTMLButtonElement>("[data-days]").forEach((r) => {
    const on = Number(r.dataset.days) === state.forecastDays;
    r.setAttribute("aria-checked", String(on));
    r.tabIndex = on ? 0 : -1;
    r.setAttribute("aria-label", `${r.dataset.days} ${unit}`);
  });
}

// Bindet die Radiogruppe einmalig (Muster wie topRefresh/langSwitch): Klick und
// Tastatur (Pfeile wechseln + wählen, Enter/Space wählt). Wechsel ruft das in
// Etappe 1 angelegte setForecastDays (State + localStorage + renderContent).
function initDaysSwitch(): void {
  const group = document.getElementById("daysSwitch");
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>("[data-days]"));

  const choose = (r: HTMLButtonElement): void => {
    r.focus();
    setForecastDays(Number(r.dataset.days));
  };

  radios.forEach((r) => {
    r.addEventListener("click", () => choose(r));
    r.addEventListener("keydown", (e) => {
      const idx = radios.indexOf(r);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        choose(radios[(idx + 1) % radios.length]);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        choose(radios[(idx - 1 + radios.length) % radios.length]);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        choose(r);
      }
    });
  });

  syncDaysSwitch(); // Startzustand aus der (ggf. gespeicherten) state.forecastDays
}

// Tab-Titel mit dem aktuellen Wetter, z. B. "14° Regen · WeatherPure" —
// sichtbar bei mehreren offenen Tabs ohne Tabwechsel. Bewusst NIE der
// Ortsname: für den Geo-Ort darf er nicht erscheinen (Datenschutzzusage),
// und ein Format ohne Ortsname braucht dafür keinen Sonderfall. Wird nur
// bei State-Übergängen gesetzt (Ortswahl, frischer Abruf, Sprachwechsel),
// nie in einer Schleife — kein Flackern. Die Sofort-Anzeige des letzten
// Stands setzt ihn aus den Cache-Daten, der frische Abruf danach erneut.
function updateDocTitle(): void {
  if (!state.place || !state.forecast) return;
  const c = state.forecast.current;
  const cond = weatherLabelShort(getWmo(c.weatherCode).labelKey, getLang());
  document.title = `${formatTemp(c.temperature)} ${cond}\u202F·\u202FWeatherPure`;
}

function setView(view: "empty" | "loading" | "error" | "content"): void {
  byId("weatherEmpty").hidden = view !== "empty";
  byId("weatherLoading").hidden = view !== "loading";
  byId("weatherError").hidden = view !== "error";
  byId("weatherContent").hidden = view !== "content";
  // Ohne angezeigten Ort (Empty, Fehler, Laden eines Orts ohne letzten Stand)
  // gilt wieder der sprachabhängige Basistitel; den Wettertitel setzt
  // renderContent nach setView("content") synchron neu
  if (view !== "content") document.title = t("docTitle");
  // Aktualisieren-Button nur aktiv, wenn eine Stadt angezeigt wird — sonst
  // liefe er ins Leere. (Während des Refresh selbst läuft setView nicht.)
  const refreshBtn = document.getElementById("topRefresh") as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.disabled = view !== "content";
  // Zeitstempel-Caption nur bei angezeigter Stadt; sonst kein veralteter Wert
  // (im Content-View füllt renderContent → updateTopStamp sie passend).
  if (view !== "content") {
    const topStamp = document.getElementById("topStamp");
    if (topStamp) topStamp.hidden = true;
  }
}

// Setzt die obere Zeitstempel-Caption ("Aktualisiert HH:MM" / "Stand HH:MM")
// unter dem Aktualisieren-Button. Der Span steht statisch im Markup (nicht in
// der Karte), darum aus dem State gefüllt — bei jedem Render und nach jedem
// Refresh, in der Ortszeit des angezeigten Orts. Offline: keine Zeit (die Karte
// zeigt dort ihren eigenen Verbindungshinweis), Caption leer + versteckt.
function updateTopStamp(): void {
  const span = document.getElementById("topStamp");
  if (!span) return;
  const f = state.forecast;
  const time =
    f && state.freshness !== "offline" && state.updatedAt
      ? formatTimeInZone(f.timezone, getLocale(), new Date(state.updatedAt)) ?? formatHour(state.updatedAt, getLocale())
      : null;
  if (time) {
    span.hidden = false;
    span.textContent = t(state.freshness === "stale" ? "staleNote" : "freshNote").replace("{time}", time);
  } else {
    span.textContent = "";
    span.hidden = true;
  }
}

function renderFavorites(): void {
  renderFavoritesList(byId("favoritesList"), getFavorites(), state.place?.id ?? null, {
    onSelect: (place) => selectPlace(place),
    onRemove: (place) => {
      removeFavorite(place.id);
      renderFavorites();
      renderContent();
      renderIcons();
    },
  });
}

function renderPollen(): void {
  renderPollenList(byId("pollenList"), byId("pollenHeading"), state.pollen);
}

// Eingabe für den rollenden 24-Stunden-Verlauf (jetzt→+24h). forecast.hourly ist
// in normalize() bereits ab der aktuellen Stunde geschnitten — also direkt die
// gefühlten Werte der nächsten Stunden. startHour ist die ganzzahlige aktuelle
// Stunde in STATIONSZEIT des Orts (für die Achsenbeschriftung), nie Nutzerzeit;
// stationStartHour liefert -1 ohne/ungültige timezone → Marken zeigen "+Nh".
function buildTempCurveInput(forecast: Forecast): TempCurveInput {
  const feels = forecast.hourly.slice(0, 25).map((h) => h.apparentTemperature);
  return {
    feels,
    startHour: stationStartHour(forecast.timezone),
    ariaLabel: t("tc_aria"),
  };
}

function renderContent(): void {
  if (!state.place || !state.forecast) return;
  updateDocTitle(); // deckt Ortswahl, frischen Abruf und Sprachwechsel ab
  updateTopStamp(); // obere Zeitstempel-Caption (Ortswahl, Refresh, Sprachwechsel)
  renderPollen(); // deckt auch den Sprachwechsel ab (Labels neu)
  renderCurrentWeather(byId("currentWeather"), {
    place: state.place,
    forecast: state.forecast,
    isFav: isFavorite(state.place.id),
    freshness: state.freshness,
    updatedAt: state.updatedAt,
  });
  renderDressToday(byId("dressToday"), state.forecast);
  renderHourlyStrip(byId("hourlyStrip"), state.forecast);
  // Diagramm rendern; der äußere Kartentitel (gleiches .sh-Muster wie die
  // Nachbarkarten) folgt der Sichtbarkeit des Diagramms — versteckt es sich bei
  // zu wenigen Daten, verschwindet auch der Titel (wie beim Pollen-Muster).
  const tempCurveEl = byId("tempCurve");
  renderTempCurve(tempCurveEl, buildTempCurveInput(state.forecast));
  byId("tempCurveHeading").hidden = tempCurveEl.hidden;
  // Dynamische Überschrift "{n} Tage Vorhersage" (deckt Sprachwechsel mit ab,
  // da renderContent auch auf weather:langchange läuft). Das h2 trägt KEIN
  // data-i18n mehr — die Zahl käme dort nicht hinein; gesetzt wird sie hier.
  byId("dailyHeading").textContent = t("dailyHeadingDays").replace("{n}", String(state.forecastDays));
  renderDailyForecast(byId("dailyForecast"), state.forecast.daily, state.forecastDays);
  syncDaysSwitch(); // aktiver Umschalter-Zustand spiegelt state.forecastDays (auch nach Sprachwechsel/Reload)
  // Für den Geolocation-Ort rendert CurrentWeather keinen Stern (Standort
  // darf laut Datenschutzzusage nicht gespeichert werden) — daher guarded.
  document.getElementById("favToggle")?.addEventListener("click", () => {
    const place = state.place!;
    if (isFavorite(place.id)) removeFavorite(place.id);
    else addFavorite(place);
    renderFavorites();
    renderContent();
    renderIcons();
  });
}

// Manuelles Aktualisieren über den Button oben (neben "Mein Standort"): lädt die
// Wetterdaten der aktuell angezeigten Stadt neu. Bewusst über fetchWeather +
// renderContent (dieselben Bausteine, die selectPlace intern nutzt), NICHT über
// selectPlace selbst — letzteres würde für den Geo-Ort die Loading-Ansicht zeigen
// bzw. für eine gecachte Stadt kurz auf "Stand HH:MM" zurückspringen. Die Karte
// bleibt sichtbar, nur das Icon dreht sich. Der Button steht statisch im Markup
// (nicht in der neu gerenderten Karte), daher wird sein Zustand in finally
// manuell zurückgesetzt. Pollen bleibt unberührt (separater Endpoint).
let refreshing = false;
function refreshCurrentPlace(): void {
  const place = state.place;
  if (!place || refreshing) return;
  refreshing = true;
  const btn = document.getElementById("topRefresh") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.classList.add("cw-refresh--spinning");
  }

  fetchWeather(place.latitude, place.longitude)
    .then((forecast) => {
      if (state.place?.id !== place.id) return; // inzwischen anderer Ort gewählt
      state.forecast = forecast;
      state.freshness = "fresh";
      state.updatedAt = new Date().toISOString();
      if (place.id !== GEO_PLACE_ID) writeJson(FORECAST_CACHE_KEY, {
        placeId: place.id,
        latitude: place.latitude,
        longitude: place.longitude,
        savedAt: state.updatedAt,
        forecast,
      } satisfies ForecastCache);
      renderContent(); // Karte frisch: neuer "Aktualisiert HH:MM"
      renderFavorites();
      renderIcons();
    })
    .catch(() => {
      // Fehler: aktuellen Stand stehen lassen, keine Fehleransicht erzwingen.
    })
    .finally(() => {
      refreshing = false;
      // Button zurücksetzen (kein Dauerdrehen). Er liegt im statischen Markup,
      // wird also nicht durch renderContent neu gezeichnet — daher hier von Hand.
      const b = document.getElementById("topRefresh") as HTMLButtonElement | null;
      if (b) {
        b.disabled = false;
        b.classList.remove("cw-refresh--spinning");
      }
    });
}

// Hält die URL synchron zur angezeigten Stadt (ohne Reload). Der Geolocation-
// Ort entfernt den Parameter: Er hat keinen echten Namen, und der Standort
// darf nie in einer teilbaren URL landen (Datenschutzzusage).
function syncCityParam(place: Place): void {
  const url = new URL(location.href);
  if (place.id === GEO_PLACE_ID) url.searchParams.delete(CITY_PARAM);
  else url.searchParams.set(CITY_PARAM, place.name.toLowerCase());
  history.replaceState(history.state, "", url);
}

export function selectPlace(place: Place): void {
  // Geolocation-Ort nie persistieren: weder als letzter Ort noch im
  // Forecast-Cache (beide enthalten Koordinaten). Er lebt nur im State.
  const isGeoPlace = place.id === GEO_PLACE_ID;
  state.place = place;
  syncCityParam(place);
  if (!isGeoPlace) writeJson(LAST_PLACE_KEY, place);

  // Sofort-Anzeige: liegt für genau diesen Ort ein letzter Stand vor, wird er
  // ohne Spinner gerendert ("Stand HH:MM"), während parallel IMMER frisch
  // geholt wird — die lokale Kopie ist nur die Brücke, nie die Quelle der
  // Wahrheit. Für den Geo-Ort wird der Cache gar nicht erst gelesen: er wird
  // nie persistiert (Datenschutzzusage), die Sofort-Anzeige darf das nicht
  // aufweichen.
  const cached = !isGeoPlace ? readJson<ForecastCache>(FORECAST_CACHE_KEY) : null;
  if (cached !== null && cached.placeId === place.id) {
    state.forecast = cached.forecast;
    state.freshness = "stale";
    state.updatedAt = cached.savedAt;
    setView("content");
    renderContent();
    renderFavorites();
    renderIcons();
  } else {
    setView("loading");
  }

  // Pollen parallel zum Wetter holen: eigener Endpoint (Air Quality API),
  // dessen Ausfall die Wetteranzeige nicht blockieren darf. fetchPollen wirft
  // nie (Fehler intern → null = Sektion bleibt aus).
  state.pollen = null;
  fetchPollen(place.latitude, place.longitude).then((levels) => {
    if (state.place?.id !== place.id) return; // inzwischen anderer Ort gewählt
    state.pollen = levels;
    renderPollen();
  });

  fetchWeather(place.latitude, place.longitude)
    .then((forecast) => {
      if (state.place?.id !== place.id) return; // inzwischen anderer Ort gewählt
      state.forecast = forecast;
      state.freshness = "fresh";
      state.updatedAt = new Date().toISOString();
      if (!isGeoPlace) writeJson(FORECAST_CACHE_KEY, {
        placeId: place.id,
        latitude: place.latitude,
        longitude: place.longitude,
        savedAt: state.updatedAt,
        forecast,
      } satisfies ForecastCache);
      // Lautloser Tausch: die Sektionen werden synchron in place neu gefüllt,
      // ohne Loading-Zwischenzustand — kein Flackern, kein Scroll-Sprung
      setView("content");
      renderContent();
      renderFavorites();
      renderIcons();
    })
    .catch(() => {
      if (state.place?.id !== place.id) return;
      if (state.forecast && state.freshness === "stale") {
        // Sofort-Anzeige steht bereits: nur den Hinweis von "Stand HH:MM" auf
        // den Offline-Hinweis umstellen, die Anzeige selbst bleibt stehen
        state.freshness = "offline";
        renderContent();
        renderIcons();
      } else {
        // Nichts anzeigbar (kein Stand für diesen Ort): ehrliche Fehlermeldung
        setView("error");
      }
    });
}

export function initApp(): void {
  // Gemerkte Vorhersage-Länge übernehmen (Default 7, falls nichts/ungültig).
  state.forecastDays = readForecastDays();

  // Altlasten aus früheren Versionen entfernen, in denen der Geolocation-Ort
  // noch in localStorage landen konnte (Favoriten, letzter Ort, Forecast-Cache).
  pruneGeoFavorites();
  if (readJson<Place>(LAST_PLACE_KEY)?.id === GEO_PLACE_ID) {
    localStorage.removeItem(LAST_PLACE_KEY);
  }
  if (readJson<ForecastCache>(FORECAST_CACHE_KEY)?.placeId === GEO_PLACE_ID) {
    localStorage.removeItem(FORECAST_CACHE_KEY);
  }

  initSearchBar(byId("searchBar"), { onSelect: selectPlace });
  renderFavorites();
  renderIcons();

  byId("retryBtn").addEventListener("click", () => {
    if (state.place) selectPlace(state.place);
  });

  // Aktualisieren-Button steht statisch im Markup → Listener einmalig hier
  // (nicht in renderContent, sonst würde er bei jedem Render erneut gebunden).
  byId("topRefresh").addEventListener("click", refreshCurrentPlace);

  // 7/10/16-Umschalter ebenfalls statisch → Listener einmalig hier binden.
  initDaysSwitch();

  // Sprachwechsel: dynamische Bereiche mit neuen Labels/Locales neu rendern
  document.addEventListener("weather:langchange", () => {
    renderFavorites();
    if (state.place && state.forecast) renderContent();
    renderIcons();
  });

  // Startreihenfolge: ?stadt= aus der URL hat Vorrang (teilbarer Link),
  // dann letzter Ort, sonst Empty State (Suche ist Default).
  const restoreLastPlace = (): void => {
    const lastPlace = readJson<Place>(LAST_PLACE_KEY);
    if (lastPlace) selectPlace(lastPlace);
    else setView("empty");
  };

  const cityQuery = new URLSearchParams(location.search).get(CITY_PARAM)?.trim();
  if (cityQuery) {
    setView("loading");
    searchCity(cityQuery, getLang())
      .then((places) => {
        // Erster Treffer der Geocoding-Suche; nicht auflösbar → stiller Fallback
        if (places.length) selectPlace(places[0]);
        else restoreLastPlace();
      })
      .catch(restoreLastPlace);
  } else {
    restoreLastPlace();
  }
}
