const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

// Marker-Id des per Geolocation ermittelten Ortes ("Mein Standort").
// Orte mit dieser Id dürfen nie in localStorage landen (Datenschutzzusage:
// Standort wird nicht gespeichert) — weder als Favorit noch als letzter Ort.
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

export async function searchCity(query: string, language = "de"): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ name: q, count: "5", language, format: "json" });
  const res = await fetch(`${GEOCODING_URL}?${params}`);
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    countryCode: r.country_code,
    admin1: r.admin1,
  }));
}
