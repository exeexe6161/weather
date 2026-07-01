import { WeatherService } from "../src/server/weather/WeatherService";
import type { BatchPlace } from "../src/server/weather/WeatherProvider";
import { type ApiRequest, type ApiResponse, methodGuard, queryParam, isValidLatitude, isValidLongitude, sendError } from "./_lib/http";

// Obergrenze für die Orte je Anfrage: verhindert, dass eine überlange Liste
// eine riesige Upstream URL an Open-Meteo baut oder den Endpoint für Missbrauch
// öffnet. Deutlich über dem, was ein Favoriten Mini Dashboard real braucht.
const MAX_PLACES = 50;

function parsePlaces(raw: string): BatchPlace[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_PLACES) return null;

  const places: BatchPlace[] = [];
  for (const entry of parsed) {
    const id = (entry as { id?: unknown })?.id;
    const latitude = (entry as { latitude?: unknown })?.latitude;
    const longitude = (entry as { longitude?: unknown })?.longitude;
    if (
      typeof id !== "number" || !Number.isFinite(id) ||
      typeof latitude !== "number" || !isValidLatitude(latitude) ||
      typeof longitude !== "number" || !isValidLongitude(longitude)
    ) {
      return null;
    }
    places.push({ id, latitude, longitude });
  }
  return places;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodGuard(req, res)) return;

  const raw = queryParam(req, "places");
  if (raw === null) {
    sendError(res, 400, "Missing places");
    return;
  }
  const places = parsePlaces(raw);
  if (places === null) {
    sendError(res, 400, "Invalid places: expected JSON array of {id, latitude, longitude}, max " + MAX_PLACES);
    return;
  }

  try {
    const result = await WeatherService.getCurrentBatch(places);
    res.status(200).json(
      Array.from(result, ([id, w]) => ({ id, temp: w.temp, code: w.code, isDay: w.isDay }))
    );
  } catch {
    sendError(res, 502, "Favorites weather provider request failed");
  }
}
