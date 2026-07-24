import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { weatherApiProvider } from "../src/server/weather/providers/WeatherApiProvider.ts";
import { setQuotaReservationAdapterForTesting, type QuotaReservationRequest } from "../src/server/weather/quotaGuard.ts";
import { alertFixture, forecastFixture, historyFixture } from "./fixtures/weatherapi.ts";

// Quota Guard deterministisch freigeben: diese Tests charakterisieren den
// Provider, nicht das Quota Verhalten (das deckt weatherQuotaGuard.test.ts ab).
// Ohne Adapter wäre der Guard Fail Closed und jeder Provider Aufruf würde werfen.
setQuotaReservationAdapterForTesting({
  reserve: async (request: QuotaReservationRequest) => ({
    status: "reserved",
    burstRemaining: request.policy.burstCapacity - 1,
    monthlyRemaining: request.policy.monthlyLimit - 1,
    month: request.month,
  }),
});

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.WEATHERAPI_KEY;

function installProviderFetch(forecast: unknown): void {
  globalThis.fetch = async (input) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl);
    assert.equal(url.origin, "https://api.weatherapi.com");
    assert.equal(url.searchParams.get("key"), "fixture-key");
    if (url.pathname.endsWith("/forecast.json")) return Response.json(forecast);
    if (url.pathname.endsWith("/history.json")) return Response.json(historyFixture());
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
}

beforeEach(() => {
  process.env.WEATHERAPI_KEY = "fixture-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.WEATHERAPI_KEY;
  else process.env.WEATHERAPI_KEY = originalApiKey;
});

test("keeps a real location warning", async () => {
  installProviderFetch(forecastFixture({ alerts: [alertFixture()] }));

  const result = await weatherApiProvider.getForecast(50, 8);

  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].event, "Strong wind warning");
  assert.equal(result.alerts[0].severity, "Moderate");
});

test("removes empty and clearly unrelated warnings", async () => {
  installProviderFetch(forecastFixture({
    alerts: [
      {},
      alertFixture({
        event: "Regional rain warning",
        headline: "Official warning for Germany - Bayern",
        areas: "Germany Bayern",
      }),
    ],
  }));

  const result = await weatherApiProvider.getForecast(50, 8);

  assert.deepEqual(result.alerts, []);
});

test("keeps an unknown warning type conservatively", async () => {
  installProviderFetch(forecastFixture({
    alerts: [alertFixture({ event: "Localized atmospheric notice", severity: "Unlisted" })],
  }));

  const result = await weatherApiProvider.getForecast(50, 8);

  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].event, "Localized atmospheric notice");
  assert.equal(result.alerts[0].severity, "Unlisted");
});

test("sorts multiple warnings and removes expired entries", async () => {
  installProviderFetch(forecastFixture({
    alerts: [
      alertFixture({ event: "Minor warning", severity: "Minor", effective: "2099-07-15T11:00:00Z" }),
      alertFixture({ event: "Severe warning", severity: "Severe", effective: "2099-07-15T12:00:00Z" }),
      alertFixture({ event: "Expired warning", expires: "2000-01-01T00:00:00Z" }),
    ],
  }));

  const result = await weatherApiProvider.getForecast(50, 8);

  assert.deepEqual(result.alerts.map((entry) => entry.event), ["Severe warning", "Minor warning"]);
});

test("keeps a relevant translated region warning", async () => {
  installProviderFetch(forecastFixture({
    country: "Italy",
    region: "Lombardia",
    alerts: [alertFixture({
      event: "Regional weather warning",
      headline: "Meteoalarm warning per l'Italia - Lombardy",
      areas: "",
    })],
  }));

  const result = await weatherApiProvider.getForecast(45, 9);

  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].event, "Regional weather warning");
});

test("handles incomplete alert records defensively", async () => {
  installProviderFetch(forecastFixture({ alerts: [null, {}, { event: "Provider notice" }] }));

  const result = await weatherApiProvider.getForecast(50, 8);

  assert.equal(result.alerts.length, 1);
  assert.deepEqual(result.alerts[0], {
    event: "Provider notice",
    headline: "",
    expires: null,
    severity: null,
    urgency: null,
    effective: null,
    desc: null,
    instruction: null,
  });
});

test("maps forecast rain chance and warning data", async () => {
  installProviderFetch(forecastFixture({ rainChance: 61, alerts: [alertFixture()] }));

  const result = await weatherApiProvider.getForecast(50, 8);

  assert.equal(result.daily[0].precipitationProbabilityMax, 61);
  assert.equal(result.alerts.length, 1);
});

test("maps favorites temperature, condition, rain chance and alert status", async () => {
  installProviderFetch(forecastFixture({ temp: 19, rainChance: 67, alerts: [alertFixture()] }));

  const result = await weatherApiProvider.getCurrentBatch([{ id: 7, latitude: 50, longitude: 8 }]);

  assert.deepEqual(result.get(7), {
    temp: 19,
    code: 0,
    isDay: true,
    rainChance: 67,
    hasAlert: true,
  });
});

test("omits an incomplete favorites provider response without failing the batch", async () => {
  const incomplete = forecastFixture();
  (incomplete.current as Record<string, unknown>).condition = {};
  installProviderFetch(incomplete);

  const result = await weatherApiProvider.getCurrentBatch([{ id: 7, latitude: 50, longitude: 8 }]);

  assert.equal(result.size, 0);
});
