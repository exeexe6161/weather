import { WeatherService } from "../src/server/weather/WeatherService.js";
import {
  type ApiRequest,
  type ApiResponse,
  corsGuard,
  GET_POST_METHODS,
  methodGuard,
  rateLimitGuard,
  requestCoordinates,
  sendError,
} from "./_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!corsGuard(req, res, GET_POST_METHODS)) return;
  if (!methodGuard(req, res, GET_POST_METHODS)) return;
  if (!rateLimitGuard(req, res)) return;

  const coordinates = requestCoordinates(req, res);
  if (coordinates === null) return;

  try {
    // getPollen scheitert nie (fängt intern ab, liefert notfalls null) —
    // ein null Ergebnis ist ein gültiger 200er, kein Fehlerfall.
    const levels = await WeatherService.getPollen(coordinates.latitude, coordinates.longitude);
    res.status(200).json(levels);
  } catch {
    sendError(res, 502, "Pollen provider request failed");
  }
}
