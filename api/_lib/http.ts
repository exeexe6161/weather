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

function requestHeader(req: ApiRequest, name: string): string | null {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : null;
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
