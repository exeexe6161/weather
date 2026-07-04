# WeatherPure

Minimalistische Wetter PWA mit WeatherAPI, lokaler Speicherung und ohne Tracking. Live unter www.weatherpure.com.

## Entwicklung

```bash
npm install
npm run typecheck
npm run build
```

Der Build erzeugt `dist/` für Vercel. Die App nutzt selbst gehostete Inter Fonts, gebündelte Lucide Icons und WeatherAPI als Wetterdatenquelle. Der geheime Schlüssel wird serverseitig als `WEATHERAPI_KEY` gesetzt und darf nie im Browsercode oder Repository stehen.

## Lizenz und Daten

- Wetterdaten: WeatherAPI.com gemäß den WeatherAPI Nutzungsbedingungen
- Icons: Lucide, ISC License
- Schrift: Inter, SIL OFL 1.1

Siehe [LICENSES.md](./LICENSES.md).
