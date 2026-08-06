import { WeatherService } from "../src/server/weather/WeatherService.js";
import type { BatchPlace } from "../src/server/weather/WeatherProvider.js";
import { type ApiRequest, type ApiResponse, corsGuard, GET_POST_METHODS, jsonBody, methodGuard, rateLimitGuard, queryParam, isValidLatitude, isValidLongitude, sendError, sendMappedError } from "./_lib/http.js";

// Der Starter Tarif hat keinen Bulk Endpoint. Fünf eintägige Forecasts halten
// Kosten und Antwortzeit berechenbar und entsprechen der Favoritengrenze.
const MAX_PLACES = 5;

function parsePlaces(parsed: unknown, strictFields: boolean): BatchPlace[] | null {
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_PLACES) return null;

  const places: BatchPlace[] = [];
  for (const entry of parsed) {
    if (
      strictFields &&
      (typeof entry !== "object" || entry === null || Array.isArray(entry) ||
        Object.keys(entry).length !== 3 ||
        !Object.prototype.hasOwnProperty.call(entry, "id") ||
        !Object.prototype.hasOwnProperty.call(entry, "latitude") ||
        !Object.prototype.hasOwnProperty.call(entry, "longitude"))
    ) {
      return null;
    }
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
  if (!corsGuard(req, res, GET_POST_METHODS)) return;
  if (!methodGuard(req, res, GET_POST_METHODS)) return;
  if (!rateLimitGuard(req, res)) return;

  let parsed: unknown;
  if (req.method === "POST") {
    const body = jsonBody(req, res);
    if (!body.ok) return;
    parsed = body.value;
  } else {
    const raw = queryParam(req, "places");
    if (raw === null) {
      sendError(res, 400, "Missing places");
      return;
    }
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = null;
    }
  }
  const places = parsePlaces(parsed, req.method === "POST");
  if (places === null) {
    sendError(res, 400, "Invalid places: expected JSON array of {id, latitude, longitude}, max " + MAX_PLACES);
    return;
  }

  try {
    const result = await WeatherService.getCurrentBatch(places);
    res.status(200).json(
      Array.from(result, ([id, w]) => ({ id, temp: w.temp, code: w.code, isDay: w.isDay, rainChance: w.rainChance, hasAlert: w.hasAlert }))
    );
  } catch (err) {
    sendMappedError(res, err);
  }
}
