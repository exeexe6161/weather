// Schlanke, lokale Typen für Vercel Node Functions statt einer @vercel/node
// Abhängigkeit: res.status()/res.json()/req.query stehen zur Laufzeit auf
// Vercel ohnehin zur Verfügung, dieses Interface bildet nur ab, was die
// Routes tatsächlich nutzen (kein Fremdtyp-Import nötig, kein Dependency
// Zuwachs für ein paar Handler).
export interface ApiRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
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
