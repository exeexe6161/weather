import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import favoritesHandler from "../api/favorites-weather.ts";
import geocodingHandler from "../api/geocoding.ts";
import pollenHandler from "../api/pollen.ts";
import weatherHandler from "../api/weather.ts";
import type { ApiRequest, ApiResponse } from "../api/_lib/http.ts";
import { WeatherService } from "../src/server/weather/WeatherService.ts";
import { forecastFixture } from "./fixtures/weatherapi.ts";

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  ended: boolean;
}

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.WEATHERAPI_KEY;
const originalGetForecast = WeatherService.getForecast;
const originalGetPollen = WeatherService.getPollen;
const originalGetCurrentBatch = WeatherService.getCurrentBatch;

function request(
  method: string,
  options: Partial<Pick<ApiRequest, "query" | "headers" | "body">> = {},
): ApiRequest {
  return {
    method,
    query: options.query ?? {},
    headers: options.headers ?? {},
    body: options.body,
  };
}

function response(): { res: ApiResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 200, headers: {}, body: undefined, ended: false };
  const res: ApiResponse = {
    status(code) {
      captured.status = code;
      return res;
    },
    setHeader(name, value) {
      captured.headers[name.toLowerCase()] = value;
      return res;
    },
    json(body) {
      captured.body = body;
      captured.ended = true;
    },
    end() {
      captured.ended = true;
    },
  };
  return { res, captured };
}

async function invoke(
  handler: (req: ApiRequest, res: ApiResponse) => Promise<void>,
  req: ApiRequest,
): Promise<CapturedResponse> {
  const { res, captured } = response();
  await handler(req, res);
  return captured;
}

function jsonRequest(method: string, body: unknown): ApiRequest {
  return request(method, { headers: { "content-type": "application/json" }, body });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.WEATHERAPI_KEY;
  else process.env.WEATHERAPI_KEY = originalApiKey;
  WeatherService.getForecast = originalGetForecast;
  WeatherService.getPollen = originalGetPollen;
  WeatherService.getCurrentBatch = originalGetCurrentBatch;
});

test("GET and POST weather keep the same response format and service input", async () => {
  const calls: Array<[number, number]> = [];
  WeatherService.getForecast = async (latitude, longitude) => {
    calls.push([latitude, longitude]);
    return { fixture: "forecast" } as never;
  };

  const get = await invoke(weatherHandler, request("GET", { query: { lat: "50.1", lon: "8.6" } }));
  const post = await invoke(weatherHandler, jsonRequest("POST", { lat: 50.1, lon: 8.6 }));

  assert.equal(get.status, 200);
  assert.equal(post.status, 200);
  assert.deepEqual(post.body, get.body);
  assert.deepEqual(calls, [[50.1, 8.6], [50.1, 8.6]]);
});

test("GET and POST pollen use the same service input", async () => {
  const calls: Array<[number, number]> = [];
  WeatherService.getPollen = async (latitude, longitude) => {
    calls.push([latitude, longitude]);
    return { grass: "low" } as never;
  };

  const get = await invoke(pollenHandler, request("GET", { query: { lat: "50.1", lon: "8.6" } }));
  const post = await invoke(pollenHandler, jsonRequest("POST", { lat: 50.1, lon: 8.6 }));

  assert.equal(get.status, 200);
  assert.equal(post.status, 200);
  assert.deepEqual(post.body, get.body);
  assert.deepEqual(calls, [[50.1, 8.6], [50.1, 8.6]]);
});

test("GET and POST favorites keep the existing response format", async () => {
  const places = [{ id: 7, latitude: 50.1, longitude: 8.6 }];
  WeatherService.getCurrentBatch = async () => new Map([[7, {
    temp: 19,
    code: 2,
    isDay: true,
    rainChance: 30,
    hasAlert: false,
  }]]);

  const get = await invoke(favoritesHandler, request("GET", { query: { places: JSON.stringify(places) } }));
  const post = await invoke(favoritesHandler, jsonRequest("POST", places));

  assert.equal(get.status, 200);
  assert.equal(post.status, 200);
  assert.deepEqual(post.body, get.body);
});

test("invalid JSON returns 400", async () => {
  const result = await invoke(weatherHandler, jsonRequest("POST", "{not-json"));

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "Invalid JSON body" });
});

test("missing or out-of-range coordinates return 400", async () => {
  const missing = await invoke(weatherHandler, jsonRequest("POST", { lat: 50 }));
  const invalid = await invoke(weatherHandler, jsonRequest("POST", { lat: 91, lon: 8 }));

  assert.equal(missing.status, 400);
  assert.equal(invalid.status, 400);
  assert.deepEqual(missing.body, { error: "Invalid or missing lat/lon" });
  assert.deepEqual(invalid.body, { error: "Invalid or missing lat/lon" });
});

test("POST coordinate bodies reject unknown fields", async () => {
  const result = await invoke(weatherHandler, jsonRequest("POST", { lat: 50, lon: 8, extra: true }));

  assert.equal(result.status, 400);
});

test("favorites reject more than five entries and unknown POST fields", async () => {
  const sixPlaces = Array.from({ length: 6 }, (_, id) => ({ id, latitude: 50, longitude: 8 }));
  const tooMany = await invoke(favoritesHandler, jsonRequest("POST", sixPlaces));
  const extraField = await invoke(favoritesHandler, jsonRequest("POST", [
    { id: 7, latitude: 50, longitude: 8, name: "Not accepted" },
  ]));

  assert.equal(tooMany.status, 400);
  assert.equal(extraField.status, 400);
});

test("POST rejects a non-JSON Content-Type in a controlled way", async () => {
  const result = await invoke(weatherHandler, request("POST", {
    headers: { "content-type": "text/plain" },
    body: "50,8",
  }));

  assert.equal(result.status, 415);
  assert.deepEqual(result.body, { error: "Content-Type must be application/json" });
});

test("PUT and DELETE return 405", async () => {
  for (const handler of [weatherHandler, pollenHandler, favoritesHandler]) {
    const put = await invoke(handler, request("PUT"));
    const del = await invoke(handler, request("DELETE"));
    assert.equal(put.status, 405);
    assert.equal(del.status, 405);
  }
});

test("OPTIONS advertises only GET, POST and OPTIONS on extended routes", async () => {
  for (const handler of [weatherHandler, pollenHandler, favoritesHandler]) {
    const result = await invoke(handler, request("OPTIONS", {
      headers: { origin: "capacitor://localhost" },
    }));
    assert.equal(result.status, 204);
    assert.equal(result.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
    assert.equal(result.headers["access-control-allow-headers"], "Content-Type");
  }
});

test("geocoding remains GET only", async () => {
  const post = await invoke(geocodingHandler, jsonRequest("POST", { q: "Berlin" }));
  const options = await invoke(geocodingHandler, request("OPTIONS", {
    headers: { origin: "capacitor://localhost" },
  }));

  assert.equal(post.status, 405);
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-methods"], "GET, OPTIONS");
});

test("GET and POST weather share the service cache key", async () => {
  let providerCalls = 0;
  process.env.WEATHERAPI_KEY = "fixture-key";
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json(forecastFixture());
  };

  const get = await invoke(weatherHandler, request("GET", { query: { lat: "12.34567", lon: "76.54321" } }));
  const providerCallsAfterGet = providerCalls;
  const post = await invoke(weatherHandler, jsonRequest("POST", { lat: 12.34567, lon: 76.54321 }));

  assert.equal(get.status, 200);
  assert.equal(post.status, 200);
  assert.deepEqual(post.body, get.body);
  assert.ok(providerCallsAfterGet > 0);
  assert.equal(providerCalls, providerCallsAfterGet);
});
