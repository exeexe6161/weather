// WeatherApp: hält State (Ort, Forecast) und orchestriert die Komponenten.
// Local first: letzter Ort + letzter Forecast liegen in localStorage, damit
// die App offline mit den zuletzt geladenen Daten startet.
import { GEO_PLACE_ID, searchCity, type Place } from "./lib/geocoding";
import { fetchWeather, type Forecast, type DailyEntry } from "./lib/weather";
import { classifyLoadError, failTitleKey, type LoadErrorKind } from "./lib/loadError";
import { decideLinkResolution } from "./lib/linkResolution";
import { fetchPollen, POLLEN_LOADING, type PollenResult } from "./lib/pollen";
import type { Freshness } from "./lib/sectionState";
import { renderPollenList } from "./components/PollenList";
import { renderAirQuality } from "./components/AirQuality";
import { renderWeatherAlerts } from "./components/WeatherAlerts";
import { renderTodayHighlights } from "./components/TodayHighlights";
import { MAX_FAVORITES, getFavorites, isFavorite, addFavorite, removeFavorite, insertFavorite, moveFavorite, pruneGeoFavorites } from "./lib/favorites";
import { getLang, getLocale, t, type Lang } from "./i18n/ui";
import { showToast } from "./lib/toast";
import { getWmo } from "./lib/wmo";
import { weatherLabel, weatherLabelShort } from "./i18n/weather-labels";
import { shareText, shareImage, decideSharePath, type ShareCapabilities } from "./lib/share";
import { renderWeatherCard } from "./lib/shareImage";
import { formatTemp, formatStampInZone, formatHour, formatWeekdayLong } from "./lib/format";
import { initSearchBar, closeSearch } from "./components/SearchBar";
import { renderCurrentWeather, stopLocalTimeTicker } from "./components/CurrentWeather";
import { renderDressToday } from "./components/DressRecommendation";
import { renderHourlyStrip } from "./components/HourlyStrip";
import { renderTempCurve, forecastStartHour, type TempCurveInput } from "./components/TempCurve";
import { renderRainChart, type RainChartInput } from "./components/RainChart";
import { renderDailyForecast, resetDailyPanelToToday } from "./components/DailyForecast";
import { renderFavoritesList } from "./components/FavoritesList";
import { readFavWeatherCache, refreshFavoritesWeather, cacheFavoriteWeather, pruneFavWeatherCache, mirrorForNewFavorite } from "./lib/favoritesWeather";
import { getUsableForecast, putForecast, pruneForecastCache, pruneExpiredForecasts } from "./lib/forecastCache";
import { bestWeatherDayKey } from "./lib/weekSummary";
import { renderIcons } from "./icons";
import { byId } from "./dom";

const LAST_PLACE_KEY = "weather:last-place";
const CITY_PARAM = "stadt"; // teilbare URL: ?stadt=trabzon
const DEFAULT_FORECAST_DAYS = 7;

// Frische der Anzeige: "fresh" = aktuelle Netzdaten, "stale" = Sofort-Anzeige
// des letzten Stands während der Netzabruf läuft (Hinweis "Stand HH:MM"),
// "failed" = Netzabruf gescheitert, letzter Stand bleibt mit passendem Hinweis.
// Bewusst NICHT "offline": der Abruf kann auch an einem Serverfehler, einer
// Ratenbegrenzung oder einer Zeitüberschreitung scheitern, während die
// Verbindung des Nutzers einwandfrei ist. Den Grund trägt failReason.
// Der Typ liegt in lib/sectionState, weil die Sektionen ihre Sichtbarkeit
// daran entscheiden.

interface State {
  place: Place | null;
  forecast: Forecast | null;
  // Bewusst ohne localStorage Cache (kein eigener Key nötig): offline oder bei
  // API Ausfall zeigt die Pollensektion den passenden Hinweis, nie veraltete
  // Werte. Der Status trägt die Bedeutung, nicht mehr ein mehrdeutiges null.
  pollen: PollenResult;
  freshness: Freshness;
  // Grund des letzten gescheiterten Abrufs, nur bei freshness "failed" gesetzt.
  failReason: LoadErrorKind | null;
  updatedAt: string;
}

const state: State = { place: null, forecast: null, pollen: POLLEN_LOADING, freshness: "fresh", failReason: null, updatedAt: "" };

// Ist der Browser gerade online? navigator.onLine === false ist verlässlich für
// "keine Verbindung"; true heißt nur, dass eine Schnittstelle aktiv ist, nicht
// dass der Dienst erreichbar wäre. Genau diese Asymmetrie bildet
// classifyLoadError ab.
function isOnline(): boolean {
  return navigator.onLine !== false;
}

// Auto-Open des Stundendetail-Panels: bei JEDEM neuen Wetterdatenladen (neuer Ort
// via selectPlace ODER Refresh via refreshCurrentPlace) wird neu "armed", sodass
// der Detailkasten die aktuelle Stunde zeigt. Über den Cache→Netz-Doppelrender
// desselben Orts hinweg bleibt es armed, bis der erste aufgelöste Render
// (freshness "fresh"/"failed", nicht mehr "stale") wirklich geöffnet hat; danach
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
  // Fehler über die zentrale Ansage-Region (#weatherAnnounce) melden. Die
  // Erfolgsansage setzt renderContent nach setView("content"), den Ladehinweis
  // sagt #weatherLoading (role="status") beim Erscheinen selbst an. Fehlertext
  // aus #errorTitle — der Aufrufer setzt ihn VOR setView("error").
  if (view === "error") {
    byId("weatherAnnounce").textContent =
      document.getElementById("errorTitle")?.textContent ?? t("loadError");
  }
  // Ohne sichtbare Wetterkarte tickt auch keine Ortsuhr mehr (sonst liefe der
  // Timer bis zum nächsten Minutenwechsel weiter, s. CurrentWeather).
  if (view !== "content") stopLocalTimeTicker();
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

// Zusatzzeile unter dem Fehlertitel, heute nur für den gesuchten Ort aus einem
// geteilten Link. Bewusst OHNE data-i18n: der Inhalt ist Nutzereingabe, keine
// Übersetzung. Ein Sprachwechsel würde einen data-i18n Knoten über
// applyI18n mit t(key) überschreiben und die Eingabe damit zerstören.
function setErrorDetail(text: string): void {
  const el = document.getElementById("errorDetail");
  if (!el) return;
  el.textContent = text;
  el.hidden = text === "";
}

// Fehleransicht mit ehrlichem, zur Ursache passendem Titel. Der data-i18n Key
// wird mitgetauscht, damit ein Sprachwechsel im Fehlerzustand den richtigen
// Text behält.
function showErrorView(titleKey: string, detail = ""): void {
  const titleEl = document.getElementById("errorTitle");
  if (titleEl) {
    titleEl.setAttribute("data-i18n", titleKey);
    titleEl.textContent = t(titleKey);
  }
  setErrorDetail(detail);
  setView("error");
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
    f && state.freshness !== "failed" && state.updatedAt
      ? formatStampInZone(f.timezone, getLocale(), new Date(state.updatedAt)) ?? formatHour(state.updatedAt, getLocale())
      : null;
  if (time) {
    span.hidden = false;
    const text = t(state.freshness === "stale" ? "staleNote" : "freshNote").replace("{time}", time);
    if (span.textContent !== text) {
      span.textContent = text;
      // Neuer Stand: Caption kurz weich einblenden statt hart umzuspringen.
      span.classList.remove("stamp-fresh");
      void span.offsetWidth; // Reflow → Animation startet bei erneutem Add neu
      span.classList.add("stamp-fresh");
    }
  } else {
    span.textContent = "";
    span.hidden = true;
  }
}

// Die Knopfarten einer Favoritenzeile, in der Reihenfolge des Markups. Dient
// als Kennung, WELCHER Knopf fokussiert war — die Zeile selbst wird über
// data-id wiedergefunden.
const FAV_BUTTON_CLASSES = ["fav-row-select", "fav-row-up", "fav-row-down", "fav-row-x"] as const;

// Setzt den Fokus auf einen bestimmten Knopf einer Favoritenzeile. Liefert
// false, wenn es ihn nicht gibt oder er deaktiviert ist (Randposition), damit
// der Aufrufer ausweichen kann.
function focusFavoriteButton(placeId: number, cls: string): boolean {
  const row = document.querySelector<HTMLElement>(`#favoritesList .fav-row[data-id="${placeId}"]`);
  const btn = row?.querySelector<HTMLButtonElement>(`.${cls}`) ?? null;
  if (!btn || btn.disabled) return false;
  btn.focus();
  return true;
}

// renderFavoritesList ersetzt das gesamte innerHTML der Liste und zerstört
// dabei den fokussierten Knopf — der Fokus fällt auf <body>. Das trifft nicht
// nur das Umsortieren, sondern auch das Nachladen des Favoritenwetters im
// Hintergrund, das einem tabbenden Nutzer mitten in der Bedienung den Fokus
// wegzieht. Diese Hülle merkt sich, WAS fokussiert war, und stellt es wieder
// her. Bewusst nur, wenn der Fokus vorher wirklich in der Liste lag: sonst
// würde ein Hintergrundvorgang den Fokus ungefragt in die Favoriten ziehen.
function withFavoritesFocus(render: () => void): void {
  const list = document.getElementById("favoritesList");
  const active = document.activeElement as HTMLElement | null;
  const inside = list !== null && active !== null && active !== document.body && list.contains(active);
  const rowId = inside ? active.closest<HTMLElement>(".fav-row")?.dataset.id ?? null : null;
  const cls = inside ? FAV_BUTTON_CLASSES.find((name) => active.classList.contains(name)) ?? null : null;
  render();
  if (rowId === null || cls === null) return;
  focusFavoriteButton(Number(rowId), cls);
}

// Neue Position nach dem Umsortieren ansagen. Der bloße Fokuswechsel liest nur
// den Knopfnamen vor und verrät nicht, wohin die Zeile gewandert ist.
function announceFavoritePosition(place: Place): void {
  const list = getFavorites();
  const index = list.findIndex((p) => p.id === place.id);
  if (index === -1) return;
  byId("weatherAnnounce").textContent = t("favMovedAnnounce")
    .replace("{place}", place.name)
    .replace("{pos}", String(index + 1))
    .replace("{total}", String(list.length));
}

function renderFavorites(): void {
  withFavoritesFocus(paintFavorites);
}

function paintFavorites(): void {
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
      // Denselben Ort auch aus dem Forecast-Cache werfen. Der aktuell
      // angezeigte Ort bleibt dabei erhalten, auch wenn er gerade seinen
      // Favoritenstatus verloren hat: er ist der "+1"-Platz, und ohne ihn
      // stünde die offene Karte nach einem Neuladen wieder im Ladeskelett.
      pruneForecastCache([...getFavorites().map((p) => p.id), ...(state.place ? [state.place.id] : [])]);
      renderFavorites();
      renderContent();
      renderIcons();
      // Undo statt Bestätigungsdialog (UX Playbook): das Entfernen bleibt ein
      // Tipp, der Toast bietet den Rückweg. Kein Ortsname-Escaping nötig,
      // textContent im Toast.
      showToast(t("favRemovedToast").replace("{place}", place.name), {
        label: t("undo"),
        onAction: () => {
          const next = insertFavorite(place, idx);
          // insertFavorite gibt die Liste unverändert zurück, wenn das Limit
          // inzwischen erreicht ist (der Nutzer hat nach dem Entfernen einen
          // anderen Favoriten hinzugefügt). Ohne diese Prüfung scheitert
          // Rückgängig lautlos und der Nutzer hält es für erledigt.
          if (!next.some((p) => p.id === place.id)) {
            showToast(t("favUndoFailed").replace("{place}", place.name));
            return;
          }
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
      // Fokus gezielt auf DENSELBEN logischen Pfeil derselben Zeile, damit
      // mehrfaches Verschieben in einem Fluss bleibt. Ist dieser Pfeil an der
      // neuen Randposition deaktiviert (oberste bzw. unterste Zeile), auf den
      // Gegenpfeil derselben Zeile ausweichen — sonst fiele der Fokus auf
      // <body> und der Tastaturfluss wäre unterbrochen.
      if (!focusFavoriteButton(place.id, dir === "up" ? "fav-row-up" : "fav-row-down")) {
        focusFavoriteButton(place.id, dir === "up" ? "fav-row-down" : "fav-row-up");
      }
      announceFavoritePosition(place);
      // Die bewegte Zeile kurz hervorheben, damit das Auge ihr an die neue
      // Position folgen kann (der Neuaufbau der Liste springt sonst lautlos).
      // Frisch gerendert → Klasse einfach setzen, kein Reflow-Neustart nötig.
      document
        .querySelector<HTMLElement>(`#favoritesList .fav-row[data-id="${place.id}"]`)
        ?.classList.add("fav-row--moved");
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
  renderTodayHighlights(byId("todayHighlights"), byId("todayHighlightsHeading"), state.forecast);
  renderAirQuality(byId("airQuality"), byId("airQualityHeading"), state.forecast.airQuality);
  // freshness mitgeben: eine Entwarnung darf nur erscheinen, wenn der letzte
  // Abruf nicht gescheitert ist (siehe alertsSectionState).
  renderWeatherAlerts(byId("weatherAlerts"), byId("alertsHeading"), state.forecast.alerts, state.forecast.timezone, state.freshness);
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
  el.classList.remove("cards-revealing", "cards-settling");
  void el.offsetWidth; // erzwingt Reflow → Animation startet bei erneutem Add neu
  el.classList.add("cards-revealing");
}

// Leiser Bruder von revealCards für den manuellen Refresh: der Inhalt steht
// bereits, nur die Werte frischen auf — statt der vollen gestaffelten Kaskade
// (bis ~800ms) ein kurzes, gleichzeitiges Auffrisch-Blenden aller Karten.
// Gleicher Reflow-Neustart, gleiche Opt-in-Mechanik über CSS (reduced motion:
// Klasse wirkungslos, Inhalt bleibt voll sichtbar).
function settleCards(): void {
  const el = byId("weatherContent");
  el.classList.remove("cards-revealing", "cards-settling");
  void el.offsetWidth;
  el.classList.add("cards-settling");
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
    failReason: state.failReason,
  });
  const current = state.forecast.current;
  const announcedPlace = state.place.id === GEO_PLACE_ID ? t("myLocation") : state.place.name;
  byId("weatherAnnounce").textContent = t("weatherLoaded")
    .replace("{place}", announcedPlace)
    .replace("{temp}", formatTemp(current.temperature))
    .replace("{condition}", weatherLabel(getWmo(current.weatherCode).labelKey, getLang()));
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
    // Limit erreicht: Grund nennen und aussteigen. Der Stern trägt nur noch
    // aria-disabled, ist also klickbar — ohne diesen Zweig liefe der komplette
    // Erfolgspfad durch. addFavorite würde zwar still nichts tun (Guard in
    // favorites.ts), aber die Erfolgsanimation weiter unten würde ein Glühen
    // auf eine fehlgeschlagene Aktion legen. Steht deshalb VOR jedem Speichern,
    // Render und jeder Animation.
    if (wasAdded && getFavorites().length >= MAX_FAVORITES) {
      showToast(t("favLimit"));
      return;
    }
    // Der neue Chip soll genau die Werte zeigen, die in der Karte darüber
    // bereits stehen. Quelle ist der schon geladene Vollforecast DESSELBEN
    // Orts, also KEIN zusätzlicher Providerabruf.
    //
    // Ohne diese Spiegelung bleibt der Chip leer, bis irgendwann ein
    // Nachladelauf greift: cacheFavoriteWeather wird sonst nur in selectPlace
    // und refreshCurrentPlace aufgerufen, dort jeweils hinter isFavorite(),
    // ausgewertet zum ZEITPUNKT DES ABRUFS. Wer einen Ort erst öffnet und
    // danach favorisiert, war zum Abrufzeitpunkt kein Favorit und kann diese
    // Bedingung strukturell nie erreichen.
    //
    // Der Zeitstempel ist bewusst state.updatedAt und nicht "jetzt": ein aus
    // dem lokalen Forecast-Cache gezeigter Stand gälte sonst die volle TTL lang
    // als frisch, der reguläre Nachladelauf bliebe aus und der Chip zeigte
    // einen alten Wert als aktuellen. mirrorForNewFavorite meldet über
    // needsFetch, wenn der gespiegelte Stand dafür schon zu alt ist.
    let mirrorNeedsFetch = false;
    if (wasAdded) {
      addFavorite(place);
      const mirror = mirrorForNewFavorite(state.forecast, state.updatedAt);
      if (mirror.entry !== null) cacheFavoriteWeather(place.id, mirror.entry, mirror.entry.savedAt);
      mirrorNeedsFetch = mirror.needsFetch;
    } else {
      removeFavorite(place.id);
    }
    renderFavorites();
    renderContent();
    renderIcons();
    if (wasAdded) {
      document.getElementById("favToggle")?.classList.add("fav-toggle--added");
      // Nur wenn nichts Frisches gespiegelt werden konnte. refreshFavoritesWeather
      // holt dann ohnehin ausschließlich die wirklich veralteten Orte.
      if (mirrorNeedsFetch) loadFavoritesWeather();
    }
  });
  document.getElementById("shareBtn")?.addEventListener("click", shareCurrentWeather);
}

// Obergrenze für die Bilderzeugung. Der try/catch in shareImage.ts fängt Fehler,
// aber kein HÄNGEN: bliebe document.fonts.ready offen, käme die Kette nie zurück,
// sharing bliebe true und der Teilen-Knopf wäre bis zum Neuladen tot. 8 s liegen
// weit über der normalen Zeichendauer, der Rückfall ist Text-Teilen.
const SHARE_IMAGE_TIMEOUT_MS = 8000;

// Promise mit Zeitlimit: nach ms löst es mit null auf, statt weiter zu warten.
// Der Timer wird in beiden Fällen abgeräumt, damit kein verspätetes Feuern bleibt.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Liest EINMAL, was das Gerät kann. Die Probe für canShare ist absichtlich klein,
// aber NICHT leer: Null-Byte-Dateien werden von Browsern uneinheitlich behandelt
// und würden hier ein falsches Nein liefern. Sie wird nur gefragt, nie geteilt.
function readShareCapabilities(): ShareCapabilities {
  const hasShare = typeof navigator.share === "function";
  let canShareFiles = false;
  if (hasShare && typeof navigator.canShare === "function") {
    try {
      const probe = new File([new Uint8Array([0x89])], "weatherpure.png", { type: "image/png" });
      canShareFiles = navigator.canShare({ files: [probe] });
    } catch {
      canShareFiles = false; // wirft statt false zu liefern → wie nicht unterstützt
    }
  }
  return { hasShare, canShareFiles, hasClipboard: typeof navigator.clipboard?.writeText === "function" };
}

// Teilt das aktuell angezeigte Wetter. Bevorzugt ein handgezeichnetes PNG (mit
// Text + URL als Begleittext); kann das Gerät keine Dateien teilen, fällt es auf
// Text-Teilen zurück (alles in share.ts). EIN Knopf, ein Verhalten, Bild bevorzugt.
// Ohne geladene Daten ein No-op, kein Crash. URL: stadtspezifischer Deep-Link
// (?stadt=) für benannte Orte, kanonische Startseite für den Geo-Ort — dort NIE
// Koordinaten teilen (Datenschutzzusage); auch das Bild zeigt nur "Mein Standort".
// Die Fähigkeiten werden VOR der Bilderzeugung geprüft: ohne Abnehmer für eine
// Datei wird das 1080×1920-PNG gar nicht erst gezeichnet.
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

  // Kein Weg zum Teilen: ehrlich melden statt still enden. Vor dem Sperren des
  // Knopfes, hier gibt es nichts zu warten.
  const path = decideSharePath(readShareCapabilities());
  if (path === "unsupported") {
    showToast(t("share_failed"));
    return;
  }

  // Knopf während Font-ready + Zeichnen + toBlob kurz sperren (kein Doppel-Tap).
  const btn = document.getElementById("shareBtn") as HTMLButtonElement | null;
  sharing = true;
  if (btn) { btn.disabled = true; btn.classList.add("cw-share--busy"); }
  try {
    if (path === "image") {
      // Nur hier wird gezeichnet. null steht für alle drei Fehlschläge: Zeichnen
      // gescheitert, Zeichnen abgelehnt ODER Zeitlimit gerissen. Jedes Mal bleibt
      // der native Textpfad übrig, den es hier sicher gibt (image setzt hasShare
      // voraus). Das catch ist nötig, damit eine Ablehnung nicht am Toast vorbei
      // nach oben durchschlägt und das Teilen still enden lässt.
      const blob = await withTimeout(
        renderWeatherCard({ name, forecast, locale: getLocale(), lang: getLang() }).catch(() => null),
        SHARE_IMAGE_TIMEOUT_MS
      );
      if (blob) {
        const file = new File([blob], "weatherpure.png", { type: "image/png" });
        await shareImage(payload, file);
        return;
      }
    }
    // "native-text", "clipboard" und der Rückfall aus dem Bildpfad: shareText
    // nimmt den nativen Dialog, wenn es ihn gibt, sonst die Zwischenablage, und
    // meldet jeden Ausgang selbst (kopiert, gescheitert, Abbruch bleibt stumm).
    await shareText(payload);
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
      state.failReason = null;
      state.updatedAt = new Date().toISOString();
      // Stand dieses Orts ablegen (ein Eintrag je Ort). Der Geo-Ort wird in
      // putForecast selbst abgewiesen, der Guard hier ist die erste Linie.
      if (place.id !== GEO_PLACE_ID) {
        putForecast(place.id, place.latitude, place.longitude, forecast, state.updatedAt);
      }
      // Gratis-Update: aktueller Ort, wenn Favorit, ohne extra Call spiegeln.
      if (isFavorite(place.id)) {
        cacheFavoriteWeather(place.id, { temp: forecast.current.temperature, code: forecast.current.weatherCode, isDay: forecast.current.isDay });
      }
      renderContent(); // Karte frisch: neuer "Aktualisiert HH:MM"
      renderFavorites();
      renderIcons();
      settleCards(); // Refresh: kurzes Auffrischen statt voller Kaskade (die bleibt für Ortswechsel)
      // C) Der Aktualisieren-Button frischt auch die übrigen Favoriten auf
      // (batched, nur stale/missing). Der gerade gespiegelte Ort fällt dabei raus.
      loadFavoritesWeather();
    })
    .catch((err: unknown) => {
      if (mySeq !== loadSeq || state.place?.id !== place.id) return;
      if (state.forecast) {
        // Ehrlich benennen, woran es lag. Vorher stand hier für JEDEN Grund
        // "Keine Verbindung", auch bei Serverfehler oder Ratenbegrenzung.
        state.freshness = "failed";
        state.failReason = classifyLoadError(err, isOnline());
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
  // Ein bewusst gewählter Ort beendet eine offene Linkauflösung: der Erneut-
  // Knopf darf danach nicht mehr die alte Linksuche wiederholen.
  pendingCityQuery = "";
  // Neuer Ort = neue Wetterdaten: Stundendetail wieder scharf schalten und das
  // Tages-Detail auf Heute zurücksetzen, damit beide direkt aufgeklappt erscheinen.
  hourlyAutoOpenArmed = true;
  resetDailyPanelToToday();
  // Pollen GANZ HIER OBEN zurücksetzen, vor jedem Render. Stand der Reset
  // weiter unten beim Abruf, lief der Cache-Sofortrender noch mit den Werten
  // des VORHERIGEN Orts und zeigte sie kurz unter dem neuen Ortsnamen. Mit dem
  // Status "loading" bleibt die Sektion still, bis eine eigene Antwort da ist.
  state.pollen = POLLEN_LOADING;
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
  // Wahrheit. Seit dem Cache je Ort greift das auch beim Hin- und Herwechseln
  // zwischen Favoriten, wo vorher jeder Ort den anderen überschrieb.
  //
  // Zu alte Stände liefert getUsableForecast nicht mehr: eine tagealte
  // Vorhersage als "Stand" wäre irreführend. Dann greift online der frische
  // Abruf, offline der ehrliche Fehlerzustand. Für den Geo-Ort gibt es nie
  // einen Treffer, sein Standort wird nicht gespeichert (Datenschutzzusage).
  const usableCache = getUsableForecast(place.id);
  const showedFromCache = usableCache !== null;
  if (usableCache !== null) {
    state.forecast = usableCache.forecast;
    state.freshness = "stale";
    state.failReason = null;
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
  // nie und meldet den Ausgang als Status; die Sektion sagt danach ehrlich, ob
  // Werte vorliegen, keine verfügbar sind oder der Abruf gescheitert ist.
  // Zurückgesetzt wurde bereits ganz oben in dieser Funktion.
  fetchPollen(place.latitude, place.longitude).then((result) => {
    // Referenzgleichheit statt nur id: der Geo-Ort trägt immer id -1, aber jeder
    // "Mein Standort"-Klick erzeugt ein neues Place-Objekt. So wird eine überholte
    // Pollen-Antwort verworfen, ohne dass ein bloßer Refresh (gleiches Objekt,
    // kein erneuter Pollen-Abruf) die laufende Antwort fälschlich killt.
    if (state.place !== place || state.place?.id !== place.id) return;
    state.pollen = result;
    renderPollen();
  });

  fetchWeather(place.latitude, place.longitude)
    .then((forecast) => {
      if (mySeq !== loadSeq || state.place?.id !== place.id) return; // überholt oder anderer Ort
      state.forecast = forecast;
      state.freshness = "fresh";
      state.failReason = null;
      state.updatedAt = new Date().toISOString();
      if (!isGeoPlace) {
        putForecast(place.id, place.latitude, place.longitude, forecast, state.updatedAt);
      }
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
    .catch((err: unknown) => {
      if (mySeq !== loadSeq || state.place?.id !== place.id) return;
      const kind = classifyLoadError(err, isOnline());
      if (state.forecast && state.freshness === "stale") {
        // Sofort-Anzeige steht bereits: nur den Hinweis von "Stand HH:MM" auf
        // den zur Ursache passenden Hinweis umstellen, die Anzeige selbst
        // bleibt stehen.
        state.freshness = "failed";
        state.failReason = kind;
        renderContent();
        renderIcons();
      } else {
        // Nichts anzeigbar (kein Stand für diesen Ort): ehrliche Fehlermeldung,
        // die die tatsächliche Ursache benennt statt pauschal Offline.
        showErrorView(failTitleKey(kind));
      }
    });
}

// Der Ortsname aus einem geteilten Link, solange dessen Auflösung offen oder
// gescheitert ist. Solange er gesetzt ist, wiederholt der Erneut-Knopf GENAU
// DIESE Suche. Ohne ihn wäre der Knopf im Linkfehler wirkungslos, weil
// selectPlace nie lief und state.place damit leer ist.
let pendingCityQuery = "";

// Löst einen geteilten Ortslink auf.
//
// Kein stiller Rückfall auf den zuletzt gespeicherten Ort des Empfängers: das
// wäre fremdes Wetter, ausgegeben als das geteilte, ohne jeden Hinweis. Ein
// nicht auflösbarer Link führt deshalb in die Fehleransicht, nicht in eine
// andere Stadt.
function resolveCityLink(query: string): void {
  pendingCityQuery = query;
  setView("loading");
  searchCity(query, getLang())
    .then((places) => {
      const decision = decideLinkResolution(places, query);
      if (decision.kind === "none") {
        showErrorView("errorLinkNotFound", query);
        return;
      }
      pendingCityQuery = "";
      selectPlace(decision.place);
      if (decision.kind === "ambiguous") {
        // Mehrere gleichwertige Treffer: den tatsächlich gewählten Ort
        // bestätigen, statt ihn stillschweigend zu unterstellen. Der Toast ist
        // nur der Hinweis, DASS aufgelöst wurde; die dauerhafte Bestätigung ist
        // die Wetterkarte selbst, die Name, Region und Land zeigt. Reihenfolge
        // nicht garantiert: liegt kein Cache vor, zeigt selectPlace zunächst
        // nur die Ladeansicht und die Kartenansage folgt erst nach dem Abruf.
        const full = [decision.place.name, decision.place.admin1, decision.place.country]
          .filter(Boolean)
          .join(", ");
        showToast(t("linkResolvedToast").replace("{place}", full));
      }
    })
    .catch((err: unknown) => {
      showErrorView(failTitleKey(classifyLoadError(err, isOnline())), query);
    });
}

export function initApp(): void {
  // Altlasten aus früheren Versionen entfernen, in denen der Geolocation-Ort
  // noch in localStorage landen konnte (Favoriten, letzter Ort, Forecast-Cache).
  pruneGeoFavorites();
  if (readJson<Place>(LAST_PLACE_KEY)?.id === GEO_PLACE_ID) {
    localStorage.removeItem(LAST_PLACE_KEY);
  }
  // Räumt in einem Zug die alten Einzelforecast-Schlüssel weg, verwirft
  // Geo-Einträge und defekte Stände und entfernt abgelaufene Orte.
  pruneExpiredForecasts();
  localStorage.removeItem("weather:forecast-days");

  initSearchBar(byId("searchBar"), { onSelect: selectPlace });
  renderFavorites();
  renderEmptyCities();
  renderIcons();

  byId("retryBtn").addEventListener("click", () => {
    // Vorrang für den Linkpfad: dort lief selectPlace nie, state.place ist
    // leer, und der Knopf täte ohne diesen Zweig gar nichts.
    if (pendingCityQuery) resolveCityLink(pendingCityQuery);
    else if (state.place) selectPlace(state.place);
  });

  // Aktualisieren-Button steht statisch im Markup → Listener einmalig hier
  // (nicht in renderContent, sonst würde er bei jedem Render erneut gebunden).
  byId("topRefresh").addEventListener("click", refreshCurrentPlace);

  // Sprachwechsel: dynamische Bereiche mit neuen Labels/Locales neu rendern
  document.addEventListener("weather:langchange", () => {
    // Offene Trefferliste schließen: sie kam sprachspezifisch vom Server und
    // wäre nach dem Wechsel veraltet. Schließen ist ehrlicher als nachübersetzen.
    closeSearch();
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
    // Geteilter Link: eigener Weg mit ehrlichem Fehlerzustand. Der stadt
    // Parameter bleibt dabei in der URL stehen, damit Neuladen und Erneut
    // denselben Link nochmals versuchen.
    resolveCityLink(cityQuery);
  } else {
    // Normalstart ohne Parameter bleibt unverändert.
    restoreLastPlace();
  }

  // Favoriten-Wetter im Hintergrund nachladen (batched, nur stale/missing).
  // Bewusst nach dem Start-Render und losgelöst vom Haupt-Wetter-Flow: blockiert
  // weder Splash noch die Hauptkarte.
  loadFavoritesWeather();
}
