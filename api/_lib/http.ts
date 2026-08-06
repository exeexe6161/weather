import { mapServerError } from "../../src/server/weather/errorMapping.js";

// Schlanke, lokale Typen für Vercel Node Functions statt einer @vercel/node
// Abhängigkeit: res.status()/res.json()/req.query stehen zur Laufzeit auf
// Vercel ohnehin zur Verfügung, dieses Interface bildet nur ab, was die
// Routes tatsächlich nutzen (kein Fremdtyp-Import nötig, kein Dependency
// Zuwachs für ein paar Handler).
export interface ApiRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string): ApiResponse;
  json(body: unknown): void;
  end(): void;
}

const ALLOWED_APP_ORIGINS = new Set([
  "capacitor://localhost",
  "http://localhost",
]);

export const GET_METHODS = ["GET"] as const;
export const GET_POST_METHODS = ["GET", "POST"] as const;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const RATE_LIMIT_MAX_ENTRIES = 5_000;
const RATE_LIMIT_SALT = `${Date.now()}-${Math.random()}`;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function requestHeader(req: ApiRequest, name: string): string | null {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : null;
}

function rateLimitKey(req: ApiRequest): string {
  const forwarded = requestHeader(req, "x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || requestHeader(req, "x-real-ip")?.trim() || "unknown";
  const input = `${RATE_LIMIT_SALT}:${address}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function pruneRateLimits(now: number): void {
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) rateLimitStore.delete(key);
  }
  while (rateLimitStore.size >= RATE_LIMIT_MAX_ENTRIES) {
    const oldest = rateLimitStore.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    rateLimitStore.delete(oldest);
  }
}

// Per warmer Function Instanz. Der kurzlebige, gesalzene Schluessel verhindert,
// dass eine rohe Verbindungsadresse im Anwendungsspeicher liegt. Vercel Firewall
// Regeln koennen spaeter zusaetzlich global begrenzen.
export function rateLimitGuard(req: ApiRequest, res: ApiResponse): boolean {
  const now = Date.now();
  pruneRateLimits(now);
  const key = rateLimitKey(req);
  const current = rateLimitStore.get(key);
  const entry = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  entry.count += 1;
  rateLimitStore.delete(key);
  rateLimitStore.set(key, entry);

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count);
  res.setHeader("RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    // Hier bleibt die ECHTE Restzeit stehen, anders als beim 503. Dieses Limit
    // gilt nur für diesen einen Aufrufer und spiegelt seine eigene Aktivität;
    // es verrät nichts über den globalen Schutzzustand.
    res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    sendError(res, 429, "Too many requests", "rate_limited");
    return false;
  }
  return true;
}

// Browser requests stay same-origin. Only the local Capacitor origins used by
// the native iOS/Android shells may read API responses cross-origin.
export function corsGuard(
  req: ApiRequest,
  res: ApiResponse,
  allowedMethods: readonly string[] = GET_METHODS,
): boolean {
  const origin = requestHeader(req, "origin");
  const allowed = origin !== null && ALLOWED_APP_ORIGINS.has(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", [...allowedMethods, "OPTIONS"].join(", "));
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (!allowed) {
      sendError(res, 403, "Origin not allowed");
      return false;
    }
    res.status(204).end();
    return false;
  }
  return true;
}

// `reason` ist ein grober, stabiler Code für Aufrufer und für die Prüfung nach
// einem Deployment. Er bleibt optional, damit die bestehenden 4xx Antworten
// wortgleich bleiben und kein Aufrufer bricht.
export function sendError(res: ApiResponse, status: number, message: string, reason?: string): void {
  res.status(status).json(reason === undefined ? { error: message } : { error: message, reason });
}

// Einzige Stelle, an der ein geworfener Fehler zu einer Antwort wird. Alle vier
// Routen gehen hierüber, damit es keine zweite Zuordnungstabelle gibt, die
// auseinanderlaufen könnte.
//
// Bewusst OHNE Logging. Vercel hält den Statuscode jeder Anfrage ohnehin fest,
// und die Zuordnung Status zu Reason ist eindeutig — ein zusätzliches
// console.* brächte keine neue Information, würde aber einen Pfad schaffen, auf
// dem versehentlich ein Rohfehler landen könnte. Genau das ist hier gefährlich:
// die Anfrage URL des Providers trägt den WeatherAPI Schlüssel als
// Query Parameter, und ein Netzwerkfehler aus fetch führt die Ziel URL je nach
// Laufzeit in seiner Meldung oder in `cause` mit. Ein `console.error(err)` auf
// diesem Pfad könnte den Schlüssel in die Logs schreiben. Der Fehlerwert wird
// deshalb ausschließlich an mapServerError gereicht, das allein seinen `name`
// liest und feste Texte zurückgibt.
export function sendMappedError(res: ApiResponse, err: unknown): void {
  const mapped = mapServerError(err);
  if (mapped.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(mapped.retryAfterSeconds));
  }
  sendError(res, mapped.status, mapped.message, mapped.reason);
}

export function methodGuard(
  req: ApiRequest,
  res: ApiResponse,
  allowedMethods: readonly string[] = GET_METHODS,
): boolean {
  if (!req.method || !allowedMethods.includes(req.method)) {
    sendError(res, 405, "Method not allowed");
    return false;
  }
  return true;
}

export function queryParam(req: ApiRequest, key: string): string | null {
  const v = req.query[key];
  const raw = Array.isArray(v) ? v[0] : v;
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

export function queryNumber(req: ApiRequest, key: string): number | null {
  const raw = queryParam(req, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false };

export function jsonBody(req: ApiRequest, res: ApiResponse): JsonBodyResult {
  const contentType = requestHeader(req, "content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    sendError(res, 415, "Content-Type must be application/json");
    return { ok: false };
  }

  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) as unknown };
    } catch {
      sendError(res, 400, "Invalid JSON body");
      return { ok: false };
    }
  }
  if (req.body === undefined) {
    sendError(res, 400, "Invalid JSON body");
    return { ok: false };
  }
  return { ok: true, value: req.body };
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function requestCoordinates(req: ApiRequest, res: ApiResponse): Coordinates | null {
  let latitude: number | null;
  let longitude: number | null;

  if (req.method === "POST") {
    const parsed = jsonBody(req, res);
    if (!parsed.ok) return null;
    if (!hasExactKeys(parsed.value, ["lat", "lon"])) {
      sendError(res, 400, "Invalid or missing lat/lon");
      return null;
    }
    latitude = typeof parsed.value.lat === "number" ? parsed.value.lat : null;
    longitude = typeof parsed.value.lon === "number" ? parsed.value.lon : null;
  } else {
    latitude = queryNumber(req, "lat");
    longitude = queryNumber(req, "lon");
  }

  if (latitude === null || longitude === null || !isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    sendError(res, 400, "Invalid or missing lat/lon");
    return null;
  }
  return { latitude, longitude };
}

export function isValidLatitude(v: number): boolean {
  return Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLongitude(v: number): boolean {
  return Number.isFinite(v) && v >= -180 && v <= 180;
}
