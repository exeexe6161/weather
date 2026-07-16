export const WEATHER_QUOTA_POLICY = Object.freeze({
  burstCapacity: 300,
  refillTokensPerSecond: 5,
  burstWindowMs: 60_000,
  monthlyLimit: 2_000_000,
});

export type QuotaReservationStatus = "reserved" | "burst_exhausted" | "monthly_exhausted";

export interface QuotaReservationRequest {
  readonly namespace: "weatherapi";
  readonly burstKey: "weatherapi:quota:burst";
  readonly monthlyKey: string;
  readonly month: string;
  readonly nowMs: number;
  readonly monthlyTtlSeconds: number;
  readonly policy: Readonly<typeof WEATHER_QUOTA_POLICY>;
}

export interface QuotaReservationDecision {
  readonly status: QuotaReservationStatus;
  readonly burstRemaining: number;
  readonly monthlyRemaining: number;
  readonly month: string;
}

// Der Upstash Adapter prueft und reserviert Burst und Monatsbudget innerhalb
// genau einer global atomaren Operation. Diese Schnittstelle bietet bewusst
// keine lokale Produktionsimplementierung und keine Rueckbuchung.
export interface QuotaReservationAdapter {
  reserve(request: QuotaReservationRequest): Promise<unknown>;
}

export interface UpstashQuotaReservationAdapterOptions {
  readonly restUrl?: string;
  readonly restToken?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

export class WeatherQuotaProtectionError extends Error {
  constructor() {
    super("Weather service is temporarily unavailable");
    this.name = "WeatherQuotaProtectionError";
  }
}

let testAdapter: QuotaReservationAdapter | null | undefined;

const UPSTASH_REQUEST_TIMEOUT_MS = 2_000;

// Burst und Monatsbudget werden in genau einem Redis Script gelesen, geprueft
// und bei Erfolg gemeinsam fortgeschrieben. Eine Pipeline oder getrennte
// REST Aufrufe waeren nicht atomar und sind hier deshalb bewusst ausgeschlossen.
const RESERVE_QUOTA_SCRIPT = `
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_per_second = tonumber(ARGV[3])
local burst_ttl_ms = tonumber(ARGV[4])
local monthly_limit = tonumber(ARGV[5])
local monthly_ttl_seconds = tonumber(ARGV[6])
local month = ARGV[7]

local burst = redis.call("HMGET", KEYS[1], "tokens", "updated_at_ms")
if (burst[1] and not tonumber(burst[1])) or (burst[2] and not tonumber(burst[2])) then
  return {"invalid_counter", 0, 0, month}
end

local tokens = tonumber(burst[1]) or capacity
local updated_at_ms = tonumber(burst[2]) or now_ms
if tokens < 0 or tokens > capacity or updated_at_ms < 0 then
  return {"invalid_counter", 0, 0, month}
end
if now_ms < updated_at_ms then
  now_ms = updated_at_ms
end

local elapsed_ms = now_ms - updated_at_ms
tokens = math.min(capacity, tokens + (elapsed_ms * refill_per_second / 1000))

local monthly_raw = redis.call("GET", KEYS[2])
if monthly_raw and not tonumber(monthly_raw) then
  return {"invalid_counter", 0, 0, month}
end
local monthly_used = tonumber(monthly_raw) or 0
if monthly_used < 0 or monthly_used ~= math.floor(monthly_used) then
  return {"invalid_counter", 0, 0, month}
end

if monthly_used >= monthly_limit then
  return {"monthly_exhausted", math.floor(tokens), 0, month}
end
if tokens < 1 then
  return {"burst_exhausted", 0, monthly_limit - monthly_used, month}
end

tokens = tokens - 1
monthly_used = monthly_used + 1
redis.call("HSET", KEYS[1], "tokens", tostring(tokens), "updated_at_ms", tostring(now_ms))
redis.call("PEXPIRE", KEYS[1], burst_ttl_ms)
redis.call("SET", KEYS[2], tostring(monthly_used), "EX", monthly_ttl_seconds)

return {"reserved", math.floor(tokens), monthly_limit - monthly_used, month}
`.trim();

function runtimeEnvironment(): Record<string, string | undefined> {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env ?? {};
}

function validRestUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash) throw new WeatherQuotaProtectionError();
  return url.href.replace(/\/$/, "");
}

function adapterConfiguration(options: UpstashQuotaReservationAdapterOptions): {
  restUrl: string;
  restToken: string;
  fetchImplementation: typeof fetch;
  timeoutMs: number;
} {
  const environment = runtimeEnvironment();
  const restUrl = (options.restUrl ?? environment.UPSTASH_REDIS_REST_URL)?.trim();
  const restToken = (options.restToken ?? environment.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const timeoutMs = options.timeoutMs ?? UPSTASH_REQUEST_TIMEOUT_MS;
  if (!restUrl || !restToken || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new WeatherQuotaProtectionError();
  }
  return {
    restUrl: validRestUrl(restUrl),
    restToken,
    fetchImplementation: options.fetchImplementation ?? globalThis.fetch,
    timeoutMs,
  };
}

function redisDecision(value: unknown): unknown {
  if (value === null || typeof value !== "object") return null;
  const result = (value as Record<string, unknown>).result;
  if (!Array.isArray(result) || result.length !== 4) return null;
  const [status, burstRemaining, monthlyRemaining, month] = result;
  return {
    status,
    burstRemaining: typeof burstRemaining === "number" ? burstRemaining : Number(burstRemaining),
    monthlyRemaining: typeof monthlyRemaining === "number" ? monthlyRemaining : Number(monthlyRemaining),
    month,
  };
}

export function createUpstashQuotaReservationAdapter(
  options: UpstashQuotaReservationAdapterOptions = {},
): QuotaReservationAdapter {
  return {
    async reserve(request) {
      const { restUrl, restToken, fetchImplementation, timeoutMs } = adapterConfiguration(options);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation(restUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${restToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            "EVAL",
            RESERVE_QUOTA_SCRIPT,
            "2",
            request.burstKey,
            request.monthlyKey,
            request.nowMs,
            request.policy.burstCapacity,
            request.policy.refillTokensPerSecond,
            request.policy.burstWindowMs,
            request.policy.monthlyLimit,
            request.monthlyTtlSeconds,
            request.month,
          ]),
          signal: controller.signal,
        });
        if (!response.ok) throw new WeatherQuotaProtectionError();
        return redisDecision(await response.json());
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

const productionAdapter = createUpstashQuotaReservationAdapter();

// Ausschliesslich fuer deterministische Test Doubles. Ohne echte Upstash REST
// Konfiguration bleibt der Produktpfad absichtlich Fail Closed.
export function setQuotaReservationAdapterForTesting(
  adapter: QuotaReservationAdapter | null | undefined,
): void {
  testAdapter = adapter;
}

export function utcMonthBucket(nowMs: number): string {
  if (!Number.isFinite(nowMs)) throw new WeatherQuotaProtectionError();
  const date = new Date(nowMs);
  if (Number.isNaN(date.getTime())) throw new WeatherQuotaProtectionError();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function secondsUntilNextUtcMonth(nowMs: number): number {
  const date = new Date(nowMs);
  const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((nextMonth - nowMs) / 1_000));
}

function reservationRequest(nowMs: number): QuotaReservationRequest {
  const month = utcMonthBucket(nowMs);
  return Object.freeze({
    namespace: "weatherapi",
    burstKey: "weatherapi:quota:burst",
    monthlyKey: `weatherapi:quota:month:${month}`,
    month,
    nowMs,
    monthlyTtlSeconds: secondsUntilNextUtcMonth(nowMs),
    policy: WEATHER_QUOTA_POLICY,
  });
}

function isBoundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function validDecision(value: unknown, request: QuotaReservationRequest): value is QuotaReservationDecision {
  if (value === null || typeof value !== "object") return false;
  const decision = value as Record<string, unknown>;
  if (decision.status !== "reserved"
    && decision.status !== "burst_exhausted"
    && decision.status !== "monthly_exhausted") return false;
  if (decision.month !== request.month) return false;
  if (!isBoundedInteger(decision.burstRemaining, request.policy.burstCapacity)) return false;
  if (!isBoundedInteger(decision.monthlyRemaining, request.policy.monthlyLimit)) return false;
  if (decision.status === "reserved"
    && (decision.burstRemaining >= request.policy.burstCapacity
      || decision.monthlyRemaining >= request.policy.monthlyLimit)) return false;
  if (decision.status === "burst_exhausted" && decision.burstRemaining !== 0) return false;
  if (decision.status === "monthly_exhausted" && decision.monthlyRemaining !== 0) return false;
  return true;
}

export async function reserveWeatherProviderQuota(nowMs = Date.now()): Promise<void> {
  const adapter = testAdapter === undefined ? productionAdapter : testAdapter;
  if (adapter === null) throw new WeatherQuotaProtectionError();

  const request = reservationRequest(nowMs);
  let decision: unknown;
  try {
    decision = await adapter.reserve(request);
  } catch {
    throw new WeatherQuotaProtectionError();
  }

  if (!validDecision(decision, request) || decision.status !== "reserved") {
    throw new WeatherQuotaProtectionError();
  }
}
