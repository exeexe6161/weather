import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { fetchFavoritesWeather } from "../src/lib/favoritesWeather.ts";
import { searchCity } from "../src/lib/geocoding.ts";
import { fetchPollen } from "../src/lib/pollen.ts";
import { fetchWeather } from "../src/lib/weather.ts";

interface FetchCall {
  input: string | URL | Request;
  init?: RequestInit;
}

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let calls: FetchCall[];

function setWebPlatform(): void {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
}

function setNativePlatform(): void {
  Object.defineProperty(globalThis, "window", {
    value: { Capacitor: { isNativePlatform: () => true } },
    configurable: true,
    writable: true,
  });
}

function captureFetch(responseBody: unknown = {}): void {
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return Response.json(responseBody);
  };
}

function assertJsonPost(call: FetchCall, expectedUrl: string, expectedBody: unknown): void {
  assert.equal(String(call.input), expectedUrl);
  assert.equal(call.init?.method, "POST");
  assert.equal(new Headers(call.init?.headers).get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(call.init?.body)), expectedBody);
  assert.equal(String(call.input).includes("lat="), false);
  assert.equal(String(call.input).includes("lon="), false);
  assert.equal(String(call.input).includes("places="), false);
}

beforeEach(() => {
  calls = [];
  setWebPlatform();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
});

test("weather client posts coordinates as JSON to the web API path", async () => {
  captureFetch({ current: {}, hourly: [], daily: [], timezone: "Europe/Berlin" });

  await fetchWeather(50.123456, 8.654321);

  assert.equal(calls.length, 1);
  assertJsonPost(calls[0], "/api/weather", { lat: 50.123456, lon: 8.654321 });
});

test("pollen client posts coordinates as JSON to the native API base", async () => {
  setNativePlatform();
  captureFetch({ grass: 5 });

  await fetchPollen(48.137154, 11.576124);

  assert.equal(calls.length, 1);
  assertJsonPost(calls[0], "https://weatherpure.com/api/pollen", { lat: 48.137154, lon: 11.576124 });
});

test("favorites client posts the direct JSON array without coordinates in the URL", async () => {
  setNativePlatform();
  captureFetch([]);
  const places = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    name: `Place ${index + 1}`,
    latitude: 50 + index / 10,
    longitude: 8 + index / 10,
    country: "Germany",
    countryCode: "DE",
  }));

  await fetchFavoritesWeather(places);

  assert.equal(calls.length, 1);
  assertJsonPost(
    calls[0],
    "https://weatherpure.com/api/favorites-weather",
    places.map(({ id, latitude, longitude }) => ({ id, latitude, longitude })),
  );
});

test("geocoding client remains GET on the web API path", async () => {
  captureFetch([]);

  await searchCity("Berlin", "de");

  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].input), "/api/geocoding?q=Berlin&lang=de");
  assert.equal(calls[0].init?.method, undefined);
  assert.equal(new Headers(calls[0].init?.headers).has("Content-Type"), false);
});

test("client error behavior remains compatible", async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(fetchWeather(50, 8), /Weather request failed: 503/);
  assert.equal(await fetchPollen(50, 8), null);
  await assert.rejects(fetchFavoritesWeather([{
    id: 1,
    name: "Fixture",
    latitude: 50,
    longitude: 8,
    country: "Germany",
    countryCode: "DE",
  }]), /Favorites weather request failed: 503/);
});
