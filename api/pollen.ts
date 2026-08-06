import { WeatherService } from "../src/server/weather/WeatherService.js";
import {
  type ApiRequest,
  type ApiResponse,
  corsGuard,
  GET_POST_METHODS,
  methodGuard,
  rateLimitGuard,
  requestCoordinates,
  sendMappedError,
} from "./_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!corsGuard(req, res, GET_POST_METHODS)) return;
  if (!methodGuard(req, res, GET_POST_METHODS)) return;
  if (!rateLimitGuard(req, res)) return;

  const coordinates = requestCoordinates(req, res);
  if (coordinates === null) return;

  try {
    // `null` ist hier ausschliesslich die ECHTE Aussage "der Anbieter liefert
    // fuer diesen Ort kein Pollenobjekt" und bleibt ein gueltiger 200er.
    // Technische Fehler reicht getPollen inzwischen durch, statt sie ebenfalls
    // in `null` zu verwandeln — sonst haette die Oberflaeche bei geschlossenem
    // Kontingentschutz eine Abdeckungsluecke des Anbieters behauptet, die es
    // nicht gibt.
    const levels = await WeatherService.getPollen(coordinates.latitude, coordinates.longitude);
    res.status(200).json(levels);
  } catch (err) {
    sendMappedError(res, err);
  }
}
