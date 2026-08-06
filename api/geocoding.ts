import { WeatherService } from "../src/server/weather/WeatherService.js";
import { type ApiRequest, type ApiResponse, corsGuard, methodGuard, rateLimitGuard, queryParam, sendError, sendMappedError } from "./_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!corsGuard(req, res)) return;
  if (!methodGuard(req, res)) return;
  if (!rateLimitGuard(req, res)) return;

  const q = queryParam(req, "q");
  if (q === null) {
    sendError(res, 400, "Missing q");
    return;
  }
  const lang = queryParam(req, "lang") ?? "de";

  try {
    const places = await WeatherService.searchPlaces(q, lang);
    res.status(200).json(places);
  } catch (err) {
    // Auch die Ortssuche laeuft durch den Kontingentschutz (search.json geht
    // ueber denselben requestJson Pfad), ein geschlossener Guard legt sie also
    // mit still. Sie braucht dieselbe Trennung wie das Wetter.
    sendMappedError(res, err);
  }
}
