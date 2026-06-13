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
  docTitle:        { de: "WeatherPure – Wetter auf das Wesentliche", en: "WeatherPure – Weather, simply essential", tr: "WeatherPure – Sadece önemli olan" },
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
  geoHint:         { de: "Nur nach deiner Zustimmung, dein Standort wird nicht gespeichert.", en: "Only with your consent, your location is never stored.", tr: "Yalnızca senin onayınla, konumun kaydedilmez." },
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
  staleNote:       { de: "Stand {time}", en: "As of {time}", tr: "{time} itibarıyla" },
  freshNote:       { de: "Aktualisiert {time}", en: "Updated {time}", tr: "{time} itibarıyla güncel" },
  install_title_prompt: { de: "WeatherPure installieren", en: "Install WeatherPure", tr: "WeatherPure'u yükle" },
  install_text_prompt:  { de: "Für schnellen Zugriff zum Home Bildschirm hinzufügen.", en: "Add it to your home screen for quick access.", tr: "Hızlı erişim için ana ekrana ekle." },
  install_button:       { de: "Installieren", en: "Install", tr: "Yükle" },
  install_title_ios:    { de: "WeatherPure zum Home Bildschirm", en: "Add WeatherPure to your home screen", tr: "WeatherPure'u ana ekrana ekle" },
  install_text_ios:     { de: "Tippe auf Teilen und dann auf Zum Home Bildschirm.", en: "Tap Share, then Add to Home Screen.", tr: "Paylaş simgesine, sonra Ana Ekrana Ekle'ye dokun." },
  install_dismiss:      { de: "Hinweis schließen", en: "Dismiss", tr: "Kapat" },
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
  pollen_title:    { de: "Pollen", en: "Pollen", tr: "Polen" },
  pollen_alder:    { de: "Erle", en: "Alder", tr: "Kızılağaç" },
  pollen_birch:    { de: "Birke", en: "Birch", tr: "Huş ağacı" },
  pollen_grass:    { de: "Gräser", en: "Grass", tr: "Çimen" },
  pollen_mugwort:  { de: "Beifuß", en: "Mugwort", tr: "Pelin otu" },
  pollen_olive:    { de: "Olive", en: "Olive", tr: "Zeytin" },
  pollen_ragweed:  { de: "Ambrosia", en: "Ragweed", tr: "Ambrosya" },
  pollen_low:      { de: "Gering", en: "Low", tr: "Düşük" },
  pollen_moderate: { de: "Mittel", en: "Moderate", tr: "Orta" },
  pollen_high:     { de: "Hoch", en: "High", tr: "Yüksek" },
  // ── Tageszusammenfassung, Ebene 1: fertige Sätze (exakt, nicht umformulieren)
  sum1_mild_sunny_day:    { de: "Mild und sonnig, zieh am Abend was über.", en: "Mild and sunny, take a layer for the evening.", tr: "Hava ılık ve güneşli, akşama bir şeyler al yanına." },
  sum1_mild_changeable:   { de: "Mild und wechselhaft.", en: "Mild and changeable.", tr: "Hava ılık ve değişken." },
  sum1_mild_grey:         { de: "Mild, aber grau.", en: "Mild but grey.", tr: "Hava ılık ama kapalı." },
  sum1_warm_sunny:        { de: "Warm und sonnig.", en: "Warm and sunny.", tr: "Hava sıcak ve güneşli." },
  sum1_warm_sunny_uv:     { de: "Warm und sonnig, denk an Sonnenschutz.", en: "Warm and sunny, remember sun protection.", tr: "Hava sıcak ve güneşli, güneşten korunmayı unutma." },
  sum1_hot_dry:           { de: "Heiß und trocken, viel trinken.", en: "Hot and dry, drink plenty.", tr: "Hava sıcak ve kurak, bol su iç." },
  sum1_hot_humid:         { de: "Schwül und drückend.", en: "Humid and heavy.", tr: "Hava nemli ve bunaltıcı." },
  sum1_cool_friendly:     { de: "Kühl, aber freundlich.", en: "Cool but pleasant.", tr: "Hava serin ama hoş." },
  sum1_cool_cloudy:       { de: "Kühl und wolkig.", en: "Cool and cloudy.", tr: "Hava serin ve bulutlu." },
  sum1_cool_rain_later:   { de: "Kühl und wolkig, später Regen, nimm einen Schirm mit.", en: "Cool and cloudy, rain later, take an umbrella.", tr: "Hava serin ve bulutlu, sonra yağmur var, yanına şemsiye al." },
  sum1_cold_dry:          { de: "Kalt, aber trocken.", en: "Cold but dry.", tr: "Hava soğuk ama kuru." },
  sum1_cold_overcast:     { de: "Kalt und bedeckt, warm anziehen.", en: "Cold and overcast, wrap up warm.", tr: "Hava soğuk ve kapalı, sıcak giyin." },
  sum1_frosty_clear:      { de: "Frostig und klar, warm anziehen.", en: "Frosty and clear, wrap up warm.", tr: "Hava ayazlı ve açık, sıcak giyin." },
  sum1_rain_mild:         { de: "Mild und regnerisch, nimm einen Schirm mit.", en: "Mild and rainy, take an umbrella.", tr: "Hava ılık ve yağmurlu, yanına şemsiye al." },
  sum1_rain_over_evening: { de: "Mild, ab dem Abend trocken.", en: "Mild, drying up this evening.", tr: "Hava ılık, akşama doğru açıyor." },
  sum1_thunder_humid:     { de: "Schwül und drückend, später Gewitter, nimm einen Schirm mit.", en: "Humid and heavy, storms later, take an umbrella.", tr: "Hava nemli ve bunaltıcı, sonra fırtına var, yanına şemsiye al." },
  sum1_mild_windy:        { de: "Mild und windig.", en: "Mild and windy.", tr: "Hava ılık ve rüzgârlı." },
  sum1_night_mild_clear:  { de: "Milde, klare Nacht.", en: "A mild, clear night.", tr: "Ilık ve açık bir gece." },
  sum1_night_cold:        { de: "Kalte, klare Nacht.", en: "A cold, clear night.", tr: "Soğuk ve açık bir gece." },
  // ── Tageszusammenfassung, Ebene 2: Bausteine (Muster + Wörter, exakt)
  sum_pattern:     { de: "{t} und {s}", en: "{t} and {s}", tr: "Hava {t} ve {s}" },
  sum_t_frosty:    { de: "frostig", en: "frosty", tr: "ayazlı" },
  sum_t_cold:      { de: "kalt", en: "cold", tr: "soğuk" },
  sum_t_cool:      { de: "kühl", en: "cool", tr: "serin" },
  sum_t_mild:      { de: "mild", en: "mild", tr: "ılık" },
  sum_t_warm:      { de: "warm", en: "warm", tr: "sıcak" },
  sum_t_hot:       { de: "heiß", en: "hot", tr: "sıcak" },
  sum_s_sunny:     { de: "sonnig", en: "sunny", tr: "güneşli" },
  sum_s_friendly:  { de: "freundlich", en: "pleasant", tr: "hoş" },
  sum_s_changeable:{ de: "wechselhaft", en: "changeable", tr: "değişken" },
  sum_s_cloudy:    { de: "wolkig", en: "cloudy", tr: "bulutlu" },
  sum_s_overcast:  { de: "bedeckt", en: "overcast", tr: "kapalı" },
  sum_s_grey:      { de: "grau", en: "grey", tr: "kapalı" },
  sum_x_rain_later:   { de: "später Regen", en: "rain later", tr: "sonra yağmur var" },
  sum_x_windy:        { de: "windig", en: "windy", tr: "rüzgârlı" },
  sum_x_thunder_later:{ de: "später Gewitter", en: "storms later", tr: "sonra fırtına var" },
  sum_c_evening_layer:{ de: "zieh am Abend was über", en: "take a layer for the evening", tr: "akşama bir şeyler al yanına" },
  sum_c_umbrella:     { de: "nimm einen Schirm mit", en: "take an umbrella", tr: "yanına şemsiye al" },
  sum_c_sun:          { de: "denk an Sonnenschutz", en: "remember sun protection", tr: "güneşten korunmayı unutma" },
  sum_c_warm:         { de: "warm anziehen", en: "wrap up warm", tr: "sıcak giyin" },
  // ── Vergleich zu gestern (Texte exakt, nicht umformulieren)
  cmp_much_warmer: { de: "Deutlich wärmer als gestern", en: "Much warmer than yesterday", tr: "Dünden çok daha sıcak" },
  cmp_bit_warmer:  { de: "Etwas wärmer als gestern", en: "A bit warmer than yesterday", tr: "Dünden biraz daha sıcak" },
  cmp_bit_cooler:  { de: "Etwas kühler als gestern", en: "A bit cooler than yesterday", tr: "Dünden biraz daha serin" },
  cmp_much_cooler: { de: "Deutlich kühler als gestern", en: "Much cooler than yesterday", tr: "Dünden çok daha serin" },
  dress_today:     { de: "Heute anziehen", en: "What to wear today", tr: "Bugün ne giymeli" },
  stage_shirt:     { de: "Shirt", en: "Shirt", tr: "Tişört" },
  stage_shirt_layer: { de: "Shirt und etwas Leichtes", en: "Shirt and something light", tr: "Tişört ve ince bir şey" },
  stage_light_jacket: { de: "Leichte Jacke", en: "Light jacket", tr: "İnce ceket" },
  stage_jacket:    { de: "Jacke", en: "Jacket", tr: "Ceket" },
  stage_heavy_jacket: { de: "Warme Jacke", en: "Warm jacket", tr: "Kalın ceket" },
  stage_winter:    { de: "Winterjacke", en: "Winter jacket", tr: "Kışlık ceket" },
  dress_until:     { de: "{stage} bis {time} Uhr, danach {next}", en: "{stage} until {time}:00, then {next}", tr: "{stage}, saat {time} itibarıyla {next}" },
  dress_add_rain:  { de: "Regenjacke oder Schirm", en: "Rain jacket or umbrella", tr: "Yağmurluk veya şemsiye" },
  rain_window:     { de: "Regen {prob} zwischen {from} und {to} Uhr", en: "Rain {prob} between {from}:00 and {to}:00", tr: "Saat {from} ile {to} arası yağmur {prob}" },
  rain_none:       { de: "Kein Regen erwartet", en: "No rain expected", tr: "Yağmur beklenmiyor" },
  rain_none_more:  { de: "Kein Regen mehr erwartet", en: "No more rain expected", tr: "Bugün için yağmur beklentisi kalmadı" },
  dry_window:      { de: "Trockenes Fenster {von} bis {bis} Uhr.", en: "Dry window {von} to {bis}.", tr: "{von} ile {bis} arası kuru." },
  dry_from:        { de: "Ab {von} Uhr trocken.", en: "Dry from {von}.", tr: "{von} sonrası kuru." },
  hourlyHeading:   { de: "Nächste 24 Stunden", en: "Next 24 hours", tr: "Sonraki 24 saat" },
  // ── Temperaturverlauf (ruhige Linie unter der Stundenleiste)
  tc_aria:         { de: "Gefühlte Temperatur der nächsten 24 Stunden", en: "Apparent temperature for the next 24 hours", tr: "Önümüzdeki 24 saatin hissedilen sıcaklığı" },
  tc_heading:      { de: "Gefühlte Temperatur · 24 Stunden", en: "Apparent temperature · 24 hours", tr: "Hissedilen sıcaklık · 24 saat" },
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
  document.title = t("docTitle"); // Tab-Titel wechselt mit der App-Sprache
  applyI18n();
  document.dispatchEvent(new CustomEvent("weather:langchange", { detail: { lang } }));
}

export function initLang(): void {
  current = detectLang();
  document.documentElement.lang = current;
  document.title = t("docTitle");
  applyI18n();
}
