import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { weatherApiProvider, weatherApiCodeToWmo } from "../src/server/weather/providers/WeatherApiProvider.ts";
import { setQuotaReservationAdapterForTesting, type QuotaReservationRequest } from "../src/server/weather/quotaGuard.ts";
import { alertFixture, forecastFixture, historyFixture } from "./fixtures/weatherapi.ts";
import type { Forecast } from "../src/lib/weather.ts";
import { formatPercent } from "../src/lib/format.ts";
import { rainWindowFor } from "../src/lib/clothing.ts";
import { dryWindowFor } from "../src/lib/dryWindow.ts";
import { summaryFor } from "../src/lib/summary.ts";
import { bestWeatherDayKey } from "../src/lib/weekSummary.ts";
import { renderDressToday } from "../src/components/DressRecommendation.ts";
import { renderTodayHighlights } from "../src/components/TodayHighlights.ts";
import { renderCurrentWeather } from "../src/components/CurrentWeather.ts";
import { renderDailyForecast } from "../src/components/DailyForecast.ts";
import { renderHourlyStrip } from "../src/components/HourlyStrip.ts";
import { renderRainChart } from "../src/components/RainChart.ts";
import { getWmo, pickIcon, isPrecipCode } from "../src/lib/wmo.ts";
import { weatherLabel, weatherLabelShort } from "../src/i18n/weather-labels.ts";

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

function providerRainFixture(value: unknown): Record<string, unknown> {
  const raw = forecastFixture();
  const days = (raw.forecast as { forecastday: Array<{ day: Record<string, unknown>; hour: Array<Record<string, unknown>> }> }).forecastday;
  for (const day of days) {
    if (value === undefined) delete day.day.daily_chance_of_rain;
    else day.day.daily_chance_of_rain = value;
    for (const hour of day.hour) {
      if (value === undefined) delete hour.chance_of_rain;
      else hour.chance_of_rain = value;
      hour.precip_mm = 0; // Menge ist kein Ersatz für eine Wahrscheinlichkeit.
    }
  }
  return raw;
}

test("known condition mappings remain stable and unknown conditions stay unknown through display", async () => {
  const raw = forecastFixture();
  const days = (raw.forecast as { forecastday: Array<{ day: Record<string, unknown>; hour: Array<Record<string, unknown>> }> }).forecastday;
  (raw.current as Record<string, unknown>).condition = { code: 9999 };
  days[0].day.condition = { code: 1183 };
  days[0].hour[0].condition = { code: 1003 };
  days[0].hour[1].condition = { code: 9999 };
  installProviderFetch(raw);

  const forecast = await weatherApiProvider.getForecast(50, 8);
  const batch = await weatherApiProvider.getCurrentBatch([{ id: 7, latitude: 50, longitude: 8 }]);
  assert.equal(forecast.current.weatherCode, -1);
  assert.deepEqual(forecast.hourly.map((h) => h.weatherCode), [2, -1]);
  assert.equal(forecast.daily[0].weatherCode, 61);
  assert.equal(batch.get(7)?.code, -1);
  assert.equal(getWmo(-1).labelKey, "wmo_unknown");
  assert.equal(pickIcon(-1, true), "circle-question-mark");
  assert.equal(pickIcon(-1, false), "circle-question-mark");
  assert.equal(pickIcon(2, true), "cloud-sun");
  assert.equal(pickIcon(61, true), "cloud-rain");
  assert.equal(summaryFor(forecast), null);
  const current = renderTarget();
  renderCurrentWeather(current as unknown as HTMLElement, {
    place: { id: 7, name: "Fixture", latitude: 50, longitude: 8, country: "Fixture", countryCode: "FC" },
    forecast, isFav: false, canAddFavorite: true, freshness: "fresh", updatedAt: "2099-07-15T12:00:00Z",
  });
  assert.match(current.innerHTML, /data-lucide="circle-question-mark"/);
  assert.match(current.innerHTML, /Unbekannt/);
  assert.doesNotMatch(current.innerHTML, /data-lucide="cloud" class="cw-ico"/);
  const daily = renderTarget();
  renderDailyForecast(daily as unknown as HTMLElement, [{ ...forecast.daily[0], weatherCode: -1 }], 7);
  assert.match(daily.innerHTML, /data-lucide="circle-question-mark" class="day-ico"/);
  assert.match(daily.innerHTML, /class="day-label">Unbekannt/);
});

for (const [name, input, expected] of [
  ["real zero", 0, 0],
  ["positive value", 1.25, 1.25],
  ["absent field", undefined, undefined],
  ["explicit null", null, undefined],
] as const) {
  test(`hourly precipitation amount preserves ${name}`, async () => {
    const raw = forecastFixture();
    const days = (raw.forecast as { forecastday: Array<{ hour: Array<Record<string, unknown>> }> }).forecastday;
    for (const day of days) for (const hour of day.hour) {
      if (input === undefined) delete hour.precip_mm;
      else hour.precip_mm = input;
    }
    installProviderFetch(raw);
    const forecast = await weatherApiProvider.getForecast(50, 8);
    assert.deepEqual(forecast.hourly.map((h) => h.precipitation), [expected, expected]);
  });
}

test("rain chart distinguishes missing amounts from real zero and omits incomplete total", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const html = { value: "" };
  const container = {
    hidden: false,
    replaceChildren() { html.value = ""; },
    insertAdjacentHTML(_where: string, markup: string) { html.value += markup; },
    appendChild() {},
    addEventListener() {},
  };
  Object.defineProperty(globalThis, "document", { value: { createElement: () => ({ className: "" }), addEventListener() {} }, configurable: true });
  try {
    renderRainChart(container as unknown as HTMLElement, {
      precip: [undefined, 0, 1.25, null],
      times: ["2099-07-15T12:00", "2099-07-15T13:00", "2099-07-15T14:00", "2099-07-15T15:00"],
      startHour: 12, locale: "de-DE", ariaLabel: "Niederschlag",
    });
    assert.equal(container.hidden, false);
    assert.match(html.value, /12:00, –/);
    assert.match(html.value, /13:00, 0,0 mm/);
    assert.match(html.value, /14:00, 1,3 mm/);
    assert.doesNotMatch(html.value, /erwartet/);
    assert.equal((html.value.match(/class="rc-socket"/g) ?? []).length, 2);
    renderRainChart(container as unknown as HTMLElement, {
      precip: [0, 0, 1.25, 0],
      times: ["2099-07-15T12:00", "2099-07-15T13:00", "2099-07-15T14:00", "2099-07-15T15:00"],
      startHour: 12, locale: "de-DE", ariaLabel: "Niederschlag",
    });
    assert.match(html.value, /1,3 mm erwartet/);
    assert.equal((html.value.match(/class="rc-socket"/g) ?? []).length, 4);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete (globalThis as { document?: unknown }).document;
  }
});

for (const [name, input, expected] of [
  ["real zero", 0, 0],
  ["positive value", 67, 67],
  ["absent field", undefined, null],
  ["explicit null", null, null],
  ["empty provider value", "", null],
  ["invalid numeric provider value", "not-a-number", null],
] as const) {
  test(`rain probability keeps its meaning in full forecast and batch: ${name}`, async () => {
    installProviderFetch(providerRainFixture(input));

    const full = await weatherApiProvider.getForecast(50, 8);
    const batch = await weatherApiProvider.getCurrentBatch([{ id: 7, latitude: 50, longitude: 8 }]);

    assert.equal(full.daily[0].precipitationProbabilityMax, expected);
    assert.deepEqual(full.hourly.map((h) => h.precipitationProbability), [expected, expected]);
    assert.equal(batch.get(7)?.rainChance, expected);
    assert.deepEqual(JSON.parse(JSON.stringify(full)).hourly.map((h: { precipitationProbability: unknown }) => h.precipitationProbability), [expected, expected]);
    assert.equal(full.hourly[0].precipitation, 0);
  });
}

function renderTarget() {
  return { innerHTML: "", hidden: false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, replaceChildren() { this.innerHTML = ""; } };
}

function withProbabilities(forecast: Forecast, probabilities: Array<number | null>): Forecast {
  return {
    ...forecast,
    timezone: "UTC",
    current: { ...forecast.current, time: "2099-07-15T12:00", apparentTemperature: 5, weatherCode: 3 },
    hourly: probabilities.map((prob, i) => ({ ...forecast.hourly[0], time: `2099-07-15T${String(12 + i).padStart(2, "0")}:00`, precipitationProbability: prob, precipitation: 0, snowfall: 0 })),
  };
}

test("calendar stale UI shows the saved date without today's claims or yesterday comparison", async () => {
  installProviderFetch(forecastFixture());
  const forecast = await weatherApiProvider.getForecast(50, 8);
  forecast.yesterdayTempMax = 0;
  const current = renderTarget();
  renderCurrentWeather(current as unknown as HTMLElement, {
    place: { id: 7, name: "Fixture", latitude: 50, longitude: 8, country: "Fixture", countryCode: "FC" },
    forecast, isFav: false, canAddFavorite: true, freshness: "failed",
    updatedAt: "2099-07-15T12:00:00Z", failReason: "network", calendarStale: true,
  });
  const daily = renderTarget();
  renderDailyForecast(daily as unknown as HTMLElement, forecast.daily, 7, true);
  assert.doesNotMatch(current.innerHTML, /Regen heute|cw-summary|cw-compare|Zuletzt aktualisiert/);
  assert.match(current.innerHTML, /Stand/);
  assert.doesNotMatch(daily.innerHTML, />Heute</);
  assert.match(daily.innerHTML, /15\.07/);

  renderDailyForecast(daily as unknown as HTMLElement, forecast.daily, 7);
  assert.match(daily.innerHTML, />Heute</);
  renderCurrentWeather(current as unknown as HTMLElement, {
    place: { id: 7, name: "Fixture", latitude: 50, longitude: 8, country: "Fixture", countryCode: "FC" },
    forecast, isFav: false, canAddFavorite: true, freshness: "fresh", updatedAt: "2099-07-15T12:00:00Z",
  });
  assert.match(current.innerHTML, /cw-compare/);
});

test("missing rain uses the existing placeholder and is absent from current and daily percentages", async () => {
  installProviderFetch(providerRainFixture(undefined));
  const forecast = await weatherApiProvider.getForecast(50, 8);
  const current = renderTarget();
  renderCurrentWeather(current as unknown as HTMLElement, {
    place: { id: 7, name: "Fixture", latitude: 50, longitude: 8, country: "Fixture", countryCode: "FC" },
    forecast, isFav: false, canAddFavorite: true, freshness: "fresh", updatedAt: "2099-07-15T12:00:00Z",
  });
  const daily = renderTarget();
  renderDailyForecast(daily as unknown as HTMLElement, forecast.daily, 7);

  assert.equal(formatPercent(forecast.hourly[0].precipitationProbability), "–");
  assert.equal(formatPercent(0), "0\u202F%");
  assert.doesNotMatch(current.innerHTML, /Regen heute/);
  assert.match(daily.innerHTML, /class="day-rain"><\/div>/);
  assert.doesNotMatch(daily.innerHTML, /class="day-rain">0\u202F%/);
});

test("hour detail renders missing probability as a placeholder and real zero as zero", async () => {
  installProviderFetch(providerRainFixture(undefined));
  const forecast = await weatherApiProvider.getForecast(50, 8);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const panel = { ...renderTarget(), hidden: true, setAttribute() {}, removeAttribute() {} };
  const button = { classList: { add() {}, remove() {} }, setAttribute() {} };
  const doc = { getElementById: () => panel, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  Object.defineProperty(globalThis, "window", { value: { setTimeout: () => 0 }, configurable: true });
  try {
    const el = { ...renderTarget(), querySelector: () => button };
    renderHourlyStrip(el as unknown as HTMLElement, forecast, true);
    assert.match(panel.innerHTML, /Regenwahrscheinlichkeit<\/span><span class="cw-meta-val">–<\/span>/);
    forecast.hourly[0].precipitationProbability = 0;
    renderHourlyStrip(el as unknown as HTMLElement, forecast, true);
    assert.match(panel.innerHTML, /Regenwahrscheinlichkeit<\/span><span class="cw-meta-val">0\u202F%<\/span>/);
    assert.doesNotMatch(panel.innerHTML, /Schneewahrscheinlichkeit/);
    forecast.hourly[0].snowProbability = 70;
    forecast.hourly[0].precipitation = 0;
    forecast.hourly[0].snowfall = 1.5;
    renderHourlyStrip(el as unknown as HTMLElement, forecast, true);
    assert.match(panel.innerHTML, /Schneewahrscheinlichkeit<\/span><span class="cw-meta-val">70\u202F%<\/span>/);
    assert.match(panel.innerHTML, /Schnee<\/span><span class="cw-meta-val">1,5 cm<\/span>/);
    assert.doesNotMatch(panel.innerHTML, /Niederschlagsmenge<\/span>/);
    forecast.hourly[0].snowProbability = 0;
    forecast.hourly[0].weatherCode = 71;
    renderHourlyStrip(el as unknown as HTMLElement, forecast, true);
    assert.match(panel.innerHTML, /Schneewahrscheinlichkeit<\/span><span class="cw-meta-val">0\u202F%<\/span>/);
    forecast.hourly[0].snowProbability = null;
    renderHourlyStrip(el as unknown as HTMLElement, forecast, true);
    assert.match(panel.innerHTML, /Schneewahrscheinlichkeit<\/span><span class="cw-meta-val">–<\/span>/);
    forecast.hourly[0].precipitation = 1.25;
    renderHourlyStrip(el as unknown as HTMLElement, forecast, true);
    assert.match(panel.innerHTML, /Niederschlagsmenge<\/span><span class="cw-meta-val">1,3 mm<\/span>/);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete (globalThis as { document?: unknown }).document;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});

test("unknown probabilities cannot produce a no-rain recommendation or dry summary", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2099-07-15T12:00:00Z") });
  installProviderFetch(providerRainFixture(undefined));
  const forecast = withProbabilities(await weatherApiProvider.getForecast(50, 8), [null, null, null]);
  const dress = renderTarget();
  renderDressToday(dress as unknown as HTMLElement, forecast);

  assert.match(dress.innerHTML, /Regenwahrscheinlichkeit nicht vollständig verfügbar/);
  assert.doesNotMatch(dress.innerHTML, /Kein Regen/);
  assert.equal(rainWindowFor(forecast.hourly), null);
  assert.equal(dryWindowFor(forecast), null);
  assert.notDeepEqual(summaryFor(forecast), { kind: "fixed", key: "sum1_cold_overcast" });
  assert.equal(bestWeatherDayKey(forecast.daily), null);
});

test("unknown hours neither bridge a dry gap nor act as evidence of rain", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2099-07-15T12:00:00Z") });
  installProviderFetch(providerRainFixture(0));
  const forecast = await weatherApiProvider.getForecast(50, 8);
  const gap = withProbabilities(forecast, [80, 0, null, 0, 80]);
  assert.equal(dryWindowFor(gap), null);
  assert.equal(dryWindowFor(withProbabilities(forecast, [0, null, 0, 0])), null);

  const known = withProbabilities(forecast, [80, 0, 0, 80]);
  assert.deepEqual(dryWindowFor(known), { fromHour: 13, toHour: 15, untilSunset: false });
  assert.deepEqual(summaryFor(withProbabilities(forecast, [0, 0, 0])), { kind: "fixed", key: "sum1_cold_overcast" });
  assert.notDeepEqual(summaryFor(withProbabilities(forecast, [0, null, 0])), { kind: "fixed", key: "sum1_cold_overcast" });
  const dress = renderTarget();
  renderDressToday(dress as unknown as HTMLElement, withProbabilities(forecast, [0, 0, 0]));
  assert.match(dress.innerHTML, /Kein Regen erwartet/);
});

test("known wet hours remain usable even when another probability is missing", async () => {
  installProviderFetch(providerRainFixture(70));
  const forecast = withProbabilities(await weatherApiProvider.getForecast(50, 8), [null, 70, null]);
  const dress = renderTarget();
  renderDressToday(dress as unknown as HTMLElement, forecast);

  assert.deepEqual(rainWindowFor(forecast.hourly), { maxProb: 70, fromHour: 13, toHour: 14 });
  assert.match(dress.innerHTML, /Regen 70\u202F% zwischen 13 und 14 Uhr/);
});

test("rain highlights distinguish complete, partial and entirely missing probabilities", async () => {
  installProviderFetch(providerRainFixture(0));
  const forecast = await weatherApiProvider.getForecast(50, 8);
  const el = renderTarget();
  const heading = renderTarget();
  const render = (values: Array<number | null>) => {
    renderTodayHighlights(el as unknown as HTMLElement, heading as unknown as HTMLElement, withProbabilities(forecast, values));
    return el.innerHTML;
  };

  assert.match(render([0, 0, 0]), /Regenmaximum<\/span><strong class="environment-value">0\u202F%/);
  assert.match(render([0, null, 20]), /Höchste bekannte Regenchance<\/span><strong class="environment-value">20\u202F%/);
  assert.match(render([null, 0, null]), /Höchste bekannte Regenchance<\/span><strong class="environment-value">0\u202F%/);
  assert.doesNotMatch(render([null, null, null]), /Regenmaximum|Höchste bekannte Regenchance/);
});

test("weekly choice ignores a missing probability but accepts a real zero", async () => {
  installProviderFetch(providerRainFixture(undefined));
  const forecast = await weatherApiProvider.getForecast(50, 8);
  const missing = { ...forecast.daily[0], weatherCode: 0, tempMax: 30 };
  const known = { ...missing, tempMax: 20, precipitationProbabilityMax: 0 };

  assert.equal(bestWeatherDayKey([missing]), null);
  assert.deepEqual(bestWeatherDayKey([missing, known]), { key: "week_best_day", dayIndex: 1 });
});

test("daily snow chance stays separate from rain and precipitation total", async () => {
  installProviderFetch(forecastFixture({ rainChance: 0, snowChance: 65 }));
  const forecast = await weatherApiProvider.getForecast(50, 8);
  const daily = renderTarget();
  renderDailyForecast(daily as unknown as HTMLElement, forecast.daily, 7);
  assert.match(daily.innerHTML, /Schneewahrscheinlichkeit<\/span><span class="cw-meta-val">65\u202F%<\/span>/);
  assert.match(daily.innerHTML, /Niederschlagsmenge<\/span><span class="cw-meta-val">1,2 mm<\/span>/);
  assert.doesNotMatch(daily.innerHTML, /Regenmenge|Rain total/);
  renderDailyForecast(daily as unknown as HTMLElement, [{ ...forecast.daily[0], weatherCode: 71, snowProbabilityMax: null }], 7);
  assert.match(daily.innerHTML, /Schneewahrscheinlichkeit<\/span><span class="cw-meta-val">–<\/span>/);
});

test("rain and snow probabilities remain independent across provider and JSON boundaries", async () => {
  for (const [rain, snow, expectedRain, expectedSnow] of [
    [65, 0, 65, 0], [0, 70, 0, 70], [45, 55, 45, 55],
    [undefined, 40, null, 40], [40, undefined, 40, null],
    [undefined, undefined, null, null], [0, 0, 0, 0],
    [10, null, 10, null], [10, "invalid", 10, null], [10, 120, 10, null],
    [10, true, 10, null], [10, false, 10, null], [10, 10.5, 10, null],
  ] as const) {
    const raw = forecastFixture();
    const day = (raw.forecast as { forecastday: Array<{ day: Record<string, unknown>; hour: Array<Record<string, unknown>> }> }).forecastday[0];
    for (const [target, rainKey, snowKey] of [
      [day.day, "daily_chance_of_rain", "daily_chance_of_snow"],
      ...day.hour.map((hour): [Record<string, unknown>, string, string] => [hour, "chance_of_rain", "chance_of_snow"]),
    ] as Array<[Record<string, unknown>, string, string]>) {
      if (rain === undefined) delete target[rainKey]; else target[rainKey] = rain;
      if (snow === undefined) delete target[snowKey]; else target[snowKey] = snow;
    }
    installProviderFetch(raw);
    const forecast = await weatherApiProvider.getForecast(50, 8);
    assert.equal(forecast.daily[0].precipitationProbabilityMax, expectedRain);
    assert.equal(forecast.daily[0].snowProbabilityMax, expectedSnow);
    assert.deepEqual(forecast.hourly.map((h) => [h.precipitationProbability, h.snowProbability]), [[expectedRain, expectedSnow], [expectedRain, expectedSnow]]);
    const stored = JSON.parse(JSON.stringify(forecast)) as Forecast;
    assert.equal(stored.hourly[0].snowProbability, expectedSnow);
    assert.equal(stored.daily[0].snowProbabilityMax, expectedSnow);
  }
});

test("official winter and thunder conditions keep their precipitation type", () => {
  const cases: Array<[number, string, string]> = [
    [1183, "wmo_rain_slight", "Leichter Regen"],
    [1213, "wmo_snow_slight", "Leichter Schneefall"],
    [1069, "weather_sleet_possible", "Schneeregen möglich"],
    [1204, "weather_sleet_light", "Leichter Schneeregen"],
    [1207, "weather_sleet_heavy", "Mäßiger oder starker Schneeregen"],
    [1249, "weather_sleet_showers_light", "Leichte Schneeregenschauer"],
    [1252, "weather_sleet_showers_heavy", "Mäßige oder starke Schneeregenschauer"],
    [1237, "weather_ice_pellets", "Eiskörner"],
    [1261, "weather_ice_pellet_showers_light", "Leichte Eiskörnerschauer"],
    [1264, "weather_ice_pellet_showers_heavy", "Mäßige oder starke Eiskörnerschauer"],
    [1198, "wmo_freezing_rain_light", "Leichter gefrierender Regen"],
    [1201, "wmo_freezing_rain_heavy", "Gefrierender Regen"],
    [1273, "weather_thunder_rain_light", "Leichter Regen mit Gewitter"],
    [1276, "weather_thunder_rain_heavy", "Mäßiger oder starker Regen mit Gewitter"],
    [1279, "weather_thunder_snow_light", "Leichter Schnee mit Gewitter"],
    [1282, "weather_thunder_snow_heavy", "Mäßiger oder starker Schnee mit Gewitter"],
    [9999, "wmo_unknown", "Unbekannt"],
  ];
  for (const [providerCode, key, german] of cases) {
    const code = weatherApiCodeToWmo(providerCode);
    assert.equal(getWmo(code).labelKey, key);
    assert.equal(weatherLabel(key, "de"), german);
    if (providerCode !== 9999) {
      for (const lang of ["en", "tr"] as const) assert.notEqual(weatherLabel(key, lang), weatherLabel("wmo_unknown", lang));
    }
    assert.equal(pickIcon(code, true) === "circle-question-mark", providerCode === 9999);
    assert.equal(isPrecipCode(code), providerCode !== 9999);
  }
  assert.equal(weatherLabelShort(getWmo(weatherApiCodeToWmo(1204)).labelKey, "de"), "Schneeregen");
  assert.equal(weatherLabelShort(getWmo(weatherApiCodeToWmo(1237)).labelKey, "de"), "Eiskörner");
});

test("general dry claims require both known probabilities and no precipitation condition", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2099-07-15T12:00:00Z") });
  installProviderFetch(forecastFixture({ rainChance: 0, snowChance: 0 }));
  const raw = await weatherApiProvider.getForecast(50, 8);
  const dry = withProbabilities(raw, [80, 0, 0, 80]);
  assert.deepEqual(dryWindowFor(dry), { fromHour: 13, toHour: 15, untilSunset: false });
  assert.equal(dryWindowFor({ ...dry, hourly: dry.hourly.map((h, i) => ({ ...h, snowProbability: i === 1 ? 80 : 0 })) }), null);
  assert.equal(dryWindowFor({ ...dry, hourly: dry.hourly.map((h, i) => ({ ...h, snowProbability: i === 1 ? null : 0 })) }), null);
  assert.equal(dryWindowFor({ ...dry, hourly: dry.hourly.map((h, i) => ({ ...h, weatherCode: i === 1 ? 71 : 0 })) }), null);
  assert.equal(dryWindowFor({ ...dry, hourly: dry.hourly.map((h, i) => ({ ...h, snowfall: i === 1 ? 1 : 0 })) }), null);
  const allDry = withProbabilities(raw, [0, 0, 0]);
  assert.deepEqual(summaryFor(allDry), { kind: "fixed", key: "sum1_cold_overcast" });
  assert.deepEqual(summaryFor({ ...allDry, hourly: allDry.hourly.map((h) => ({ ...h, precipitationProbability: 25, snowProbability: 25 })) }), { kind: "fixed", key: "sum1_cold_overcast" });
  assert.notDeepEqual(summaryFor({ ...allDry, hourly: allDry.hourly.map((h, i) => ({ ...h, snowProbability: i === 1 ? 80 : 0 })) }), { kind: "fixed", key: "sum1_cold_overcast" });
  assert.notDeepEqual(summaryFor({ ...allDry, hourly: allDry.hourly.map((h, i) => ({ ...h, snowProbability: i === 1 ? null : 0 })) }), { kind: "fixed", key: "sum1_cold_overcast" });
  assert.notDeepEqual(summaryFor({ ...allDry, hourly: allDry.hourly.map((h, i) => ({ ...h, precipitation: i === 1 ? 1 : 0 })) }), { kind: "fixed", key: "sum1_cold_overcast" });
  assert.notDeepEqual(summaryFor({ ...allDry, current: { ...allDry.current, weatherCode: 71 } }), { kind: "fixed", key: "sum1_cold_dry" });
  const snowNow = summaryFor({ ...allDry, current: { ...allDry.current, weatherCode: 71, apparentTemperature: 16 } });
  assert.notDeepEqual(snowNow, { kind: "fixed", key: "sum1_rain_mild" });
  assert.equal(snowNow?.kind === "modular" && snowNow.closer === "sum_c_umbrella", false);
  for (const providerCode of [1069, 1204, 1237, 1261, 1279, 1282]) {
    const result = summaryFor({ ...allDry, current: { ...allDry.current, weatherCode: weatherApiCodeToWmo(providerCode), apparentTemperature: 16 } });
    assert.notDeepEqual(result, { kind: "fixed", key: "sum1_rain_mild" });
    assert.equal(result?.kind === "modular" && result.closer === "sum_c_umbrella", false);
  }
  for (const providerCode of [1183, 1198, 1273]) {
    assert.deepEqual(summaryFor({ ...allDry, current: { ...allDry.current, weatherCode: weatherApiCodeToWmo(providerCode), apparentTemperature: 16 } }), { kind: "fixed", key: "sum1_rain_mild" });
  }
  assert.equal(bestWeatherDayKey([{ ...raw.daily[0], weatherCode: 0, tempMax: 22, precipitationProbabilityMax: 0, snowProbabilityMax: null }]), null);
  assert.deepEqual(bestWeatherDayKey([{ ...raw.daily[0], weatherCode: 0, tempMax: 22, precipitationProbabilityMax: 0, snowProbabilityMax: 0 }]), { key: "week_best_today", dayIndex: 0 });
});
