import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { alertsSectionState, pollenSectionState } from '../src/lib/sectionState.ts';
import { loadBundledModule } from './testHarness.ts';

// sectionState.ts ist importfrei und laeuft deshalb direkt ueber Nodes Type
// Stripping. pollen.ts und i18n/ui.ts ziehen weitere Module nach und werden
// gebuendelt geladen, wie in uiLabels.test.ts.

interface PollenModule {
  fetchPollen(latitude: number, longitude: number): Promise<{ status: string; levels?: Record<string, number | null> }>;
  countPollen(levels: Record<string, number | null>): { measured: number; notable: number };
  POLLEN_LOADING: { status: string };
}

interface UiModule {
  LANGS: Array<'de' | 'en' | 'tr'>;
  uiLabels: Record<string, Record<'de' | 'en' | 'tr', string>>;
}

const pollen = await loadBundledModule<PollenModule>(`
  export { fetchPollen, countPollen, POLLEN_LOADING } from './src/lib/pollen.ts';
`);

const ui = await loadBundledModule<UiModule>(`
  export { LANGS, uiLabels } from './src/i18n/ui.ts';
`);

// Vollstaendige Pollenwerte bauen: alle sieben Arten, ueberschreibbar.
const KINDS = ['alder', 'birch', 'grass', 'mugwort', 'hazel', 'oak', 'ragweed'] as const;
function levels(overrides: Partial<Record<(typeof KINDS)[number], number | null>> = {}): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const kind of KINDS) out[kind] = null;
  return { ...out, ...overrides };
}

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.after(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: unknown }).window;
});

// ── Warnungen ───────────────────────────────────────────────────────────────

test('Warnungen: vorhandene Warnungen werden in jedem Frischezustand gezeigt', () => {
  assert.equal(alertsSectionState(1, 'fresh'), 'list');
  assert.equal(alertsSectionState(1, 'stale'), 'list');
  // Auch bei gescheitertem Abruf: eine bekannte Warnung zu verschweigen waere
  // die gefaehrlichere Richtung.
  assert.equal(alertsSectionState(1, 'failed'), 'list');
  assert.equal(alertsSectionState(9, 'failed'), 'list');
});

test('Warnungen: erfolgreich leer ergibt die Entwarnung', () => {
  assert.equal(alertsSectionState(0, 'fresh'), 'none');
});

test('Warnungen: stale und leer behaelt die Entwarnung (kein Layoutsprung)', () => {
  // stale ist ein Durchgangszustand mit laufendem Abruf. Wuerde hier "hidden"
  // stehen, erschienen Ueberschrift und Karte bei jedem Favoritenwechsel mit
  // Cache erst nachtraeglich.
  assert.equal(alertsSectionState(0, 'stale'), 'none');
});

test('Warnungen: failed erzeugt NIEMALS eine positive Entwarnung', () => {
  assert.equal(alertsSectionState(0, 'failed'), 'failed');
  assert.notEqual(alertsSectionState(0, 'failed'), 'none');
});

test('Warnungen: failed laesst die Sektion stehen statt sie verschwinden zu lassen', () => {
  // Gegenprobe zum stale-Fall: ein gescheiterter Aktualisierungsversuch darf
  // eine sichtbare Sektion nicht wortlos entfernen. Sie bleibt und sagt, dass
  // nicht aktualisiert werden konnte.
  assert.notEqual(alertsSectionState(0, 'failed'), 'hidden');
});

test('Warnungen: fehlendes Warnfeld (alter Cache) behauptet nichts', () => {
  // alerts ist im Forecast Typ optional. Ein Stand ohne das Feld ist KEINE
  // Entwarnung, sondern schlicht keine Information.
  for (const freshness of ['fresh', 'stale', 'failed'] as const) {
    assert.equal(alertsSectionState(null, freshness), 'hidden', freshness);
    assert.notEqual(alertsSectionState(null, freshness), 'none', freshness);
  }
});

// ── Pollen ──────────────────────────────────────────────────────────────────

test('Pollen: noch nicht geladen sagt gar nichts', () => {
  assert.equal(pollenSectionState('loading', 0, 0), 'hidden');
  // Auch mit zufaellig mitgegebenen Zahlen bleibt der Ladezustand stumm.
  assert.equal(pollenSectionState('loading', 7, 3), 'hidden');
});

test('Pollen: Daten vorhanden ergibt die Liste', () => {
  assert.equal(pollenSectionState('ok', 7, 1), 'list');
  assert.equal(pollenSectionState('ok', 1, 1), 'list');
});

test('Pollen: gemessen und alles unter der Schwelle ist eine echte Entwarnung', () => {
  assert.equal(pollenSectionState('ok', 7, 0), 'none-notable');
  assert.equal(pollenSectionState('ok', 1, 0), 'none-notable');
});

test('Pollen: erfolgreiche Antwort ohne verwertbaren Messwert ist KEINE Entwarnung', () => {
  // Kein einziger Zahlenwert: daraus laesst sich keine Belastungsaussage
  // ableiten, also nur die Verfuegbarkeitsaussage.
  assert.equal(pollenSectionState('ok', 0, 0), 'unavailable');
  assert.notEqual(pollenSectionState('ok', 0, 0), 'none-notable');
});

test('Pollen: regional nicht verfuegbar bleibt eine Verfuegbarkeitsaussage', () => {
  assert.equal(pollenSectionState('unavailable', 0, 0), 'unavailable');
});

test('Pollen: failed erzeugt NIEMALS eine positive Aussage', () => {
  const state = pollenSectionState('failed', 0, 0);
  assert.equal(state, 'failed');
  assert.notEqual(state, 'none-notable');
  assert.notEqual(state, 'unavailable');
  // Auch wenn versehentlich Zaehlwerte durchgereicht wuerden.
  assert.equal(pollenSectionState('failed', 7, 3), 'failed');
});

// ── countPollen ─────────────────────────────────────────────────────────────

test('countPollen zaehlt Messwerte und davon die ueber der Schwelle', () => {
  assert.deepEqual(pollen.countPollen(levels()), { measured: 0, notable: 0 });
  assert.deepEqual(pollen.countPollen(levels({ birch: 0 })), { measured: 1, notable: 0 });
  assert.deepEqual(pollen.countPollen(levels({ birch: 5 })), { measured: 1, notable: 1 });
  assert.deepEqual(
    pollen.countPollen(levels({ birch: 5, grass: 0, oak: 250 })),
    { measured: 3, notable: 2 }
  );
});

test('countPollen ignoriert unbrauchbare Werte statt sie als Messwert zu zaehlen', () => {
  assert.deepEqual(pollen.countPollen(levels({ birch: Number.NaN })), { measured: 0, notable: 0 });
  assert.deepEqual(pollen.countPollen(levels({ birch: Number.POSITIVE_INFINITY })), { measured: 0, notable: 0 });
  assert.deepEqual(
    pollen.countPollen({ birch: '5' } as unknown as Record<string, number | null>),
    { measured: 0, notable: 0 }
  );
});

// ── fetchPollen: null ist nicht mehr mehrdeutig ─────────────────────────────

test('fetchPollen: erfolgreiche Antwort mit Werten ergibt ok', async () => {
  globalThis.fetch = async () => Response.json(levels({ birch: 5 }));
  const result = await pollen.fetchPollen(50, 8);
  assert.equal(result.status, 'ok');
  assert.equal(result.levels?.birch, 5);
});

test('fetchPollen: HTTP 200 mit Body null ergibt unavailable, nicht failed', async () => {
  globalThis.fetch = async () => Response.json(null);
  assert.deepEqual(await pollen.fetchPollen(50, 8), { status: 'unavailable' });
});

test('fetchPollen: Fehlerstatus ergibt failed, nicht unavailable', async () => {
  for (const status of [429, 502, 503]) {
    globalThis.fetch = async () => new Response(null, { status });
    assert.deepEqual(await pollen.fetchPollen(50, 8), { status: 'failed' }, `HTTP ${status}`);
  }
});

test('fetchPollen: Netzfehler und Zeitueberschreitung ergeben failed', async () => {
  globalThis.fetch = async () => { throw new TypeError('network down'); };
  assert.deepEqual(await pollen.fetchPollen(50, 8), { status: 'failed' });

  globalThis.fetch = async () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  };
  assert.deepEqual(await pollen.fetchPollen(50, 8), { status: 'failed' });
});

test('fetchPollen: defekter Body ergibt failed und wirft nicht', async () => {
  globalThis.fetch = async () => new Response('nicht json', { status: 200 });
  assert.deepEqual(await pollen.fetchPollen(50, 8), { status: 'failed' });
});

test('fetchPollen unterscheidet die drei Ausgaenge wirklich voneinander', async () => {
  globalThis.fetch = async () => Response.json(null);
  const unavailable = await pollen.fetchPollen(50, 8);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const failed = await pollen.fetchPollen(50, 8);
  // Genau das war vorher nicht moeglich: beide Wege lieferten null.
  assert.notEqual(unavailable.status, failed.status);
});

test('POLLEN_LOADING ist der Startwert und bleibt stumm', () => {
  assert.deepEqual(pollen.POLLEN_LOADING, { status: 'loading' });
  assert.equal(pollenSectionState(pollen.POLLEN_LOADING.status as 'loading', 0, 0), 'hidden');
});

// ── Ortswechsel: Reset vor dem Cache-Render ─────────────────────────────────

test('selectPlace setzt Pollen VOR dem Cache-Render zurueck', () => {
  // Quelltextpruefung statt DOM-Test (kein jsdom im Projekt). Genau diese
  // Reihenfolge verhindert, dass beim Ortswechsel mit vorhandenem Stand kurz
  // die Pollenwerte des VORHERIGEN Orts unter dem neuen Ortsnamen stehen.
  const source = readFileSync(fileURLToPath(new URL('../src/app.ts', import.meta.url)), 'utf8');
  const selectPlaceAt = source.indexOf('export function selectPlace');
  const resetAt = source.indexOf('state.pollen = POLLEN_LOADING', selectPlaceAt);
  const cacheReadAt = source.indexOf('const usableCache = getUsableForecast(', selectPlaceAt);

  assert.ok(selectPlaceAt !== -1, 'selectPlace muss in app.ts existieren');
  assert.ok(resetAt !== -1, 'selectPlace muss state.pollen auf POLLEN_LOADING zuruecksetzen');
  assert.ok(cacheReadAt !== -1, 'selectPlace muss den Forecast-Cache lesen');
  assert.ok(resetAt < cacheReadAt, 'der Pollen-Reset muss VOR dem Cache-Render stehen');
});

test('app.ts reicht den Frischezustand an die Warnungen durch', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/app.ts', import.meta.url)), 'utf8');
  // Kein [^)]*: der Aufruf enthaelt selbst Klammern (byId(...)). Bis zum
  // Semikolon zu lesen trifft genau einen Aufruf. Gezaehlt statt nur gematcht,
  // damit ein zusaetzlicher Aufruf OHNE freshness nicht durchrutscht.
  const calls = source.match(/renderWeatherAlerts\(/g) ?? [];
  const withFreshness = source.match(/renderWeatherAlerts\([^;]*state\.freshness\)/g) ?? [];
  assert.ok(calls.length > 0, 'app.ts muss renderWeatherAlerts aufrufen');
  assert.equal(withFreshness.length, calls.length, 'jeder renderWeatherAlerts-Aufruf muss state.freshness mitgeben');
});

// ── Uebersetzungen ──────────────────────────────────────────────────────────

test('die neuen Leerzustandstexte existieren vollstaendig in DE, EN und TR', () => {
  const keys = ['alerts_none', 'alerts_failed', 'pollen_none_notable', 'pollen_unavailable', 'pollen_failed'];
  for (const key of keys) {
    const entry = ui.uiLabels[key];
    assert.ok(entry, `${key} fehlt in uiLabels`);
    for (const lang of ui.LANGS) {
      assert.equal(typeof entry[lang], 'string', `${key}.${lang} muss ein String sein`);
      assert.ok(entry[lang].trim().length > 0, `${key}.${lang} darf nicht leer sein`);
    }
    // Drei eigenstaendige Formulierungen, keine kopierte Zeile.
    assert.equal(new Set(ui.LANGS.map((lang) => entry[lang])).size, ui.LANGS.length, `${key} wiederholt eine Sprache`);
  }
});

test('kein Leerzustandstext verspricht Sicherheit oder gibt Gesundheitsrat', () => {
  const forbidden = [
    /garantie/i, /guarantee/i, /garanti/i,
    /sicher kein/i, /definitely no/i,
    /keine gefahr/i, /no danger/i, /tehlike yok/i,
    /unbedenklich/i, /harmless/i, /zarars/i,
  ];
  for (const key of ['alerts_none', 'alerts_failed', 'pollen_none_notable', 'pollen_unavailable', 'pollen_failed']) {
    for (const lang of ui.LANGS) {
      const text = ui.uiLabels[key][lang];
      for (const pattern of forbidden) {
        assert.equal(pattern.test(text), false, `${key}.${lang} enthaelt eine unzulaessige Zusicherung: ${text}`);
      }
    }
  }
});

test('der Verfuegbarkeitstext behauptet keine Abdeckungsluecke des Anbieters', () => {
  // Er darf sagen, dass gerade nichts verfuegbar ist, aber nicht, dass der
  // Anbieter die Region nicht unterstuetzt oder dass es dort keine Pollen gibt.
  const forbidden = [/anbieter/i, /provider/i, /saglayici/i, /sağlayıcı/i, /unterstützt/i, /supports/i, /desteklemiyor/i];
  for (const lang of ui.LANGS) {
    const text = ui.uiLabels.pollen_unavailable[lang];
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `pollen_unavailable.${lang} behauptet zu viel: ${text}`);
    }
  }
});
