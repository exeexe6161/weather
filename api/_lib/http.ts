// Schlanke, lokale Typen für Vercel Node Functions statt einer @vercel/node
// Abhängigkeit: res.status()/res.json()/req.query stehen zur Laufzeit auf
// Vercel ohnehin zur Verfügung, dieses Interface bildet nur ab, was die
// Routes tatsächlich nutzen (kein Fremdtyp-Import nötig, kein Dependency
// Zuwachs für ein paar Handler).
export interface ApiRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
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
    res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    sendError(res, 429, "Too many requests");
    return false;
  }
  return true;
}

// Browser requests stay same-origin. Only the local Capacitor origins used by
// the native iOS/Android shells may read API responses cross-origin.
export function corsGuard(req: ApiRequest, res: ApiResponse): boolean {
  const origin = requestHeader(req, "origin");
  const allowed = origin !== null && ALLOWED_APP_ORIGINS.has(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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

export function sendError(res: ApiResponse, status: number, message: string): void {
  res.status(status).json({ error: message });
}

export function methodGuard(req: ApiRequest, res: ApiResponse): boolean {
  if (req.method !== "GET") {
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

export function isValidLatitude(v: number): boolean {
  return Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLongitude(v: number): boolean {
  return Number.isFinite(v) && v >= -180 && v <= 180;
}
