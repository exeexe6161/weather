import { fetchWithTimeout, apiUrl } from "./http";
import { RequestError } from "./loadError";

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

// Ruft die eigene Server Route auf statt WeatherAPI direkt. Ergebnislimit und
// Query-Kappung laufen serverseitig im Provider. Der Client
// spart sich nur die Anfrage für zu kurze Eingaben, echte Namen sind länger.
export async function searchCity(query: string, language = "de"): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, lang: language });
  const res = await fetchWithTimeout(apiUrl(`/api/geocoding?${params}`));
  // Wie fetchWeather: Status auswertbar halten, Wortlaut unverändert. Der
  // Linkpfad braucht ihn, um einen Serverfehler von "Ort nicht gefunden" zu
  // unterscheiden.
  if (!res.ok) throw new RequestError(`Geocoding request failed: ${res.status}`, res.status);
  return (await res.json()) as Place[];
}
