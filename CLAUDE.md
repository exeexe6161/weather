# WeatherPure Projektnotizen

Kurze, dauerhafte Projektentscheidungen und Zustand. Reine Arbeitsregeln stehen global, hier nur Projektspezifisches.

## Datenquelle

Wetter, Pollen, Ortssuche und Warnungen laufen ausschließlich über WeatherAPI.com, serverseitig abgerufen (Key nur als Server Environment Variable `WEATHERAPI_KEY`, nie im Client). Kein Open Meteo mehr. Aktueller Tarif: Starter.

## Entscheidung: Marine Feature "Urlaub am Meer" vorerst nicht bauen

Stand: 5. Juli 2026

Das Feature "Urlaub am Meer" (Küstenwetter für den aktuellen Ort über WeatherAPI `marine.json`) wird mit dem Starter Tarif **nicht** gebaut. Kein Marine Endpoint, kein Schalter, keine UI, solange der Tarif nicht mindestens Pro+ ist oder echte Wellenhöhe und Wassertemperatur bestätigt wurden.

Grund (belegt aus WeatherAPI Doku und Pricing, abgerufen 5. Juli 2026):

- Starter liefert keine sinnvollen Kernwerte für das Feature.
- Wellenhöhe (`sig_ht_mt`) liegt nur im stündlichen Marine Element. Die Preistabelle Zeile "Marine Weather Interval" zeigt für Starter "Daily only", also keine Stundenwerte, damit keine Wellenhöhe.
- Wassertemperatur (`water_temp_c`, `water_temp_f`) ist in der Doku ausdrücklich als "Pro+ plan and above" gekennzeichnet und liegt ebenfalls nur im stündlichen Element.
- Übrig blieben mit Starter nur Tageswerte wie `maxwind_kph` und `avgvis_km`. Diese sind generisch, bringen keinen echten Küstennutzen gegenüber der normalen Vorhersage und würden ein Feature vortäuschen, das keinen Mehrwert hat.
- Keine Fake Werte anzeigen. Lieber kein Bereich als ein leerer oder schöngeredeter.

Falls später Pro+ oder höher genutzt wird und echte Wellenhöhe und Wassertemperatur bestätigt sind:

- Schalter "Mein Ort ist am Meer" pro Ort speichern (Key aus gerundeten Koordinaten, wie die Favoriten Caches), nicht global.
- Marine Call nur bei aktivem Schalter.
- Kein Marine Call beim normalen Seitenstart.
- Keine Tide Daten anzeigen, außer später ausdrücklich geplant und tariflich erlaubt.
- Fehlende Felder immer ausblenden, keine Fake Werte.

## Entscheidung: Niederschlagskarte (Weather Maps) vorerst nicht bauen

Stand: 5. Juli 2026

WeatherAPI `precip` Tiles funktionieren serverseitig ohne Key, sind aber ein reiner Overlay ohne Grundkarte und nur bis Zoom 6. Ein serverseitig zusammengesetztes Testbild ohne Grundkarte zeigt Regenflächen ohne geografischen Bezug (keine Küsten, Grenzen oder Städte) und ist nicht hochwertig genug. Eine wirklich lesbare Karte bräuchte eine fremde Grundkarte plus Kartenbibliothek plus CSP Aufweichung plus IP Übertragung an Dritte, was das schlanke, private Profil der App bricht. Daher zurückgestellt.
