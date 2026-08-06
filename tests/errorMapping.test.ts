import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SERVICE_BUSY_RETRY_AFTER_SECONDS,
  mapServerError,
  type MappedError,
} from '../src/server/weather/errorMapping.ts';

// errorMapping.ts ist importfrei und laeuft deshalb direkt ueber Nodes Type
// Stripping, ohne Buendelung und ohne neue Testabhaengigkeit.

function quotaError(): Error {
  const error = new Error('Weather service is temporarily unavailable');
  error.name = 'WeatherQuotaProtectionError';
  return error;
}

function namedError(name: string, message = 'x'): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function providerHttpError(status: number): Error & { status: number } {
  const error = new Error(`WeatherAPI request failed: ${status}`) as Error & { status: number };
  error.name = 'ProviderHttpError';
  error.status = status;
  return error;
}

test('Kontingentschutz wird oeffentlich 503 service_busy', () => {
  const mapped = mapServerError(quotaError());

  assert.equal(mapped.status, 503);
  assert.equal(mapped.reason, 'service_busy');
  assert.equal(mapped.retryAfterSeconds, SERVICE_BUSY_RETRY_AFTER_SECONDS);
});

test('Burst, Monatslimit und Upstash Fehler sehen nach aussen identisch aus', () => {
  // Der Guard wirft fuer JEDEN dieser Zustaende dieselbe Klasse. Genau das ist
  // der Schutz: waere ablesbar, welcher Zustand vorliegt, wuesste ein Angreifer,
  // ob seine Lastspitze wirkt oder ob der Schutz gerade blind ist.
  const zustaende = ['burst', 'monthly', 'upstash-timeout', 'upstash-invalid', 'not-configured'];
  const ergebnisse = zustaende.map((zustand) => mapServerError(quotaError()));

  for (const mapped of ergebnisse) {
    assert.deepEqual(mapped, ergebnisse[0], 'alle Kontingentzustaende muessen identisch abgebildet werden');
  }
  assert.equal(ergebnisse.length, zustaende.length);
});

test('Retry-After bei service_busy ist ein fester Wert und haengt nicht vom Fehler ab', () => {
  // Ein aus Burst oder Monatsbudget abgeleiteter Wert waere klein bzw. gross und
  // wuerde die eben zusammengefuehrte Unterscheidung wieder offenlegen.
  const a = mapServerError(quotaError());
  const b = mapServerError(Object.assign(quotaError(), { burstRemaining: 0, monthlyRemaining: 0 }));

  assert.equal(a.retryAfterSeconds, 60);
  assert.equal(b.retryAfterSeconds, 60);
});

test('Kontingentschutz wird auch ohne funktionierendes instanceof erkannt', () => {
  // Ein Fehler kann eine Buendelgrenze ueberqueren und dort auf eine zweite
  // Klassenidentitaet treffen. Erkannt wird deshalb ueber den Namen.
  const fremd = { name: 'WeatherQuotaProtectionError', message: 'egal' };

  assert.equal(mapServerError(fremd).status, 503);
  assert.equal(mapServerError(fremd).reason, 'service_busy');
});

test('Provider HTTP Fehler wird 502 provider_error, unabhaengig vom Status', () => {
  for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
    const mapped = mapServerError(providerHttpError(status));
    assert.equal(mapped.status, 502, `Providerstatus ${status}`);
    assert.equal(mapped.reason, 'provider_error', `Providerstatus ${status}`);
    assert.equal(mapped.retryAfterSeconds, undefined, `Providerstatus ${status}`);
  }
});

test('Provider Timeout wird 504 provider_timeout', () => {
  for (const name of ['TimeoutError', 'AbortError']) {
    const mapped = mapServerError(namedError(name));
    assert.equal(mapped.status, 504, name);
    assert.equal(mapped.reason, 'provider_timeout', name);
    assert.equal(mapped.retryAfterSeconds, undefined, name);
  }
});

test('interner Fehler wird 500 internal_error', () => {
  assert.equal(mapServerError(new Error('irgendein Bug')).status, 500);
  assert.equal(mapServerError(new Error('irgendein Bug')).reason, 'internal_error');
});

test('unbekannte Werte stuerzen nicht ab und gelten als interner Fehler', () => {
  for (const value of [null, undefined, 'text', 42, {}, [], new TypeError('x')]) {
    const mapped = mapServerError(value);
    assert.equal(mapped.status, 500, String(value));
    assert.equal(mapped.reason, 'internal_error', String(value));
  }
});

test('die Meldung ist immer ein fester Text und enthaelt nie Teile des Fehlers', () => {
  const geheim = 'route-dummy-secret-value-and-key-12345';
  const kandidaten: unknown[] = [
    Object.assign(quotaError(), { message: geheim }),
    namedError('TimeoutError', geheim),
    Object.assign(providerHttpError(500), { message: geheim }),
    new Error(geheim),
  ];

  for (const err of kandidaten) {
    const mapped = mapServerError(err);
    assert.doesNotMatch(mapped.message, /route-dummy-secret-value/, 'Meldung darf den Fehlertext nicht uebernehmen');
    assert.doesNotMatch(JSON.stringify(mapped), /route-dummy-secret-value/, 'kein Feld darf den Fehlertext tragen');
  }
});

test('die Abbildung liefert ausschliesslich die vier bekannten Klassen', () => {
  const erlaubt: Array<MappedError['reason']> = [
    'service_busy',
    'provider_error',
    'provider_timeout',
    'internal_error',
  ];
  const eingaben: unknown[] = [
    quotaError(),
    providerHttpError(500),
    namedError('TimeoutError'),
    namedError('AbortError'),
    new Error('x'),
    null,
  ];

  for (const err of eingaben) {
    const mapped = mapServerError(err);
    assert.ok(erlaubt.includes(mapped.reason), `unerwarteter Reason ${mapped.reason}`);
    assert.ok([500, 502, 503, 504].includes(mapped.status), `unerwarteter Status ${mapped.status}`);
  }
});

test('nur service_busy traegt ueberhaupt eine Wartezeit', () => {
  assert.notEqual(mapServerError(quotaError()).retryAfterSeconds, undefined);
  for (const err of [providerHttpError(500), namedError('TimeoutError'), new Error('x')]) {
    assert.equal(mapServerError(err).retryAfterSeconds, undefined);
  }
});
