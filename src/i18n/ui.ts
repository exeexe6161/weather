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

// Die Rechtsseiten liegen als je drei Dateien nebeneinander: Deutsch ist die
// Basis ohne Suffix, EN und TR tragen -en bzw. -tr (dieselbe Konvention, nach
// der theme-init.js auf den Seiten selbst umleitet). Bewusst ein enger Union-
// Typ statt string: die Funktion baut einen Pfad, ein beliebiger String hätte
// hier nichts zu suchen.
export type LegalBase = "impressum" | "datenschutz";

export function legalHref(base: LegalBase, lang: Lang): string {
  return lang === "de" ? `./${base}` : `./${base}-${lang}`;
}

export const uiLabels: Record<string, Record<Lang, string>> = {
  docTitle:        { de: "WeatherPure: Wetter auf das Wesentliche", en: "WeatherPure – Weather, simply essential", tr: "WeatherPure – Sadece önemli olan" },
  heroSubtitle:    { de: "Schlicht, schnell und klar", en: "Simple, fast and clear", tr: "Sade, hızlı ve net" },
  settingsAria:    { de: "Einstellungen", en: "Settings", tr: "Ayarlar" },
  searchRegion:    { de: "Ortssuche", en: "Location search", tr: "Konum arama" },
  favoritesRegion: { de: "Favoriten", en: "Favorites", tr: "Favoriler" },
  weatherRegion:   { de: "Wetter", en: "Weather", tr: "Hava durumu" },
  searchLabel:     { de: "Stadt suchen", en: "Search city", tr: "Şehir ara" },
  searchPlaceholder: { de: "Stadt suchen, z. B. Berlin", en: "Search a city, e.g. London", tr: "Şehir ara, örn. İstanbul" },
  searchNoResults: { de: "Keine Treffer", en: "No results", tr: "Sonuç yok" },
  // Trefferzahl in der Statusregion der Suche. Zwei Keys, weil Englisch im
  // Singular "result" ohne s braucht; DE und TR sind in beiden Fällen gleich.
  // Beide tragen {n}, damit die Platzhalterprüfung in uiLabels.test.ts greift.
  searchResultsOne: { de: "{n} Treffer", en: "{n} result", tr: "{n} sonuç" },
  searchResultsMany: { de: "{n} Treffer", en: "{n} results", tr: "{n} sonuç" },
  searchClear:     { de: "Suche leeren", en: "Clear search", tr: "Aramayı temizle" },
  searchLoading:   { de: "Suche läuft…", en: "Searching…", tr: "Aranıyor…" },
  searchError:     { de: "Suche derzeit nicht möglich", en: "Search is currently unavailable", tr: "Arama şu anda kullanılamıyor" },
  geoBtn:          { de: "Mein Standort", en: "My location", tr: "Konumum" },
  geoHint:         { de: "Nur mit Zustimmung. Nicht dauerhaft gespeichert; an WeatherAPI übertragen.", en: "Only with consent. Not stored permanently; sent to WeatherAPI.", tr: "Yalnızca onayla. Kalıcı olarak saklanmaz; WeatherAPI'ye iletilir." },
  geoDenied:       { de: "Standortzugriff abgelehnt. Suche eine Stadt oder erlaube den Zugriff in den Einstellungen.", en: "Location access denied. Search for a city or allow access in Settings.", tr: "Konum erişimi reddedildi. Bir şehir ara veya Ayarlar'dan erişime izin ver." },
  geoFailed:       { de: "Standort nicht verfügbar. Suche stattdessen eine Stadt.", en: "Location is unavailable. Search for a city instead.", tr: "Konum kullanılamıyor. Bunun yerine bir şehir ara." },
  geoUnsupported:  { de: "Standort wird hier nicht unterstützt. Suche stattdessen eine Stadt.", en: "Location is not supported here. Search for a city instead.", tr: "Konum burada desteklenmiyor. Bunun yerine bir şehir ara." },
  myLocation:      { de: "Mein Standort", en: "My location", tr: "Konumum" },
  favHeading:      { de: "Favoriten", en: "Favorites", tr: "Favoriler" },
  favAdd:          { de: "Als Favorit speichern", en: "Save as favorite", tr: "Favori olarak kaydet" },
  favRemove:       { de: "Favorit entfernen", en: "Remove favorite", tr: "Favoriyi kaldır" },
  favLimit:        { de: "Maximal 5 Favoriten", en: "Maximum 5 favorites", tr: "En fazla 5 favori" },
  favRemovedToast: { de: "Favorit entfernt: {place}", en: "Favorite removed: {place}", tr: "Favori kaldırıldı: {place}" },
  undo:            { de: "Rückgängig", en: "Undo", tr: "Geri al" },
  favSelectAria:   { de: "Wetter für {place} anzeigen", en: "Show weather for {place}", tr: "{place} için hava durumunu göster" },
  // Position im Namen: ohne sie liest ein Screenreader nur "nach oben" vor und
  // der Nutzer erfährt nicht, wo er gerade steht und wohin es geht.
  favMoveUp:       { de: "{place} nach oben, Position {pos} von {total}", en: "Move {place} up, position {pos} of {total}", tr: "{place} yukarı taşı, {total} içinde {pos}. sıra" },
  favMoveDown:     { de: "{place} nach unten, Position {pos} von {total}", en: "Move {place} down, position {pos} of {total}", tr: "{place} aşağı taşı, {total} içinde {pos}. sıra" },
  favMovedAnnounce: { de: "{place} ist jetzt Position {pos} von {total}", en: "{place} is now position {pos} of {total}", tr: "{place} şimdi {total} içinde {pos}. sırada" },
  favUndoFailed:   { de: "{place} konnte nicht zurückgeholt werden. Die Favoritenliste ist voll.", en: "{place} could not be restored. The favorites list is full.", tr: "{place} geri getirilemedi. Favori listesi dolu." },
  share_aria:      { de: "Wetter teilen", en: "Share weather", tr: "Hava durumunu paylaş" },
  share_copied:    { de: "In die Zwischenablage kopiert", en: "Copied to clipboard", tr: "Panoya kopyalandı" },
  // Teilen endet nie stumm: gescheiterter Zwischenablagezugriff und ein Gerät
  // ganz ohne Teilen-Weg melden sich, der Bilddownload bestätigt sich.
  // Der bewusste Abbruch des nativen Dialogs bleibt bewusst ohne Rückmeldung.
  share_failed:    { de: "Teilen ist hier nicht möglich", en: "Sharing is not available here", tr: "Burada paylaşım mümkün değil" },
  share_downloaded: { de: "Bild gespeichert", en: "Image saved", tr: "Görsel kaydedildi" },
  emptyTitle:      { de: "Suche eine Stadt für die Vorhersage", en: "Search a city to see the forecast", tr: "Tahmin için bir şehir ara" },
  emptySub:        { de: "Oder nutze deinen Standort über die Schaltfläche oben.", en: "Or use your location via the button above.", tr: "Veya yukarıdaki düğmeyle konumunu kullan." },
  loading:         { de: "Lade Wetterdaten…", en: "Loading weather data…", tr: "Hava verileri yükleniyor…" },
  loadError:       { de: "Wetterdaten konnten nicht geladen werden", en: "Weather data could not be loaded", tr: "Hava verileri yüklenemedi" },
  errorOffline:    { de: "Du bist offline. Stelle eine Verbindung her.", en: "You are offline. Please reconnect.", tr: "Çevrimdışısın. Bağlantı kur." },
  // Fehlertitel nach Ursache. Kontingentende und Providerausfall kommen beide
  // als 5xx an und teilen sich deshalb bewusst errorServer: der Text ist für
  // beide Fälle wahr.
  errorTimeout:    { de: "Die Antwort hat zu lange gedauert. Bitte erneut versuchen.", en: "The response took too long. Please try again.", tr: "Yanıt çok uzun sürdü. Lütfen tekrar dene." },
  errorRateLimit:  { de: "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.", en: "Too many requests. Please wait a moment and try again.", tr: "Çok fazla istek. Lütfen biraz bekleyip tekrar dene." },
  errorServer:     { de: "Der Wetterdienst ist gerade nicht erreichbar. Bitte später erneut versuchen.", en: "The weather service is currently unavailable. Please try again later.", tr: "Hava durumu servisine şu anda ulaşılamıyor. Lütfen daha sonra tekrar dene." },
  errorLinkNotFound: { de: "Der Ort aus dem Link wurde nicht gefunden", en: "The location from the link was not found", tr: "Bağlantıdaki konum bulunamadı" },
  retry:           { de: "Erneut versuchen", en: "Try again", tr: "Tekrar dene" },
  offlineNote:     { de: "Keine Verbindung. Gespeicherte Daten werden angezeigt.", en: "No connection. Showing saved data.", tr: "Bağlantı yok. Kayıtlı veriler gösteriliyor." },
  // Hinweis in der Wetterkarte, wenn gespeicherte Daten weiter angezeigt
  // werden. Nur offlineNote darf von fehlender Verbindung sprechen.
  failTimeout:     { de: "Die Antwort hat zu lange gedauert. Gespeicherte Daten werden angezeigt.", en: "The response took too long. Showing saved data.", tr: "Yanıt çok uzun sürdü. Kayıtlı veriler gösteriliyor." },
  failRateLimit:   { de: "Zu viele Anfragen. Gespeicherte Daten werden angezeigt.", en: "Too many requests. Showing saved data.", tr: "Çok fazla istek. Kayıtlı veriler gösteriliyor." },
  failServer:      { de: "Der Wetterdienst ist gerade nicht erreichbar. Gespeicherte Daten werden angezeigt.", en: "The weather service is currently unavailable. Showing saved data.", tr: "Hava durumu servisine şu anda ulaşılamıyor. Kayıtlı veriler gösteriliyor." },
  failUnknown:     { de: "Aktualisieren war gerade nicht möglich. Gespeicherte Daten werden angezeigt.", en: "Refreshing was not possible just now. Showing saved data.", tr: "Şu anda yenileme yapılamadı. Kayıtlı veriler gösteriliyor." },
  linkResolvedToast: { de: "Aus dem Link geöffnet: {place}", en: "Opened from the link: {place}", tr: "Bağlantıdan açıldı: {place}" },
  staleNote:       { de: "Stand {time}", en: "As of {time}", tr: "{time} itibarıyla" },
  freshNote:       { de: "Aktualisiert {time}", en: "Updated {time}", tr: "{time} itibarıyla güncel" },
  weatherLoaded:   { de: "Wetter für {place} geladen: {temp}, {condition}", en: "Weather for {place} loaded: {temp}, {condition}", tr: "{place} için hava durumu yüklendi: {temp}, {condition}" },
  nowShort:        { de: "jetzt", en: "now", tr: "şimdi" },
  refreshWeather:  { de: "Wetterdaten aktualisieren", en: "Refresh weather data", tr: "Hava verilerini yenile" },
  refreshShort:    { de: "Aktualisieren", en: "Refresh", tr: "Yenile" },
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
  moon_label:      { de: "Mondphase", en: "Moon phase", tr: "Ay evresi" },
  moon_rise:       { de: "Mondaufgang", en: "Moonrise", tr: "Ay doğuşu" },
  moon_set:        { de: "Monduntergang", en: "Moonset", tr: "Ay batışı" },
  moon_illumination: { de: "{percent} % beleuchtet", en: "{percent} % illuminated", tr: "%{percent} aydınlık" },
  uv_high:         { de: "Hoch, Sonnenschutz ratsam", en: "High, sun protection advisable", tr: "Yüksek, güneş koruması önerilir" },
  uv_very_high:    { de: "Sehr hoch, Mittagssonne möglichst meiden", en: "Very high, avoid midday sun if you can", tr: "Çok yüksek, mümkünse öğle güneşinden kaçın" },
  uv_extreme:      { de: "Extrem, Sonne möglichst meiden", en: "Extreme, avoid direct sun if you can", tr: "Aşırı yüksek, mümkünse güneşten uzak dur" },
  pollen_title:    { de: "Pollen aktuell", en: "Pollen now", tr: "Güncel polen" },
  pollen_alder:    { de: "Erle", en: "Alder", tr: "Kızılağaç" },
  pollen_birch:    { de: "Birke", en: "Birch", tr: "Huş ağacı" },
  pollen_grass:    { de: "Gräser", en: "Grass", tr: "Çimen" },
  pollen_mugwort:  { de: "Beifuß", en: "Mugwort", tr: "Pelin otu" },
  pollen_hazel:    { de: "Hasel", en: "Hazel", tr: "Fındık" },
  pollen_oak:      { de: "Eiche", en: "Oak", tr: "Meşe" },
  pollen_ragweed:  { de: "Ambrosia", en: "Ragweed", tr: "Ambrosya" },
  pollen_low:      { de: "Gering", en: "Low", tr: "Düşük" },
  pollen_moderate: { de: "Mittel", en: "Moderate", tr: "Orta" },
  pollen_high:     { de: "Hoch", en: "High", tr: "Yüksek" },
  // Leerzustände der Pollensektion. Nur pollen_none_notable ist eine
  // Entwarnung, und sie erscheint ausschließlich, wenn echte Messwerte
  // vorliegen und alle unter der Anzeigeschwelle bleiben. Die beiden anderen
  // Texte sprechen bewusst nur über Verfügbarkeit: sie behaupten weder eine
  // Abdeckungslücke des Anbieters noch das Ausbleiben von Pollen, und geben
  // keinerlei gesundheitliche Einschätzung.
  pollen_none_notable: { de: "Aktuell keine nennenswerte Belastung.", en: "No notable pollen levels right now.", tr: "Şu anda kayda değer polen yok." },
  pollen_unavailable: { de: "Für diese Region sind derzeit keine Pollendaten verfügbar.", en: "No pollen data is available for this region right now.", tr: "Bu bölge için şu anda polen verisi mevcut değil." },
  pollen_failed:   { de: "Pollendaten konnten nicht geladen werden.", en: "Pollen data could not be loaded.", tr: "Polen verileri yüklenemedi." },
  air_quality_title: { de: "Luftqualität", en: "Air quality", tr: "Hava kalitesi" },
  aqi_index:       { de: "Luftqualitätsindex", en: "Air quality index", tr: "Hava kalitesi indeksi" },
  aqi_calm:        { de: "Aktuell unauffällig", en: "Currently unremarkable", tr: "Şu anda dikkat çekmiyor" },
  aqi_details_show: { de: "Details anzeigen", en: "Show details", tr: "Detayları göster" },
  aqi_details_hide: { de: "Details ausblenden", en: "Hide details", tr: "Detayları gizle" },
  aqi_measurements: { de: "Messwerte", en: "Measurements", tr: "Ölçümler" },
  aqi_pm25:        { de: "Feinstaub PM2.5", en: "Fine particles PM2.5", tr: "İnce partikül PM2.5" },
  aqi_pm10:        { de: "Feinstaub PM10", en: "Fine particles PM10", tr: "İnce partikül PM10" },
  aqi_o3:          { de: "Ozon O₃", en: "Ozone O₃", tr: "Ozon O₃" },
  aqi_no2:         { de: "Stickstoffdioxid NO₂", en: "Nitrogen dioxide NO₂", tr: "Azot dioksit NO₂" },
  aqi_so2:         { de: "Schwefeldioxid SO₂", en: "Sulphur dioxide SO₂", tr: "Kükürt dioksit SO₂" },
  aqi_co:          { de: "Kohlenmonoxid CO", en: "Carbon monoxide CO", tr: "Karbon monoksit CO" },
  aqi_hint_sensitive: { de: "Empfindliche Personen: längere Anstrengung im Freien etwas reduzieren", en: "Sensitive groups: ease up on longer outdoor exertion", tr: "Hassas kişiler: uzun süreli açık hava eforunu biraz azaltın" },
  aqi_hint_unhealthy: { de: "Längere Anstrengung im Freien reduzieren", en: "Reduce prolonged outdoor exertion", tr: "Uzun süreli açık hava eforunu azaltın" },
  aqi_hint_severe:    { de: "Anstrengung im Freien möglichst meiden", en: "Avoid prolonged outdoor exertion", tr: "Açık havada uzun süreli efordan mümkünse kaçının" },
  aqi_good:        { de: "Gut", en: "Good", tr: "İyi" },
  aqi_moderate:    { de: "Mäßig", en: "Moderate", tr: "Orta" },
  aqi_sensitive:   { de: "Ungünstig für empfindliche Personen", en: "Unhealthy for sensitive groups", tr: "Hassas gruplar için sağlıksız" },
  aqi_unhealthy:   { de: "Ungesund", en: "Unhealthy", tr: "Sağlıksız" },
  aqi_very_unhealthy: { de: "Sehr ungesund", en: "Very unhealthy", tr: "Çok sağlıksız" },
  aqi_hazardous:   { de: "Gefährlich", en: "Hazardous", tr: "Tehlikeli" },
  alerts_title:    { de: "Wetterwarnungen", en: "Weather alerts", tr: "Hava uyarıları" },
  // Entwarnung. Erscheint nur, wenn der letzte Wetterabruf nicht gescheitert
  // ist. Bewusst ohne Absolutheit ("keine Warnungen bekannt" wäre schwächer,
  // "garantiert keine Gefahr" wäre falsch); der darunter stehende alert_note
  // verweist zusätzlich auf die amtlichen Stellen.
  alerts_none:     { de: "Aktuell keine Wetterwarnungen.", en: "No weather alerts right now.", tr: "Şu anda hava uyarısı yok." },
  // Gegenstück für den gescheiterten Abruf: der angezeigte Stand enthält keine
  // Warnung, bestätigen lässt sich das gerade aber nicht. Bewusst eine reine
  // Feststellung über den Abruf, keine Aussage über die Lage.
  alerts_failed:   { de: "Warnungen konnten nicht aktualisiert werden.", en: "Alerts could not be updated.", tr: "Uyarılar güncellenemedi." },
  alert_from:      { de: "Gültig ab {time}", en: "Valid from {time}", tr: "{time} tarihinden itibaren geçerli" },
  alert_until:     { de: "Gültig bis {time}", en: "Valid until {time}", tr: "{time} tarihine kadar geçerli" },
  alert_details:   { de: "Details anzeigen", en: "Show details", tr: "Ayrıntıları göster" },
  alert_details_hide: { de: "Details ausblenden", en: "Hide details", tr: "Ayrıntıları gizle" },
  alert_desc:      { de: "Originalmeldung", en: "Original message", tr: "Orijinal uyarı" },
  alert_instruction: { de: "Hinweis der Warnstelle", en: "Official guidance", tr: "Yetkili uyarısı" },
  alert_more_count: { de: "Weitere Warnungen vorhanden", en: "More alerts available", tr: "Başka uyarılar var" },
  alert_note:      { de: "Beachte zusätzlich die Hinweise amtlicher Stellen.", en: "Also follow guidance from official authorities.", tr: "Ayrıca resmi makamların uyarılarını dikkate alın." },
  severity_minor:    { de: "Gering", en: "Minor", tr: "Hafif" },
  severity_moderate: { de: "Mäßig", en: "Moderate", tr: "Orta" },
  severity_severe:   { de: "Schwer", en: "Severe", tr: "Şiddetli" },
  severity_extreme:  { de: "Extrem", en: "Extreme", tr: "Aşırı" },
  urgency_immediate: { de: "Sofort relevant", en: "Relevant now", tr: "Şu anda geçerli" },
  urgency_expected:  { de: "In Kürze erwartet", en: "Expected soon", tr: "Yakında bekleniyor" },
  urgency_future:    { de: "Später erwartet", en: "Expected later", tr: "Daha sonra bekleniyor" },
  alert_active:      { de: "Aktiv", en: "Active", tr: "Aktif" },
  alert_expected:    { de: "Erwartet", en: "Expected", tr: "Bekleniyor" },
  highlightsTitle:   { de: "Heute im Blick", en: "Today at a glance", tr: "Bugüne genel bakış" },
  highlightWarmest:  { de: "Wärmste Stunde", en: "Warmest hour", tr: "En sıcak saat" },
  highlightGust:     { de: "Stärkste Böe", en: "Strongest gust", tr: "En güçlü rüzgâr" },
  highlightRain:     { de: "Regenmaximum", en: "Peak rain chance", tr: "En yüksek yağmur olasılığı" },
  highlightVisibility: { de: "Geringste Sicht", en: "Lowest visibility", tr: "En düşük görüş" },
  favWarmest:        { de: "Wärmster Ort", en: "Warmest", tr: "En sıcak" },
  favDriest:         { de: "Trockenster Ort", en: "Driest", tr: "En kurak" },
  favRain:           { de: "Regen", en: "rain", tr: "yağmur" },
  favAlert:          { de: "Warnung vorhanden", en: "Alert available", tr: "Uyarı mevcut" },
  // ── Tageszusammenfassung, Ebene 1: fertige Sätze (exakt, nicht umformulieren)
  sum1_mild_sunny_day:    { de: "Mild und sonnig, zieh am Abend was über.", en: "Mild and sunny, take a layer for the evening.", tr: "Hava ılık ve güneşli, akşama bir şeyler al yanına." },
  sum1_mild_sunny:        { de: "Mild und sonnig.", en: "Mild and sunny.", tr: "Hava ılık ve güneşli." },
  sum1_mild_changeable:   { de: "Mild und wechselhaft.", en: "Mild and changeable.", tr: "Hava ılık ve değişken." },
  sum1_mild_grey:         { de: "Mild, aber grau.", en: "Mild but grey.", tr: "Hava ılık ama kapalı." },
  sum1_warm_sunny:        { de: "Warm und sonnig.", en: "Warm and sunny.", tr: "Hava sıcak ve güneşli." },
  sum1_warm_clear:        { de: "Warm und klar.", en: "Warm and clear.", tr: "Hava sıcak ve açık." },
  sum1_warm_sunny_uv:     { de: "Warm und sonnig, denk an Sonnenschutz.", en: "Warm and sunny, remember sun protection.", tr: "Hava sıcak ve güneşli, güneşten korunmayı unutma." },
  sum1_hot_dry:           { de: "Heiß und trocken, ans Trinken denken.", en: "Hot and dry, remember to drink.", tr: "Hava sıcak ve kurak, su içmeyi unutma." },
  sum1_hot_humid:         { de: "Schwül und drückend.", en: "Humid and heavy.", tr: "Hava nemli ve bunaltıcı." },
  sum1_cool_friendly:     { de: "Kühl, aber freundlich.", en: "Cool but pleasant.", tr: "Hava serin ama hoş." },
  sum1_cool_cloudy:       { de: "Kühl und wolkig.", en: "Cool and cloudy.", tr: "Hava serin ve bulutlu." },
  sum1_cool_rain_later:   { de: "Kühl, später Regen, Schirm einpacken.", en: "Cool, rain later, take an umbrella.", tr: "Hava serin, sonra yağmur var, yanına şemsiye al." },
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
  sum_s_clear:     { de: "klar", en: "clear", tr: "açık" },
  sum_s_friendly:  { de: "freundlich", en: "pleasant", tr: "hoş" },
  sum_s_cloudy:    { de: "wolkig", en: "cloudy", tr: "bulutlu" },
  sum_s_overcast:  { de: "bedeckt", en: "overcast", tr: "kapalı" },
  sum_s_grey:      { de: "grau", en: "grey", tr: "kapalı" },
  sum_x_rain_later:   { de: "später Regen", en: "rain later", tr: "sonra yağmur var" },
  sum_x_windy:        { de: "windig", en: "windy", tr: "rüzgârlı" },
  sum_x_thunder_later:{ de: "später Gewitter", en: "storms later", tr: "sonra fırtına var" },
  sum_c_umbrella:     { de: "nimm einen Schirm mit", en: "take an umbrella", tr: "yanına şemsiye al" },
  sum_c_sun:          { de: "denk an Sonnenschutz", en: "remember sun protection", tr: "güneşten korunmayı unutma" },
  sum_c_warm:         { de: "warm anziehen", en: "wrap up warm", tr: "sıcak giyin" },
  // ── Vergleich zu gestern ({diff} = gerundete Gradzahl, in CurrentWeather ersetzt)
  cmp_much_warmer: { de: "{diff} Grad wärmer als gestern", en: "{diff}° warmer than yesterday", tr: "Dünden {diff} derece daha sıcak" },
  cmp_bit_warmer:  { de: "{diff} Grad wärmer als gestern", en: "{diff}° warmer than yesterday", tr: "Dünden {diff} derece daha sıcak" },
  cmp_bit_cooler:  { de: "{diff} Grad kühler als gestern", en: "{diff}° cooler than yesterday", tr: "Dünden {diff} derece daha serin" },
  cmp_much_cooler: { de: "{diff} Grad kühler als gestern", en: "{diff}° cooler than yesterday", tr: "Dünden {diff} derece daha serin" },
  rain_from:       { de: "Regen ab ca. {hour} Uhr", en: "Rain from approx. {hour}:00", tr: "Yaklaşık saat {hour}:00 itibarıyla yağmur" },
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
  rain_thunder:    { de: "Gewitter möglich, Schirm einpacken", en: "Storms possible, pack an umbrella", tr: "Fırtına olabilir, şemsiye al" },
  dry_window:      { de: "Voraussichtlich trocken {von} bis {bis} Uhr.", en: "Likely dry {von} to {bis}.", tr: "{von} ile {bis} arası muhtemelen kuru." },
  dry_from:        { de: "Ab {von} Uhr voraussichtlich trocken.", en: "Likely dry from {von}.", tr: "{von} sonrası muhtemelen kuru." },
  hourlyHeading:   { de: "Nächste 24 Stunden", en: "Next 24 hours", tr: "Sonraki 24 saat" },
  hourHint:        { de: "Stunde antippen für Details.", en: "Tap an hour for details.", tr: "Ayrıntılar için bir saate dokunun." },
  hourDetailAria:  { de: "Details für {time}, {condition}, {temp}", en: "Details for {time}, {condition}, {temp}", tr: "{time} için ayrıntılar, {condition}, {temp}" },
  // ── Stundendetail-Panel (Etappe 3)
  hourPanelTitle:  { de: "Stundendetails", en: "Hourly details", tr: "Saatlik ayrıntılar" },
  hourMoreShow:    { de: "Weitere Werte", en: "More values", tr: "Daha fazla değer" },
  hourMoreHide:    { de: "Weniger Werte", en: "Fewer values", tr: "Daha az değer" },
  close:           { de: "Schließen", en: "Close", tr: "Kapat" },
  temperature:     { de: "Temperatur", en: "Temperature", tr: "Sıcaklık" },
  precipProbability: { de: "Niederschlag", en: "Precipitation", tr: "Yağış" },
  precipAmount:    { de: "Regenmenge", en: "Rain amount", tr: "Yağmur miktarı" },
  windDirection:   { de: "Windrichtung", en: "Wind direction", tr: "Rüzgar yönü" },
  windGusts:       { de: "Böen", en: "Gusts", tr: "Rüzgar hamleleri" },
  dewPoint:        { de: "Taupunkt", en: "Dew point", tr: "Çiy noktası" },
  cloudCover:      { de: "Bewölkung", en: "Cloud cover", tr: "Bulutluluk" },
  pressure:        { de: "Luftdruck", en: "Pressure", tr: "Basınç" },
  snow:            { de: "Schnee", en: "Snow", tr: "Kar" },
  visibility:      { de: "Sichtweite", en: "Visibility", tr: "Görüş mesafesi" },
  // 8-Punkt-Kompass, indexiert per round(grad/45)%8 (technische Kürzel)
  compassPoints:   { de: "N,NO,O,SO,S,SW,W,NW", en: "N,NE,E,SE,S,SW,W,NW", tr: "K,KD,D,GD,G,GB,B,KB" },
  // ── Temperaturverlauf (ruhige Linie unter der Stundenleiste)
  tc_aria:         { de: "Gefühlte Temperatur der nächsten 24 Stunden", en: "Apparent temperature for the next 24 hours", tr: "Önümüzdeki 24 saatin hissedilen sıcaklığı" },
  tc_heading:      { de: "Gefühlte Temperatur · 24 Stunden", en: "Apparent temperature · 24 hours", tr: "Hissedilen sıcaklık · 24 saat" },
  // ── Niederschlag (Balkendiagramm direkt unter dem Temperaturverlauf)
  rain_aria:       { de: "Niederschlag der nächsten 24 Stunden", en: "Precipitation for the next 24 hours", tr: "Önümüzdeki 24 saatin yağışı" },
  rain_heading:    { de: "Niederschlag · 24 Stunden", en: "Precipitation · 24 hours", tr: "Yağış · 24 saat" },
  rc_dry:          { de: "kein Regen", en: "no rain", tr: "yağmur yok" },
  rain_total:      { de: "{value} erwartet", en: "{value} expected", tr: "{value} bekleniyor" },
  dailyHeading:    { de: "7 Tage Vorhersage", en: "7 day forecast", tr: "7 günlük tahmin" },
  dailyHeadingDays:{ de: "{n} Tage Vorhersage", en: "{n} day forecast", tr: "{n} günlük tahmin" },
  outlookLabel:    { de: "Ausblick", en: "Outlook", tr: "Genel bakış" },
  day_wind_max:    { de: "Wind max", en: "Max wind", tr: "En yüksek rüzgar" },
  day_precip_total:{ de: "Regenmenge", en: "Rain total", tr: "Toplam yağış" },
  week_best_day:   { de: "Der schönste Tag dürfte {day} werden.", en: "{day} looks like the nicest day.", tr: "En güzel gün {day} olabilir." },
  week_best_today: { de: "Heute dürfte der schönste Tag werden.", en: "Today looks like the nicest day.", tr: "Bugün en güzel gün olabilir." },
  today:           { de: "Heute", en: "Today", tr: "Bugün" },
  footerImpressum: { de: "Impressum", en: "Imprint", tr: "Künye" },
  footerDatenschutz: { de: "Datenschutz", en: "Privacy", tr: "Gizlilik" },
  footerNote:      { de: "Keine Werbung, kein Tracking. Favoriten bleiben lokal im Browser.", en: "No ads, no tracking. Favorites stay local in your browser.", tr: "Reklam yok, takip yok. Favoriler tarayıcında yerel kalır." },
  footerAttributionPrefix: { de: "Wetterdaten von", en: "Weather data by", tr: "Hava verileri" },
  weatherDisclaimer: { de: "Alle Wetterdaten, Warnungen, Pollen und Luftqualitätswerte, Zeitangaben und Empfehlungen dienen nur der allgemeinen Information. Sie können unvollständig, verzögert oder örtlich und zeitlich ungenau sein. Nicht als alleinige Grundlage für Gesundheit, persönliche Sicherheit, Reisen, Luftfahrt, Seefahrt, Verkehr oder Notfallplanung verwenden. Maßgeblich sind amtliche Dienste, Behörden und bei Gesundheitsfragen qualifiziertes Fachpersonal.", en: "All weather data, alerts, pollen and air quality values, times and recommendations are provided for general information only. They may be incomplete, delayed or inaccurate for a specific place or time. Do not use them as the sole basis for health, personal safety, travel, aviation, marine navigation, traffic or emergency planning. Consult official services and authorities, and qualified professionals for health matters.", tr: "Tüm hava durumu verileri, uyarılar, polen ve hava kalitesi değerleri, saat bilgileri ve öneriler yalnızca genel bilgilendirme amaçlıdır. Eksik, gecikmiş veya belirli bir yer ya da zaman için hatalı olabilir. Sağlık, kişisel güvenlik, seyahat, havacılık, denizcilik, trafik veya acil durum planlamasında tek dayanak olarak kullanmayın. Resmi hizmetleri ve yetkili kurumları, sağlık konularında ise nitelikli uzmanları dikkate alın." },
  noscriptText:    { de: "Diese App benötigt JavaScript. Bitte aktiviere JavaScript in deinem Browser.", en: "This app requires JavaScript. Please enable JavaScript in your browser.", tr: "Bu uygulama JavaScript gerektirir. Lütfen tarayıcında JavaScript etkinleştir." },
  themeLight:      { de: "Farbschema: hell", en: "Color scheme: light", tr: "Renk düzeni: açık" },
  themeDark:       { de: "Farbschema: dunkel", en: "Color scheme: dark", tr: "Renk düzeni: koyu" },
  themeSystem:     { de: "Farbschema: automatisch", en: "Color scheme: automatic", tr: "Renk düzeni: otomatik" },
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
  // Footer-Links auf die Rechtsseiten: die Sprachfassung folgt der App-Sprache.
  // applyI18n läuft aus initLang UND setLang, damit stimmen Erstbesuch und
  // manueller Wechsel über denselben Weg. Das href im Markup bleibt die deutsche
  // Basis und trägt den Fall ohne JavaScript. Nur die beiden bekannten Basen
  // werden geschrieben — ein fremder Wert lässt das href unangetastet.
  root.querySelectorAll("[data-i18n-href]").forEach((el) => {
    const base = el.getAttribute("data-i18n-href");
    if (base === "impressum" || base === "datenschutz") el.setAttribute("href", legalHref(base, current));
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
