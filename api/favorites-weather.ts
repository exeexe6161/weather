import { WeatherService } from "../src/server/weather/WeatherService.js";
import type { BatchPlace } from "../src/server/weather/WeatherProvider.js";
import { type ApiRequest, type ApiResponse, corsGuard, methodGuard, rateLimitGuard, queryParam, isValidLatitude, isValidLongitude, sendError } from "./_lib/http.js";

// Der Starter Tarif hat keinen Bulk Endpoint. Fünf Orte halten Kosten und
// Antwortzeit berechenbar und entsprechen der sichtbaren Favoritengrenze.
const MAX_PLACES = 5;

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
  if (!corsGuard(req, res)) return;
  if (!methodGuard(req, res)) return;
  if (!rateLimitGuard(req, res)) return;

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
