// WeatherApp: hält State (Ort, Forecast) und orchestriert die Komponenten.
// Local first: letzter Ort + letzter Forecast liegen in localStorage, damit
// die App offline mit den zuletzt geladenen Daten startet.
import { GEO_PLACE_ID, searchCity, type Place } from "./lib/geocoding";
import { fetchWeather, type Forecast } from "./lib/weather";
import { fetchPollen, type PollenLevels } from "./lib/pollen";
import { renderPollenList } from "./components/PollenList";
import { getFavorites, isFavorite, addFavorite, removeFavorite, pruneGeoFavorites } from "./lib/favorites";
import { getLang, t } from "./i18n/ui";
import { getWmo } from "./lib/wmo";
import { weatherLabelShort } from "./i18n/weather-labels";
import { formatTemp } from "./lib/format";
import { initSearchBar } from "./components/SearchBar";
import { renderCurrentWeather } from "./components/CurrentWeather";
import { renderDressToday } from "./components/DressRecommendation";
import { renderHourlyStrip } from "./components/HourlyStrip";
import { renderTempCurve, nightFlagsFromStationTimes, type TempCurveInput } from "./components/TempCurve";
import { nightSpans, isNightAtMinutes, toMinutes } from "./lib/daylight";
import { renderDailyForecast } from "./components/DailyForecast";
import { renderFavoritesList } from "./components/FavoritesList";
import { renderIcons } from "./icons";
import { byId } from "./dom";

const LAST_PLACE_KEY = "weather:last-place";
const FORECAST_CACHE_KEY = "weather:last-forecast";
const CITY_PARAM = "stadt"; // teilbare URL: ?stadt=trabzon

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
}

const state: State = { place: null, forecast: null, pollen: null, freshness: "fresh", updatedAt: "" };

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

// Eingabe für den Temperaturverlauf: die Komponente rendert alles in einem SVG
// und baut die Zeitachse selbst aus hourTimes (echte Uhrzeiten). feels und
// hourTimes entstehen paarweise aus demselben Filter (gleiche Länge, gleiche
// Reihenfolge, Stationszeit-Strings unverändert — NICHT in lokale Zeit
// umrechnen). nightFlags liefert der Adapter unten aus derselben daylight-
// Quelle, mit der die Stundenleiste ihre Mond-Symbole wählt.
function buildTempCurveInput(forecast: Forecast): TempCurveInput {
  const usable = forecast.hourly.filter(
    (h) => Number.isFinite(h.apparentTemperature) && toMinutes(h.time) !== null,
  );
  const feels = usable.map((h) => h.apparentTemperature);
  const hourTimes = usable.map((h) => h.time);

  // Adapter daylight.ts → nightFlagsFromStationTimes: die Hilfsfunktion erwartet
  // ein Minuten-Prädikat und einen iso→Minuten Konverter. isNightAtMinutes
  // prüft gegen die nightSpans-Intervalle — wörtlich dieselbe Quelle wie die
  // Mond-Symbole der Stundenleiste, damit der Farbverlauf der Linie und die
  // Symbole zur selben Minute kippen. Fehlen die Sonnenzeiten (alte Caches),
  // leeres Array → Linie einfarbig Tag, kein Fehler, kein Raten.
  const spans = nightSpans(forecast.daily);
  const nightFlags =
    spans === null
      ? []
      : nightFlagsFromStationTimes(
          hourTimes,
          (stationMinutes) => isNightAtMinutes(stationMinutes, spans),
          (iso) => toMinutes(iso) ?? Number.NaN,
        );

  return { feels, hourTimes, nightFlags, ariaLabel: t("tc_aria") };
}

function renderContent(): void {
  if (!state.place || !state.forecast) return;
  updateDocTitle(); // deckt Ortswahl, frischen Abruf und Sprachwechsel ab
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
  renderTempCurve(byId("tempCurve"), buildTempCurveInput(state.forecast));
  renderDailyForecast(byId("dailyForecast"), state.forecast.daily);
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
