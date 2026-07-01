import { fetchWithTimeout } from "./http";

// Marker-Id des per Geolocation ermittelten Ortes ("Mein Standort").
// Orte mit dieser Id dürfen nie in localStorage landen (Datenschutzzusage:
// Standort wird nicht dauerhaft in WeatherPure gespeichert) — weder als
// Favorit noch als letzter Ort.
export const GEO_PLACE_ID = -1;

export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  countryCode: string;
  admin1?: string;
}

// Ruft die eigene Server Route auf statt Open-Meteo direkt. Filterung auf
// echte bewohnte Orte, Ergebnislimit und Query-Kappung laufen serverseitig im
// Provider (src/server/weather/providers/OpenMeteoProvider.ts). Der Client
// spart sich nur die Anfrage für zu kurze Eingaben, echte Namen sind länger.
export async function searchCity(query: string, language = "de"): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, lang: language });
  const res = await fetchWithTimeout(`/api/geocoding?${params}`);
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  return (await res.json()) as Place[];
}
