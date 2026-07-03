import { WeatherService } from "../src/server/weather/WeatherService.js";
import {
  type ApiRequest,
  type ApiResponse,
  corsGuard,
  methodGuard,
  queryNumber,
  isValidLatitude,
  isValidLongitude,
  sendError,
} from "./_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!corsGuard(req, res)) return;
  if (!methodGuard(req, res)) return;

  const latitude = queryNumber(req, "lat");
  const longitude = queryNumber(req, "lon");
  if (latitude === null || longitude === null || !isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    sendError(res, 400, "Invalid or missing lat/lon");
    return;
  }

  try {
    const forecast = await WeatherService.getForecast(latitude, longitude);
    res.status(200).json(forecast);
  } catch {
    sendError(res, 502, "Weather provider request failed");
  }
}
