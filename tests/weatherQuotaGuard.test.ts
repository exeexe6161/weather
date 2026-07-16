import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { blockUnexpectedNetwork, loadBundledModule } from './testHarness.ts';

interface QuotaPolicy {
  burstCapacity: number;
  refillTokensPerSecond: number;
  burstWindowMs: number;
  monthlyLimit: number;
}

interface QuotaReservationRequest {
  namespace: string;
  burstKey: string;
  monthlyKey: string;
  month: string;
  nowMs: number;
  monthlyTtlSeconds: number;
  policy: QuotaPolicy;
}

interface QuotaDecision {
  status: 'reserved' | 'burst_exhausted' | 'monthly_exhausted';
  burstRemaining: number;
  monthlyRemaining: number;
  month: string;
}

interface QuotaReservationAdapter {
  reserve(request: QuotaReservationRequest): Promise<unknown>;
}

interface QuotaModule {
  WEATHER_QUOTA_POLICY: QuotaPolicy;
  createUpstashQuotaReservationAdapter(options?: {
    restUrl?: string;
    restToken?: string;
    fetchImplementation?: typeof fetch;
    timeoutMs?: number;
  }): QuotaReservationAdapter;
  reserveWeatherProviderQuota(nowMs?: number): Promise<void>;
  setQuotaReservationAdapterForTesting(adapter: QuotaReservationAdapter | null | undefined): void;
  utcMonthBucket(nowMs: number): string;
  WeatherQuotaProtectionError: new (...args: never[]) => Error;
  WeatherService: {
    getForecast(latitude: number, longitude: number): Promise<unknown>;
  };
}

const quota = await loadBundledModule<QuotaModule>(`
  export {
    WEATHER_QUOTA_POLICY,
    createUpstashQuotaReservationAdapter,
    reserveWeatherProviderQuota,
    setQuotaReservationAdapterForTesting,
    utcMonthBucket,
    WeatherQuotaProtectionError,
  } from './src/server/weather/quotaGuard.ts';
  export { WeatherService } from './src/server/weather/WeatherService.ts';
`);

class AtomicQuotaDouble implements QuotaReservationAdapter {
  readonly requests: QuotaReservationRequest[] = [];
  private tokens: number;
  private lastRefillMs: number | null = null;
  private month: string | null = null;
  private monthlyUsed: number;

  constructor(options: { tokens?: number; monthlyUsed?: number } = {}) {
    this.tokens = options.tokens ?? quota.WEATHER_QUOTA_POLICY.burstCapacity;
    this.monthlyUsed = options.monthlyUsed ?? 0;
  }

  async reserve(request: QuotaReservationRequest): Promise<QuotaDecision> {
    this.requests.push(structuredClone(request));

    if (this.month === null) {
      this.month = request.month;
    } else if (this.month !== request.month) {
      this.month = request.month;
      this.monthlyUsed = 0;
    }

    if (this.lastRefillMs === null) this.lastRefillMs = request.nowMs;
    const elapsedMs = Math.max(0, request.nowMs - this.lastRefillMs);
    this.tokens = Math.min(
      request.policy.burstCapacity,
      this.tokens + elapsedMs * request.policy.refillTokensPerSecond / 1_000,
    );
    this.lastRefillMs = request.nowMs;

    if (this.monthlyUsed >= request.policy.monthlyLimit) {
      return this.decision('monthly_exhausted', request);
    }
    if (this.tokens < 1) {
      return this.decision('burst_exhausted', request);
    }

    this.tokens -= 1;
    this.monthlyUsed += 1;
    return this.decision('reserved', request);
  }

  private decision(status: QuotaDecision['status'], request: QuotaReservationRequest): QuotaDecision {
    return {
      status,
      burstRemaining: Math.floor(this.tokens),
      monthlyRemaining: Math.max(0, request.policy.monthlyLimit - this.monthlyUsed),
      month: request.month,
    };
  }
}

function quotaRequest(nowMs = Date.parse('2026-07-16T12:00:00.000Z')): QuotaReservationRequest {
  return {
    namespace: 'weatherapi',
    burstKey: 'weatherapi:quota:burst',
    monthlyKey: 'weatherapi:quota:month:2026-07',
    month: '2026-07',
    nowMs,
    monthlyTtlSeconds: 1_339_200,
    policy: quota.WEATHER_QUOTA_POLICY,
  };
}

function upstashResponse(result: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result }),
  } as Response;
}

const originalKey = process.env.WEATHERAPI_KEY;
let restoreNetwork: () => void;

beforeEach(() => {
  process.env.WEATHERAPI_KEY = 'weather-quota-test-key';
  restoreNetwork = blockUnexpectedNetwork();
});

afterEach(() => {
  quota.setQuotaReservationAdapterForTesting(null);
  if (originalKey === undefined) delete process.env.WEATHERAPI_KEY;
  else process.env.WEATHERAPI_KEY = originalKey;
  restoreNetwork();
});

test('successful reservation uses the accepted technical policy and static keys', async () => {
  const adapter = new AtomicQuotaDouble();
  quota.setQuotaReservationAdapterForTesting(adapter);
  const now = Date.parse('2026-07-16T12:00:00.000Z');

  await quota.reserveWeatherProviderQuota(now);

  assert.equal(adapter.requests.length, 1);
  assert.deepEqual(adapter.requests[0].policy, {
    burstCapacity: 300,
    refillTokensPerSecond: 5,
    burstWindowMs: 60_000,
    monthlyLimit: 2_000_000,
  });
  assert.equal(adapter.requests[0].month, '2026-07');
  assert.equal(adapter.requests[0].burstKey, 'weatherapi:quota:burst');
  assert.equal(adapter.requests[0].monthlyKey, 'weatherapi:quota:month:2026-07');
  assert.ok(adapter.requests[0].monthlyTtlSeconds > 0);
});

test('Upstash adapter reserves burst and monthly budgets in one atomic EVAL request', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = quota.createUpstashQuotaReservationAdapter({
    restUrl: 'https://quota.example.invalid',
    restToken: 'test-rest-token',
    async fetchImplementation(input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return upstashResponse(['reserved', 299, 1_999_999, '2026-07']);
    },
  });

  const decision = await adapter.reserve(quotaRequest());

  assert.deepEqual(decision, {
    status: 'reserved',
    burstRemaining: 299,
    monthlyRemaining: 1_999_999,
    month: '2026-07',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://quota.example.invalid');
  assert.equal(calls[0].init?.method, 'POST');
  const command = JSON.parse(String(calls[0].init?.body)) as unknown[];
  assert.equal(command[0], 'EVAL');
  assert.equal(command[2], '2');
  assert.equal(command[3], 'weatherapi:quota:burst');
  assert.equal(command[4], 'weatherapi:quota:month:2026-07');
  assert.equal(command[6], 300);
  assert.equal(command[7], 5);
  assert.equal(command[8], 60_000);
  assert.equal(command[9], 2_000_000);
  assert.match(String(command[1]), /HMGET/);
  assert.match(String(command[1]), /monthly_exhausted/);
  assert.match(String(command[1]), /redis\.call\("SET"/);
  assert.doesNotMatch(String(calls[0].init?.body), /test-rest-token/);
});

test('Upstash adapter maps exhausted budgets and fails closed through the product guard', async () => {
  const adapter = quota.createUpstashQuotaReservationAdapter({
    restUrl: 'https://quota.example.invalid',
    restToken: 'test-rest-token',
    async fetchImplementation() {
      return upstashResponse(['monthly_exhausted', 200, 0, '2026-07']);
    },
  });
  quota.setQuotaReservationAdapterForTesting(adapter);

  await assert.rejects(
    quota.reserveWeatherProviderQuota(quotaRequest().nowMs),
    quota.WeatherQuotaProtectionError,
  );
});

test('Upstash timeout aborts the counter call and the product guard fails closed', async () => {
  const adapter = quota.createUpstashQuotaReservationAdapter({
    restUrl: 'https://quota.example.invalid',
    restToken: 'test-rest-token',
    timeoutMs: 1,
    fetchImplementation: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('simulated timeout', 'AbortError'));
      }, { once: true });
    }),
  });
  quota.setQuotaReservationAdapterForTesting(adapter);

  await assert.rejects(quota.reserveWeatherProviderQuota(quotaRequest().nowMs), (error: Error) => {
    assert.equal(error.message, 'Weather service is temporarily unavailable');
    assert.doesNotMatch(error.message, /timeout|redis|upstash|token/i);
    return true;
  });
});

test('invalid Upstash responses fail closed without exposing response details', async () => {
  const adapter = quota.createUpstashQuotaReservationAdapter({
    restUrl: 'https://quota.example.invalid',
    restToken: 'test-rest-token',
    async fetchImplementation() {
      return upstashResponse(['reserved', 'not-a-number', 1_999_999, '2026-07']);
    },
  });
  quota.setQuotaReservationAdapterForTesting(adapter);

  await assert.rejects(quota.reserveWeatherProviderQuota(quotaRequest().nowMs), (error: Error) => {
    assert.equal(error.message, 'Weather service is temporarily unavailable');
    assert.doesNotMatch(error.message, /not-a-number|redis|upstash|token/i);
    return true;
  });
});

test('missing Upstash environment fails closed before any Redis request', async () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  let fetches = 0;
  const adapter = quota.createUpstashQuotaReservationAdapter({
    async fetchImplementation() {
      fetches++;
      return upstashResponse(['reserved', 299, 1_999_999, '2026-07']);
    },
  });
  quota.setQuotaReservationAdapterForTesting(adapter);

  try {
    await assert.rejects(quota.reserveWeatherProviderQuota(quotaRequest().nowMs), quota.WeatherQuotaProtectionError);
    assert.equal(fetches, 0);
  } finally {
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  }
});

test('production adapter reads only the approved server-side Upstash environment names', async () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://quota.example.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'production-test-rest-token';
  let fetches = 0;
  globalThis.fetch = async (_input, init) => {
    fetches++;
    assert.doesNotMatch(String(init?.body), /production-test-rest-token/);
    return upstashResponse(['reserved', 299, 1_999_999, '2026-07']);
  };
  quota.setQuotaReservationAdapterForTesting(undefined);

  try {
    await quota.reserveWeatherProviderQuota(quotaRequest().nowMs);
    assert.equal(fetches, 1);
  } finally {
    quota.setQuotaReservationAdapterForTesting(null);
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  }
});

test('parallel reservations cannot exceed the 300 token burst capacity', async () => {
  const adapter = new AtomicQuotaDouble();
  quota.setQuotaReservationAdapterForTesting(adapter);
  const now = Date.parse('2026-07-16T12:00:00.000Z');

  const results = await Promise.allSettled(
    Array.from({ length: 301 }, () => quota.reserveWeatherProviderQuota(now)),
  );

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 300);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
});

test('burst budget refills at five tokens per second without exceeding capacity', async () => {
  const adapter = new AtomicQuotaDouble({ tokens: 1 });
  quota.setQuotaReservationAdapterForTesting(adapter);
  const now = Date.parse('2026-07-16T12:00:00.000Z');

  await quota.reserveWeatherProviderQuota(now);
  await assert.rejects(quota.reserveWeatherProviderQuota(now), quota.WeatherQuotaProtectionError);
  await quota.reserveWeatherProviderQuota(now + 200);
  await assert.rejects(quota.reserveWeatherProviderQuota(now + 200), quota.WeatherQuotaProtectionError);
});

test('monthly budget rejects the next reservation at the exact limit', async () => {
  const adapter = new AtomicQuotaDouble({ monthlyUsed: 1_999_999 });
  quota.setQuotaReservationAdapterForTesting(adapter);
  const now = Date.parse('2026-07-16T12:00:00.000Z');

  await quota.reserveWeatherProviderQuota(now);
  await assert.rejects(quota.reserveWeatherProviderQuota(now), quota.WeatherQuotaProtectionError);
});

test('UTC month bucket changes atomically at the month boundary', async () => {
  const adapter = new AtomicQuotaDouble({ monthlyUsed: 1_999_999 });
  quota.setQuotaReservationAdapterForTesting(adapter);
  const julyEnd = Date.parse('2026-07-31T23:59:59.999Z');

  assert.equal(quota.utcMonthBucket(julyEnd), '2026-07');
  assert.equal(quota.utcMonthBucket(julyEnd + 1), '2026-08');
  await quota.reserveWeatherProviderQuota(julyEnd);
  await assert.rejects(quota.reserveWeatherProviderQuota(julyEnd), quota.WeatherQuotaProtectionError);
  await quota.reserveWeatherProviderQuota(julyEnd + 1);
});

test('invalid counter responses fail closed', async () => {
  quota.setQuotaReservationAdapterForTesting({
    async reserve(request) {
      return {
        status: 'reserved',
        burstRemaining: 299,
        monthlyRemaining: 1_999_999,
        month: `${request.month}-invalid`,
      };
    },
  });

  await assert.rejects(quota.reserveWeatherProviderQuota(), (error: Error) => {
    assert.equal(error.message, 'Weather service is temporarily unavailable');
    return true;
  });
});

test('a reserved response without decremented budgets fails closed', async () => {
  quota.setQuotaReservationAdapterForTesting({
    async reserve(request) {
      return {
        status: 'reserved',
        burstRemaining: request.policy.burstCapacity,
        monthlyRemaining: request.policy.monthlyLimit,
        month: request.month,
      };
    },
  });

  await assert.rejects(quota.reserveWeatherProviderQuota(), quota.WeatherQuotaProtectionError);
});

test('reservation keys and payload never contain request or secret data', async () => {
  const adapter = new AtomicQuotaDouble();
  quota.setQuotaReservationAdapterForTesting(adapter);

  await quota.reserveWeatherProviderQuota(Date.parse('2026-07-16T12:00:00.000Z'));

  const serialized = JSON.stringify(adapter.requests[0]);
  assert.doesNotMatch(serialized, /weather-quota-test-key|latitude|longitude|coordinate|query|search|ip|user/i);
  assert.deepEqual(Object.keys(adapter.requests[0]).sort(), [
    'burstKey',
    'month',
    'monthlyKey',
    'monthlyTtlSeconds',
    'namespace',
    'nowMs',
    'policy',
  ]);
});

test('WeatherService cache hit performs no additional reservation or provider fetch', async () => {
  const adapter = new AtomicQuotaDouble();
  quota.setQuotaReservationAdapterForTesting(adapter);
  let fetches = 0;
  globalThis.fetch = async (input) => {
    fetches++;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('history.json')) {
      return { ok: true, status: 200, json: async () => ({ forecast: { forecastday: [] } }) } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        location: { localtime: '2026-07-16 12:00', tz_id: 'Europe/Berlin', region: 'Berlin', country: 'Germany' },
        current: { temp_c: 20, humidity: 50, wind_kph: 10, condition: { code: 1003 }, is_day: 1 },
        forecast: {
          forecastday: [{
            date: '2026-07-16',
            day: {
              condition: { code: 1003 },
              maxtemp_c: 24,
              mintemp_c: 14,
              daily_chance_of_rain: 10,
            },
            astro: {},
            hour: [],
          }],
        },
        alerts: { alert: [] },
      }),
    } as Response;
  };

  const first = await quota.WeatherService.getForecast(52.50123, 13.40123);
  const second = await quota.WeatherService.getForecast(52.50123, 13.40123);

  assert.strictEqual(second, first);
  assert.equal(fetches, 2);
  assert.equal(adapter.requests.length, 2);
});
