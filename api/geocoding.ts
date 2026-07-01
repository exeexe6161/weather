import { WeatherService } from "../src/server/weather/WeatherService";
import { type ApiRequest, type ApiResponse, methodGuard, queryParam, sendError } from "./_lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodGuard(req, res)) return;

  const q = queryParam(req, "q");
  if (q === null) {
    sendError(res, 400, "Missing q");
    return;
  }
  const lang = queryParam(req, "lang") ?? "de";

  try {
    const places = await WeatherService.searchPlaces(q, lang);
    res.status(200).json(places);
  } catch {
    sendError(res, 502, "Geocoding provider request failed");
  }
}
