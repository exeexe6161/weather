// UI Sprachmechanik: data-i18n Attribute im statischen Markup,
// Sprachwahl in localStorage, live Umschaltung ohne Reload.

export type Lang = "de" | "en" | "tr";

export const LANGS: Lang[] = ["de", "en", "tr"];

// Locale für Datum/Zeit Formatierung (format.ts ist locale aware)
export const LOCALES: Record<Lang, string> = {
  de: "de-DE",
  en: "en-GB",
  tr: "tr-TR",
};

const LANG_KEY = "weather:lang";

export const uiLabels: Record<string, Record<Lang, string>> = {
  heroSubtitle:    { de: "Schlicht, schnell und ohne Tracking", en: "Simple, fast and without tracking", tr: "Sade, hızlı ve takipsiz" },
  settingsAria:    { de: "Einstellungen", en: "Settings", tr: "Ayarlar" },
  searchRegion:    { de: "Ortssuche", en: "Location search", tr: "Konum arama" },
  favoritesRegion: { de: "Favoriten", en: "Favorites", tr: "Favoriler" },
  weatherRegion:   { de: "Wetter", en: "Weather", tr: "Hava durumu" },
  searchLabel:     { de: "Stadt suchen", en: "Search city", tr: "Şehir ara" },
  searchPlaceholder: { de: "Stadt suchen, z. B. Berlin", en: "Search a city, e.g. London", tr: "Şehir ara, örn. İstanbul" },
  searchNoResults: { de: "Keine Treffer", en: "No results", tr: "Sonuç yok" },
  searchError:     { de: "Suche derzeit nicht möglich", en: "Search is currently unavailable", tr: "Arama şu anda kullanılamıyor" },
  geoBtn:          { de: "Meinen Standort verwenden", en: "Use my location", tr: "Konumumu kullan" },
  geoHint:         { de: "Optional. Dein Standort wird erst nach deiner Zustimmung im Browser abgefragt und nicht gespeichert.", en: "Optional. Your location is requested only after your consent in the browser and is not stored.", tr: "İsteğe bağlı. Konumun yalnızca onayından sonra tarayıcıda sorulur ve kaydedilmez." },
  geoDenied:       { de: "Standortfreigabe wurde abgelehnt", en: "Location permission was denied", tr: "Konum izni reddedildi" },
  geoFailed:       { de: "Standort konnte nicht ermittelt werden", en: "Location could not be determined", tr: "Konum belirlenemedi" },
  geoUnsupported:  { de: "Standortabfrage wird von diesem Browser nicht unterstützt", en: "Geolocation is not supported by this browser", tr: "Bu tarayıcı konum sorgusunu desteklemiyor" },
  myLocation:      { de: "Mein Standort", en: "My location", tr: "Konumum" },
  favHeading:      { de: "Favoriten", en: "Favorites", tr: "Favoriler" },
  favAdd:          { de: "Als Favorit speichern", en: "Save as favorite", tr: "Favori olarak kaydet" },
  favRemove:       { de: "Favorit entfernen", en: "Remove favorite", tr: "Favoriyi kaldır" },
  emptyTitle:      { de: "Suche eine Stadt für die Vorhersage", en: "Search a city to see the forecast", tr: "Tahmin için bir şehir ara" },
  emptySub:        { de: "Oder nutze deinen Standort über die Schaltfläche oben.", en: "Or use your location via the button above.", tr: "Veya yukarıdaki düğmeyle konumunu kullan." },
  loading:         { de: "Lade Wetterdaten…", en: "Loading weather data…", tr: "Hava verileri yükleniyor…" },
  loadError:       { de: "Wetterdaten konnten nicht geladen werden", en: "Weather data could not be loaded", tr: "Hava verileri yüklenemedi" },
  retry:           { de: "Erneut versuchen", en: "Try again", tr: "Tekrar dene" },
  offlineNote:     { de: "Keine Verbindung. Gespeicherte Daten werden angezeigt.", en: "No connection. Showing saved data.", tr: "Bağlantı yok. Kayıtlı veriler gösteriliyor." },
  updatedAt:       { de: "Zuletzt aktualisiert", en: "Last updated", tr: "Son güncelleme" },
  feelsLike:       { de: "Gefühlt", en: "Feels like", tr: "Hissedilen" },
  humidity:        { de: "Luftfeuchte", en: "Humidity", tr: "Nem" },
  wind:            { de: "Wind", en: "Wind", tr: "Rüzgar" },
  metric_rain_today: { de: "Regen heute", en: "Rain today", tr: "Bugün yağmur" },
  sun_rise:        { de: "Sonnenaufgang", en: "Sunrise", tr: "Gün doğumu" },
  sun_set:         { de: "Sonnenuntergang", en: "Sunset", tr: "Gün batımı" },
  uv_label:        { de: "UV Index", en: "UV index", tr: "UV endeksi" },
  uv_high:         { de: "Hoch, Sonnenschutz ratsam", en: "High, sun protection advisable", tr: "Yüksek, güneş koruması önerilir" },
  uv_very_high:    { de: "Sehr hoch, Mittagssonne meiden", en: "Very high, avoid midday sun", tr: "Çok yüksek, öğle güneşinden kaçın" },
  uv_extreme:      { de: "Extrem, Sonne meiden", en: "Extreme, avoid the sun", tr: "Aşırı yüksek, güneşten uzak dur" },
  dress_today:     { de: "Heute anziehen", en: "What to wear today", tr: "Bugün ne giymeli" },
  stage_shirt:     { de: "Shirt", en: "Shirt", tr: "Tişört" },
  stage_shirt_layer: { de: "Shirt, dünne Lage dabei", en: "Shirt, bring a thin layer", tr: "Tişört, yanında ince bir kat" },
  stage_light_jacket: { de: "Leichte Jacke", en: "Light jacket", tr: "İnce mont" },
  stage_jacket:    { de: "Jacke", en: "Jacket", tr: "Mont" },
  stage_heavy_jacket: { de: "Dicke Jacke", en: "Warm jacket", tr: "Kalın mont" },
  stage_winter:    { de: "Winterjacke und Schal", en: "Winter jacket and scarf", tr: "Kışlık mont ve atkı" },
  dress_until:     { de: "{stage} bis {time} Uhr, danach {next}", en: "{stage} until {time}:00, then {next}", tr: "{stage}, saat {time} itibarıyla {next}" },
  dress_add_rain:  { de: "Regenjacke oder Schirm", en: "Rain jacket or umbrella", tr: "Yağmurluk veya şemsiye" },
  rain_window:     { de: "Regen {prob} zwischen {from} und {to} Uhr", en: "Rain {prob} between {from}:00 and {to}:00", tr: "Saat {from} ile {to} arası yağmur {prob}" },
  rain_none:       { de: "Kein Regen erwartet", en: "No rain expected", tr: "Yağmur beklenmiyor" },
  rain_none_more:  { de: "Kein Regen mehr erwartet", en: "No more rain expected", tr: "Bugün için yağmur beklentisi kalmadı" },
  hourlyHeading:   { de: "Nächste 24 Stunden", en: "Next 24 hours", tr: "Sonraki 24 saat" },
  dailyHeading:    { de: "7 Tage Vorhersage", en: "7 day forecast", tr: "7 günlük tahmin" },
  today:           { de: "Heute", en: "Today", tr: "Bugün" },
  footerImpressum: { de: "Impressum", en: "Imprint", tr: "Künye" },
  footerDatenschutz: { de: "Datenschutz", en: "Privacy", tr: "Gizlilik" },
  footerNote:      { de: "Keine Werbung, kein Tracking. Favoriten bleiben lokal im Browser.", en: "No ads, no tracking. Favorites stay local in your browser.", tr: "Reklam yok, takip yok. Favoriler tarayıcında yerel kalır." },
  footerAttributionPrefix: { de: "Wetterdaten von", en: "Weather data by", tr: "Hava verileri" },
  noscriptText:    { de: "Diese App benötigt JavaScript. Bitte aktiviere JavaScript in deinem Browser.", en: "This app requires JavaScript. Please enable JavaScript in your browser.", tr: "Bu uygulama JavaScript gerektirir. Lütfen tarayıcında JavaScript etkinleştir." },
  themeAria:       { de: "Farbschema wechseln", en: "Switch color scheme", tr: "Renk düzenini değiştir" },
  langAria:        { de: "Sprache wechseln", en: "Change language", tr: "Dili değiştir" },
  resultsAria:     { de: "Suchergebnisse", en: "Search results", tr: "Arama sonuçları" },
};

let current: Lang = "de";

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "de" || saved === "en" || saved === "tr") return saved;
  } catch {}
  const nav = (navigator.language || "de").slice(0, 2).toLowerCase();
  return nav === "de" ? "de" : nav === "tr" ? "tr" : "en";
}

export function getLang(): Lang {
  return current;
}

export function getLocale(): string {
  return LOCALES[current];
}

export function t(key: string): string {
  return uiLabels[key]?.[current] ?? key;
}

export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) (el as HTMLInputElement).placeholder = t(key);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key) el.setAttribute("aria-label", t(key));
  });
}

export function setLang(lang: Lang): void {
  current = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  document.documentElement.lang = lang;
  applyI18n();
  document.dispatchEvent(new CustomEvent("weather:langchange", { detail: { lang } }));
}

export function initLang(): void {
  current = detectLang();
  document.documentElement.lang = current;
  applyI18n();
}
