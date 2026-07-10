// WeatherApp: hält State (Ort, Forecast) und orchestriert die Komponenten.
// Local first: letzter Ort + letzter Forecast liegen in localStorage, damit
// die App offline mit den zuletzt geladenen Daten startet.
import { GEO_PLACE_ID, searchCity, type Place } from "./lib/geocoding";
import { fetchWeather, type Forecast, type DailyEntry } from "./lib/weather";
import { fetchPollen, type PollenLevels } from "./lib/pollen";
import { renderPollenList } from "./components/PollenList";
import { renderAirQuality } from "./components/AirQuality";
import { renderWeatherAlerts } from "./components/WeatherAlerts";
import { MAX_FAVORITES, getFavorites, isFavorite, addFavorite, removeFavorite, insertFavorite, moveFavorite, pruneGeoFavorites } from "./lib/favorites";
import { getLang, getLocale, t, type Lang } from "./i18n/ui";
import { showToast } from "./lib/toast";
import { getWmo } from "./lib/wmo";
import { weatherLabel, weatherLabelShort } from "./i18n/weather-labels";
import { shareText, shareImage } from "./lib/share";
import { renderWeatherCard } from "./lib/shareImage";
import { formatTemp, formatStampInZone, formatHour, formatWeekdayLong } from "./lib/format";
import { initSearchBar } from "./components/SearchBar";
import { renderCurrentWeather } from "./components/CurrentWeather";
import { renderDressToday } from "./components/DressRecommendation";
import { renderHourlyStrip } from "./components/HourlyStrip";
import { renderTempCurve, forecastStartHour, type TempCurveInput } from "./components/TempCurve";
import { renderRainChart, type RainChartInput } from "./components/RainChart";
import { renderDailyForecast, resetDailyPanelToToday } from "./components/DailyForecast";
import { renderFavoritesList } from "./components/FavoritesList";
import { readFavWeatherCache, refreshFavoritesWeather, cacheFavoriteWeather, pruneFavWeatherCache } from "./lib/favoritesWeather";
import { bestWeatherDayKey } from "./lib/weekSummary";
import { renderIcons } from "./icons";
import { byId } from "./dom";

const LAST_PLACE_KEY = "weather:last-place";
const FORECAST_CACHE_KEY = "weather:weatherapi:last-forecast";
const LEGACY_FORECAST_CACHE_KEY = "weather:last-forecast";
const CITY_PARAM = "stadt"; // teilbare URL: ?stadt=trabzon
const DEFAULT_FORECAST_DAYS = 7;

interface ForecastCache {
  placeId: number;
  latitude: number;
  longitude: number;
  savedAt: string;
  forecast: Forecast;
}

// Forecast-Cache, der älter als dies ist, wird beim Start NICHT mehr als
// Sofort-Anzeige gezeigt. Nach 60 Minuten wird sie außerdem gelöscht, damit
// aktuelle Wetterwerte nicht veraltet angezeigt werden. Gleicher TTL-Stil wie
// isFavWeatherStale (Date.parse + Number.isFinite-Guard).
const MAX_FORECAST_CACHE_AGE_MS = 60 * 60 * 1000;
function isForecastCacheTooOld(savedAt: string, nowMs = Date.now()): boolean {
  const savedMs = Date.parse(savedAt);
  if (!Number.isFinite(savedMs)) return true;
  return nowMs - savedMs > MAX_FORECAST_CACHE_AGE_MS;
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

// Auto-Open des Stundendetail-Panels: bei JEDEM neuen Wetterdatenladen (neuer Ort
// via selectPlace ODER Refresh via refreshCurrentPlace) wird neu "armed", sodass
// der Detailkasten die aktuelle Stunde zeigt. Über den Cache→Netz-Doppelrender
// desselben Orts hinweg bleibt es armed, bis der erste aufgelöste Render
// (freshness "fresh"/"offline", nicht mehr "stale") wirklich geöffnet hat; danach
// entwaffnet. So springt der Kasten nach manuellem Schließen NICHT bei bloßen
// Re-Rendern (Sprach- oder Tageswechsel) wieder auf, solange dieselben Daten aktiv
// sind. Der Strip selbst kann Neuladen nicht von einer Nutzeraktion unterscheiden,
// daher liegt das Flag hier. Startwert true = Auto-Open beim ersten Laden.
let hourlyAutoOpenArmed = true;

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
      ? formatStampInZone(f.timezone, getLocale(), new Date(state.updatedAt)) ?? formatHour(state.updatedAt, getLocale())
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
  // Wetter NUR aus dem Cache (Etappe 2: keine Netzaufrufe hier — der Auto-Load,
  // der den Cache füllt, kommt in Etappe 3). Leerer Cache → leere Map → Chips
  // zeigen wie bisher nur den Namen.
  const weather = readFavWeatherCache();
  renderFavoritesList(byId("favoritesList"), getFavorites(), state.place?.id ?? null, {
    onSelect: (place) => selectPlace(place),
    onRemove: (place) => {
      // Position VOR dem Entfernen merken: Rückgängig stellt die alte
      // Reihenfolge wieder her, nicht nur den Eintrag.
      const idx = getFavorites().findIndex((p) => p.id === place.id);
      removeFavorite(place.id);
      // P1: Wetter-Eintrag des entfernten Favoriten sofort mit aufräumen.
      pruneFavWeatherCache(getFavorites().map((p) => p.id));
      renderFavorites();
      renderContent();
      renderIcons();
      // Undo statt Bestätigungsdialog (UX Playbook): das Entfernen bleibt ein
      // Tipp, der Toast bietet den Rückweg. Kein Ortsname-Escaping nötig,
      // textContent im Toast.
      showToast(t("favRemovedToast").replace("{place}", place.name), {
        label: t("undo"),
        onAction: () => {
          insertFavorite(place, idx);
          renderFavorites();
          renderContent();
          renderIcons();
          // Der Wetter-Cache-Eintrag wurde beim Entfernen gepruned; der
          // batched Call holt ihn für den wiederhergestellten Ort zurück.
          loadFavoritesWeather();
        },
      });
    },
    onMove: (place, dir) => {
      // Nur die Reihenfolge ändert sich; aktive Stadt und Wetterinhalt bleiben.
      // Daher reicht ein frisches Listen-Render (liest getFavorites neu) plus
      // renderIcons für die neu eingefügten Lucide-Knoten — kein renderContent.
      moveFavorite(place.id, dir);
      renderFavorites();
      renderIcons();
    },
  }, weather);
}

// Favoriten-Wetter im Hintergrund laden: refreshFavoritesWeather macht EINEN
// batched Call nur für stale/missing Orte (Etappe 1) und füllt den Cache; danach
// rendern die Chips mit Temp+Icon. NICHT-BLOCKIEREND — der App-Start wartet nie
// darauf. getFavorites() liefert nur echte Favoriten (Geo-Ort ist nie dabei).
// Fehler sind in refreshFavoritesWeather bereits geschluckt; der catch ist die
// letzte Sicherung. War schon Cache da, bleibt er bis zum Re-Render sichtbar.
function loadFavoritesWeather(): void {
  const favs = getFavorites();
  if (favs.length === 0) return; // kein Call ohne Favoriten
  refreshFavoritesWeather(favs)
    .then(() => {
      renderFavorites(); // liest den jetzt gefüllten Cache
      renderIcons();     // neue data-lucide Wetter-Icons hydrieren
    })
    .catch(() => { /* leise: Chips bleiben bei alten/keinen Werten */ });
}

// Schnellstart-Chips im Empty State: ein klarer nächster Schritt beim ersten
// Besuch (UX Playbook zustaende.md), sprachabhängig kuratierte Städte. Klick
// löst denselben Weg aus wie der ?stadt= Deep-Link: Geocoding-Suche, erster
// Treffer. Kein Treffer/Fehler → still zurück zum Empty State (gleiches
// stilles Fallback-Muster wie der URL-Start in initApp).
const QUICK_CITIES: Record<Lang, string[]> = {
  de: ["Berlin", "Hamburg", "München", "Wien"],
  en: ["London", "New York", "Berlin", "Sydney"],
  tr: ["İstanbul", "Ankara", "İzmir", "Antalya"],
};

function renderEmptyCities(): void {
  const wrap = document.getElementById("emptyCities");
  if (!wrap) return;
  wrap.textContent = "";
  for (const name of QUICK_CITIES[getLang()]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "city-chip";
    btn.textContent = name;
    btn.addEventListener("click", () => {
      setView("loading");
      searchCity(name, getLang())
        .then((places) => {
          if (places.length) selectPlace(places[0]);
          else setView("empty");
        })
        .catch(() => setView("empty"));
    });
    wrap.appendChild(btn);
  }
}

function renderPollen(): void {
  renderPollenList(byId("pollenList"), byId("pollenHeading"), state.pollen);
}

function renderStarterData(): void {
  if (!state.forecast) return;
  renderAirQuality(byId("airQuality"), byId("airQualityHeading"), state.forecast.airQuality);
  renderWeatherAlerts(byId("weatherAlerts"), byId("alertsHeading"), state.forecast.alerts, state.forecast.timezone);
}

// Wochenüberblick-Aussage über der Tagesliste. Immer die nächsten ~7 Tage,
// UNABHÄNGIG vom 7/10/16-Umschalter (Wochenüberblick, nicht der Ausblick).
// bestWeatherDayKey liefert null, wenn kein Tag das Mindestniveau erreicht →
// Block per hidden ausblenden, kein Layout-Loch. textContent statt innerHTML:
// der Wochentagsname ist reiner Text, keine Hydrierung nötig.
function renderWeekSummary(daily: DailyEntry[]): void {
  const el = byId("weekSummary");
  const best = bestWeatherDayKey(daily);
  if (!best) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.textContent =
    best.key === "week_best_today"
      ? t("week_best_today")
      : t("week_best_day").replace("{day}", formatWeekdayLong(daily[best.dayIndex].date, getLocale()));
  el.hidden = false;
}

// Eingabe für den rollenden 24-Stunden-Verlauf (jetzt→+24h). forecast.hourly ist
// in normalize() bereits ab der aktuellen Stunde geschnitten — also direkt die
// gefühlten Werte der nächsten Stunden. Kurve, Werte und Zeitachse stammen
// vollständig aus denselben Hourly Einträgen.
function buildTempCurveInput(forecast: Forecast): TempCurveInput {
  // jetzt-Punkt (Index 0) ist hourly[0], genau wie RainChart, die Stundenleiste
  // und das Stundendetail der aktuellen Stunde. Kein Mischen mehr mit current
  // (das ist die Momentbeobachtung der aktuellen Wetterkarte, ein eigener
  // Zeitpunkt); so bleibt der Wert deckungsgleich mit der aus hourly[0].time
  // gebildeten Zeitachse und mit dem Stundenpanel.
  const window = forecast.hourly.slice(0, 25).map((h) => h.apparentTemperature);
  return {
    feels: window,
    startHour: forecastStartHour(forecast.hourly[0]?.time),
    ariaLabel: t("tc_aria"),
  };
}

// Eingabe fürs Regen-Diagramm: dasselbe rollende 24-Stunden-Fenster wie die
// TempCurve (slice(0,25) → deckungsgleiche x-Achse). precipitation ist optional
// (alte Caches kennen das Feld nicht); fehlende Werte als 0, kein NaN. Ob die
// Sektion sichtbar wird, entscheidet RainChart selbst anhand der Spitze.
function buildRainChartInput(forecast: Forecast): RainChartInput {
  const window = forecast.hourly.slice(0, 25);
  const precip = window.map((h) => (typeof h.precipitation === "number" ? h.precipitation : 0));
  const times = window.map((h) => h.time);
  return {
    precip,
    times,
    startHour: forecastStartHour(window[0]?.time),
    locale: getLocale(),
    ariaLabel: t("rain_aria"),
  };
}

// Dezentes gestaffeltes Einblenden der Inhaltskarten. Reflow-Neustart (remove →
// offsetWidth lesen → add), damit die CSS-Animation bei JEDEM Aufruf neu läuft.
// Bewusst NICHT in renderContent(), sondern nur an den Stellen aufgerufen, an
// denen Inhalt frisch erscheint (Stadtwahl, Refresh) — nicht im Cache-Vorlauf-
// Doppelrender, beim Sprachwechsel oder Tageswechsel. Die Animation selbst hängt
// an @media (prefers-reduced-motion:no-preference); bei reduce ist die Klasse
// wirkungslos und der Inhalt sofort voll sichtbar.
function revealCards(): void {
  const el = byId("weatherContent");
  el.classList.remove("cards-revealing");
  void el.offsetWidth; // erzwingt Reflow → Animation startet bei erneutem Add neu
  el.classList.add("cards-revealing");
}

function renderContent(): void {
  if (!state.place || !state.forecast) return;
  updateDocTitle(); // deckt Ortswahl, frischen Abruf und Sprachwechsel ab
  updateTopStamp(); // obere Zeitstempel-Caption (Ortswahl, Refresh, Sprachwechsel)
  renderPollen(); // deckt auch den Sprachwechsel ab (Labels neu)
  renderStarterData();
  renderCurrentWeather(byId("currentWeather"), {
    place: state.place,
    forecast: state.forecast,
    isFav: isFavorite(state.place.id),
    canAddFavorite: getFavorites().length < MAX_FAVORITES,
    freshness: state.freshness,
    updatedAt: state.updatedAt,
  });
  renderDressToday(byId("dressToday"), state.forecast);
  const didAutoOpen = renderHourlyStrip(byId("hourlyStrip"), state.forecast, hourlyAutoOpenArmed);
  // Nach dem aufgelösten Erst-Ladeversuch entwaffnen. Der Cache-Render bleibt
  // "stale" (also armed), der darauffolgende Netz-Render desselben Orts öffnet
  // damit erneut (kein Blitzen), danach kein automatisches Öffnen mehr. Zusätzlich
  // nur entwaffnen, wenn wirklich geöffnet wurde (didAutoOpen) — ein degenerierter
  // Render mit leerem hourly öffnet nicht und darf das Flag nicht vorzeitig
  // verbrauchen (Befund 2). Der "stale"-Guard bleibt: sonst würde schon der
  // Cache-Render entwaffnen und der Netz-Render das Panel ungeöffnet zurücklassen.
  if (hourlyAutoOpenArmed && state.freshness !== "stale" && didAutoOpen) hourlyAutoOpenArmed = false;
  // Diagramm rendern; der äußere Kartentitel (gleiches .sh-Muster wie die
  // Nachbarkarten) folgt der Sichtbarkeit des Diagramms — versteckt es sich bei
  // zu wenigen Daten, verschwindet auch der Titel (wie beim Pollen-Muster).
  const tempCurveEl = byId("tempCurve");
  renderTempCurve(tempCurveEl, buildTempCurveInput(state.forecast));
  byId("tempCurveHeading").hidden = tempCurveEl.hidden;
  // Regen-Diagramm direkt darunter, gleiches Hide-Muster: die Komponente
  // versteckt sich bei zu wenig Regen selbst, der äußere Titel folgt.
  const rainChartEl = byId("rainChart");
  renderRainChart(rainChartEl, buildRainChartInput(state.forecast));
  byId("rainChartHeading").hidden = rainChartEl.hidden;
  // Dynamische Überschrift "{n} Tage Vorhersage" (deckt Sprachwechsel mit ab,
  // da renderContent auch auf weather:langchange läuft). Das h2 trägt KEIN
  // data-i18n mehr — die Zahl käme dort nicht hinein; gesetzt wird sie hier.
  // Überschrift zählt die TATSÄCHLICH gerenderten Tage. Fehlt am Rand ein
  // unvollständiger Tag, bleibt die Zahl damit ehrlich. Deckt sich mit
  // renderDailyForecast, das intern slice(0, days) verwendet.
  const shownDays = Math.min(state.forecast.daily.length, DEFAULT_FORECAST_DAYS);
  byId("dailyHeading").textContent = t("dailyHeadingDays").replace("{n}", String(shownDays));
  renderWeekSummary(state.forecast.daily); // immer ~7 Tage, unabhängig vom Umschalter
  // Das Tagespanel merkt sich den offenen Tag selbst (openDayIndex in der
  // Komponente). Neue Wetterdaten setzen ihn per resetDailyPanelToToday() (in
  // selectPlace/refreshCurrentPlace) auf Heute; ein Re-Render bewahrt die Auswahl.
  renderDailyForecast(byId("dailyForecast"), state.forecast.daily, DEFAULT_FORECAST_DAYS);
  // Für den Geolocation-Ort rendert CurrentWeather keinen Stern (Standort
  // darf laut Datenschutzzusage nicht gespeichert werden) — daher guarded.
  document.getElementById("favToggle")?.addEventListener("click", () => {
    const place = state.place!;
    const wasAdded = !isFavorite(place.id);
    if (wasAdded) addFavorite(place); else removeFavorite(place.id);
    renderFavorites();
    renderContent();
    renderIcons();
    if (wasAdded) {
      document.getElementById("favToggle")?.classList.add("fav-toggle--added");
    }
  });
  document.getElementById("shareBtn")?.addEventListener("click", shareCurrentWeather);
}

// Teilt das aktuell angezeigte Wetter. Bevorzugt ein handgezeichnetes PNG (mit
// Text + URL als Begleittext); kann das Gerät keine Dateien teilen, fällt es auf
// Text-Teilen zurück (alles in share.ts). EIN Knopf, ein Verhalten, Bild bevorzugt.
// Ohne geladene Daten ein No-op, kein Crash. URL: stadtspezifischer Deep-Link
// (?stadt=) für benannte Orte, kanonische Startseite für den Geo-Ort — dort NIE
// Koordinaten teilen (Datenschutzzusage); auch das Bild zeigt nur "Mein Standort".
let sharing = false;
async function shareCurrentWeather(): Promise<void> {
  if (sharing || !state.place || !state.forecast) return;
  const place = state.place;
  const forecast = state.forecast;
  const c = forecast.current;
  const name = place.id === GEO_PLACE_ID ? t("myLocation") : place.name;
  const label = weatherLabel(getWmo(c.weatherCode).labelKey, getLang());
  const text = `${name}: ${formatTemp(c.temperature)}, ${label}`;
  const base = "https://weatherpure.com/";
  const url =
    place.id === GEO_PLACE_ID
      ? base
      : `${base}?${CITY_PARAM}=${encodeURIComponent(place.name.toLowerCase())}`;
  const payload = { title: "WeatherPure", text, url };

  // Knopf während Font-ready + Zeichnen + toBlob kurz sperren (kein Doppel-Tap).
  const btn = document.getElementById("shareBtn") as HTMLButtonElement | null;
  sharing = true;
  if (btn) { btn.disabled = true; btn.classList.add("cw-share--busy"); }
  try {
    const blob = await renderWeatherCard({ name, forecast, locale: getLocale(), lang: getLang() });
    if (blob) {
      const file = new File([blob], "weatherpure.png", { type: "image/png" });
      await shareImage(payload, file);
    } else {
      // Zeichnen/toBlob gescheitert → sauberer Rückfall auf Text-Teilen.
      await shareText(payload);
    }
  } finally {
    sharing = false;
    if (btn) { btn.disabled = false; btn.classList.remove("cw-share--busy"); }
  }
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
// Monoton steigendes Lade-Token gegen Race beim Ortswechsel: jede neue Wetter-
// Anforderung (selectPlace UND refreshCurrentPlace, inkl. Geo-Ort) erhöht es;
// nach dem await darf nur die ZULETZT gestartete Antwort die Anzeige setzen. Der
// id-Guard allein reicht nicht, weil der Geolocation-Ort immer dieselbe id
// (GEO_PLACE_ID = -1) trägt; zwei schnelle "Mein Standort"-Klicks wären sonst
// nicht unterscheidbar. Der bestehende id-Guard bleibt zusätzlich erhalten.
let loadSeq = 0;
function refreshCurrentPlace(): void {
  const place = state.place;
  if (!place || refreshing) return;
  refreshing = true;
  // Refresh = frische Wetterdaten: Stundendetail wieder scharf schalten und das
  // Tages-Detail auf Heute zurücksetzen, sodass beide nach dem Nachladen offen sind.
  hourlyAutoOpenArmed = true;
  resetDailyPanelToToday();
  const mySeq = ++loadSeq;
  const btn = document.getElementById("topRefresh") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.classList.add("cw-refresh--spinning");
  }

  fetchWeather(place.latitude, place.longitude)
    .then((forecast) => {
      if (mySeq !== loadSeq || state.place?.id !== place.id) return; // überholt oder anderer Ort
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
      // Gratis-Update: aktueller Ort, wenn Favorit, ohne extra Call spiegeln.
      if (isFavorite(place.id)) {
        cacheFavoriteWeather(place.id, { temp: forecast.current.temperature, code: forecast.current.weatherCode, isDay: forecast.current.isDay });
      }
      renderContent(); // Karte frisch: neuer "Aktualisiert HH:MM"
      renderFavorites();
      renderIcons();
      revealCards();
      // C) Der Aktualisieren-Button frischt auch die übrigen Favoriten auf
      // (batched, nur stale/missing). Der gerade gespiegelte Ort fällt dabei raus.
      loadFavoritesWeather();
    })
    .catch(() => {
      if (mySeq !== loadSeq || state.place?.id !== place.id) return;
      if (state.forecast) {
        state.freshness = "offline";
        renderContent();
        renderIcons();
      }
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
  // Neuer Ort = neue Wetterdaten: Stundendetail wieder scharf schalten und das
  // Tages-Detail auf Heute zurücksetzen, damit beide direkt aufgeklappt erscheinen.
  hourlyAutoOpenArmed = true;
  resetDailyPanelToToday();
  // Geolocation-Ort nie persistieren: weder als letzter Ort noch im
  // Forecast-Cache (beide enthalten Koordinaten). Er lebt nur im State.
  const isGeoPlace = place.id === GEO_PLACE_ID;
  state.place = place;
  syncCityParam(place);
  if (!isGeoPlace) writeJson(LAST_PLACE_KEY, place);
  // Diese Lade-Anforderung eindeutig markieren (s. loadSeq): nur ihre Antwort
  // darf später die Anzeige setzen, falls inzwischen neu geladen wurde.
  const mySeq = ++loadSeq;

  // Sofort-Anzeige: liegt für genau diesen Ort ein letzter Stand vor, wird er
  // ohne Spinner gerendert ("Stand HH:MM"), während parallel IMMER frisch
  // geholt wird — die lokale Kopie ist nur die Brücke, nie die Quelle der
  // Wahrheit. Für den Geo-Ort wird der Cache gar nicht erst gelesen: er wird
  // nie persistiert (Datenschutzzusage), die Sofort-Anzeige darf das nicht
  // aufweichen.
  const cached = !isGeoPlace ? readJson<ForecastCache>(FORECAST_CACHE_KEY) : null;
  if (cached !== null && isForecastCacheTooOld(cached.savedAt)) {
    localStorage.removeItem(FORECAST_CACHE_KEY);
  }
  // Sehr alten Cache (älter als MAX_FORECAST_CACHE_AGE_MS) NICHT als Sofort-
  // Anzeige zeigen: eine tagealte Vorhersage als "Stand" wäre irreführend. Bis
  // zur Grenze wird er gezeigt (mit Datums-Label, s. formatStampInZone); darüber
  // greift online der frische Abruf, offline der ehrliche Fehlerzustand.
  const usableCache =
    cached !== null && cached.placeId === place.id && !isForecastCacheTooOld(cached.savedAt) ? cached : null;
  const showedFromCache = usableCache !== null;
  if (usableCache !== null) {
    state.forecast = usableCache.forecast;
    state.freshness = "stale";
    state.updatedAt = usableCache.savedAt;
    setView("content");
    renderContent();
    renderFavorites();
    renderIcons();
    revealCards();
  } else {
    setView("loading");
  }

  // Pollen parallel zum Wetter holen: eigener WeatherAPI Endpoint,
  // dessen Ausfall die Wetteranzeige nicht blockieren darf. fetchPollen wirft
  // nie (Fehler intern → null = Sektion bleibt aus).
  state.pollen = null;
  fetchPollen(place.latitude, place.longitude).then((levels) => {
    // Referenzgleichheit statt nur id: der Geo-Ort trägt immer id -1, aber jeder
    // "Mein Standort"-Klick erzeugt ein neues Place-Objekt. So wird eine überholte
    // Pollen-Antwort verworfen, ohne dass ein bloßer Refresh (gleiches Objekt,
    // kein erneuter Pollen-Abruf) die laufende Antwort fälschlich killt.
    if (state.place !== place || state.place?.id !== place.id) return;
    state.pollen = levels;
    renderPollen();
  });

  fetchWeather(place.latitude, place.longitude)
    .then((forecast) => {
      if (mySeq !== loadSeq || state.place?.id !== place.id) return; // überholt oder anderer Ort
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
      // Gratis-Update: ist der geladene Ort ein Favorit, dessen current direkt in
      // den Favoriten-Cache spiegeln (kein extra Call; Geo-Ort ist nie Favorit).
      if (isFavorite(place.id)) {
        cacheFavoriteWeather(place.id, { temp: forecast.current.temperature, code: forecast.current.weatherCode, isDay: forecast.current.isDay });
      }
      // Lautloser Tausch: die Sektionen werden synchron in place neu gefüllt,
      // ohne Loading-Zwischenzustand — kein Flackern, kein Scroll-Sprung
      setView("content");
      renderContent();
      renderFavorites();
      renderIcons();
      if (!showedFromCache) revealCards(); // sonst lautloser Tausch (Cache hat schon eingeblendet)
    })
    .catch(() => {
      if (mySeq !== loadSeq || state.place?.id !== place.id) return;
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
  localStorage.removeItem(LEGACY_FORECAST_CACHE_KEY);
  if (readJson<Place>(LAST_PLACE_KEY)?.id === GEO_PLACE_ID) {
    localStorage.removeItem(LAST_PLACE_KEY);
  }
  const storedForecast = readJson<ForecastCache>(FORECAST_CACHE_KEY);
  if (storedForecast?.placeId === GEO_PLACE_ID || (storedForecast && isForecastCacheTooOld(storedForecast.savedAt))) {
    localStorage.removeItem(FORECAST_CACHE_KEY);
  }
  localStorage.removeItem("weather:forecast-days");

  initSearchBar(byId("searchBar"), { onSelect: selectPlace });
  renderFavorites();
  renderEmptyCities();
  renderIcons();

  byId("retryBtn").addEventListener("click", () => {
    if (state.place) selectPlace(state.place);
  });

  // Aktualisieren-Button steht statisch im Markup → Listener einmalig hier
  // (nicht in renderContent, sonst würde er bei jedem Render erneut gebunden).
  byId("topRefresh").addEventListener("click", refreshCurrentPlace);

  // Sprachwechsel: dynamische Bereiche mit neuen Labels/Locales neu rendern
  document.addEventListener("weather:langchange", () => {
    renderFavorites();
    renderEmptyCities(); // sprachabhängige Städteliste neu aufbauen
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

  // Favoriten-Wetter im Hintergrund nachladen (batched, nur stale/missing).
  // Bewusst nach dem Start-Render und losgelöst vom Haupt-Wetter-Flow: blockiert
  // weder Splash noch die Hauptkarte.
  loadFavoritesWeather();
}
