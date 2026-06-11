// WeatherApp: hält State (Ort, Forecast) und orchestriert die Komponenten.
// Local first: letzter Ort + letzter Forecast liegen in localStorage, damit
// die App offline mit den zuletzt geladenen Daten startet.
import { GEO_PLACE_ID, searchCity, type Place } from "./lib/geocoding";
import { fetchWeather, type Forecast } from "./lib/weather";
import { fetchPollen, type PollenLevels } from "./lib/pollen";
import { renderPollenList } from "./components/PollenList";
import { getFavorites, isFavorite, addFavorite, removeFavorite, pruneGeoFavorites } from "./lib/favorites";
import { getLang } from "./i18n/ui";
import { initSearchBar } from "./components/SearchBar";
import { renderCurrentWeather } from "./components/CurrentWeather";
import { renderDressToday } from "./components/DressRecommendation";
import { renderHourlyStrip } from "./components/HourlyStrip";
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

interface State {
  place: Place | null;
  forecast: Forecast | null;
  // Bewusst ohne localStorage Cache (kein eigener Key nötig): offline oder bei
  // API Ausfall fehlt die Pollensektion einfach, statt veraltete Werte zu zeigen
  pollen: PollenLevels | null;
  fromCache: boolean;
  updatedAt: string;
}

const state: State = { place: null, forecast: null, pollen: null, fromCache: false, updatedAt: "" };

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

function setView(view: "empty" | "loading" | "error" | "content"): void {
  byId("weatherEmpty").hidden = view !== "empty";
  byId("weatherLoading").hidden = view !== "loading";
  byId("weatherError").hidden = view !== "error";
  byId("weatherContent").hidden = view !== "content";
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

function renderContent(): void {
  if (!state.place || !state.forecast) return;
  renderPollen(); // deckt auch den Sprachwechsel ab (Labels neu)
  renderCurrentWeather(byId("currentWeather"), {
    place: state.place,
    forecast: state.forecast,
    isFav: isFavorite(state.place.id),
    fromCache: state.fromCache,
    updatedAt: state.updatedAt,
  });
  renderDressToday(byId("dressToday"), state.forecast);
  renderHourlyStrip(byId("hourlyStrip"), state.forecast.hourly);
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
  setView("loading");

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
      state.fromCache = false;
      state.updatedAt = new Date().toISOString();
      if (!isGeoPlace) writeJson(FORECAST_CACHE_KEY, {
        placeId: place.id,
        latitude: place.latitude,
        longitude: place.longitude,
        savedAt: state.updatedAt,
        forecast,
      } satisfies ForecastCache);
      setView("content");
      renderContent();
      renderFavorites();
      renderIcons();
    })
    .catch(() => {
      if (state.place?.id !== place.id) return;
      const cached = readJson<ForecastCache>(FORECAST_CACHE_KEY);
      if (cached && cached.placeId === place.id) {
        state.forecast = cached.forecast;
        state.fromCache = true;
        state.updatedAt = cached.savedAt;
        setView("content");
        renderContent();
        renderFavorites();
        renderIcons();
      } else {
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
