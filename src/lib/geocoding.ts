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

// Maximal so viele Vorschläge in der Liste
const RESULT_COUNT = 5;

// Nur echte bewohnte Orte in den Vorschlägen (GeoNames feature class P, Codes
// "PPL*": Städte, Gemeinden, Ortschaften). Länder ("PCL*") und ganze
// Verwaltungseinheiten ("ADM*") haben keinen einzelnen Wetterort und fliegen
// raus. Bewusst als konservative Allowlist statt Blocklist: fehlt ein
// sinnvoller Ortstyp, hier ein Präfix ergänzen. Treffer ohne feature_code
// gelten im Zweifel ebenfalls als kein Ort.
const ALLOWED_FEATURE_PREFIXES = ["PPL"];

function isPlaceResult(r: any): boolean {
  return (
    typeof r?.feature_code === "string" &&
    ALLOWED_FEATURE_PREFIXES.some((prefix) => r.feature_code.startsWith(prefix))
  );
}

// Obergrenze für die Anfrage: echte Ortsnamen sind kurz; ein überlanger
// Wert (z. B. aus einem präparierten ?stadt=-Link) würde sonst ungekürzt in
// die Geocoding-URL wandern. Auf den sinnvollen Präfix kappen statt zu
// verwerfen — eine legitime, nur zu lange Eingabe sucht weiter.
const MAX_QUERY_LEN = 100;

export async function searchCity(query: string, language = "de"): Promise<Place[]> {
  const q = query.trim().slice(0, MAX_QUERY_LEN);
  if (q.length < 2) return [];
  // Mehr Treffer anfordern als angezeigt werden: der Ortsfilter unten wirft
  // Länder und Regionen raus, die Liste soll danach trotzdem voll sein
  const params = new URLSearchParams({ name: q, count: String(RESULT_COUNT * 2), language, format: "json" });
  const res = await fetch(`${GEOCODING_URL}?${params}`);
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter(isPlaceResult)
    .slice(0, RESULT_COUNT)
    .map((r: any) => ({
      id: r.id,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      country: r.country,
      countryCode: r.country_code,
      admin1: r.admin1,
    }));
}
