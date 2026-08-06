import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBundledModule } from './testHarness.ts';

interface SearchStatusModule {
  SEARCH_MIN_LENGTH: number;
  shouldSearch(length: number): boolean;
  searchStatusKey(outcome: unknown): string | null;
}

interface UiModule {
  LANGS: Array<'de' | 'en' | 'tr'>;
  uiLabels: Record<string, Record<'de' | 'en' | 'tr', string>>;
}

const search = await loadBundledModule<SearchStatusModule>(`
  export { SEARCH_MIN_LENGTH, shouldSearch, searchStatusKey } from './src/lib/searchStatus.ts';
`);
const ui = await loadBundledModule<UiModule>(`
  export { LANGS, uiLabels } from './src/i18n/ui.ts';
`);

test('unter der Mindestlaenge wird nicht gesucht', () => {
  // Der Guard, der den Netzaufruf verhindert. Faellt er, entstehen Abrufe fuer
  // ein und zwei Zeichen, also genau die Last, die der Debounce vermeiden soll.
  for (let length = 0; length < search.SEARCH_MIN_LENGTH; length++) {
    assert.equal(search.shouldSearch(length), false, `Laenge ${length} darf nicht suchen`);
  }
  assert.equal(search.shouldSearch(search.SEARCH_MIN_LENGTH), true);
  assert.equal(search.shouldSearch(search.SEARCH_MIN_LENGTH + 7), true);
  assert.equal(search.shouldSearch(Number.NaN), false);
});

test('leeres Feld bleibt still, ab einem Zeichen kommt der Mindestlaengen-Hinweis', () => {
  assert.equal(search.searchStatusKey({ kind: 'typing', length: 0 }), null);
  assert.equal(search.searchStatusKey({ kind: 'typing', length: 1 }), 'searchTooShort');
  assert.equal(search.searchStatusKey({ kind: 'typing', length: 2 }), 'searchTooShort');
});

test('ab der Mindestlaenge zeigt das Tippen den Ladehinweis', () => {
  assert.equal(search.searchStatusKey({ kind: 'typing', length: search.SEARCH_MIN_LENGTH }), 'searchLoading');
  assert.equal(search.searchStatusKey({ kind: 'loading' }), 'searchLoading');
});

test('kein Treffer zeigt den hilfreichen Text, Treffer zeigen die Zahl', () => {
  assert.equal(search.searchStatusKey({ kind: 'results', count: 0 }), 'searchNoResults');
  assert.equal(search.searchStatusKey({ kind: 'results', count: 1 }), 'searchResultsOne');
  assert.equal(search.searchStatusKey({ kind: 'results', count: 2 }), 'searchResultsMany');
  assert.equal(search.searchStatusKey({ kind: 'results', count: 9 }), 'searchResultsMany');
});

test('der Suchfehler bleibt ein eigener, ehrlicher Zustand', () => {
  // Er darf nicht mit "keine Treffer" zusammenfallen: ein gescheiterter Abruf
  // sagt nichts darueber, ob es den Ort gibt.
  assert.equal(search.searchStatusKey({ kind: 'error' }), 'searchError');
  assert.notEqual(search.searchStatusKey({ kind: 'error' }), search.searchStatusKey({ kind: 'results', count: 0 }));
});

test('jeder gelieferte Schluessel existiert in allen drei Sprachen', () => {
  const outcomes = [
    { kind: 'typing', length: 1 },
    { kind: 'typing', length: search.SEARCH_MIN_LENGTH },
    { kind: 'loading' },
    { kind: 'results', count: 0 },
    { kind: 'results', count: 1 },
    { kind: 'results', count: 4 },
    { kind: 'error' },
  ];
  for (const outcome of outcomes) {
    const key = search.searchStatusKey(outcome);
    assert.ok(key !== null, `${JSON.stringify(outcome)} muss einen Schluessel liefern`);
    for (const lang of ui.LANGS) {
      const value = ui.uiLabels[key!]?.[lang];
      assert.equal(typeof value, 'string', `${key}.${lang} fehlt`);
      assert.ok(value.trim().length > 0, `${key}.${lang} ist leer`);
    }
  }
});

test('die Mindestlaenge im Text stimmt mit der Konstante ueberein', () => {
  // Der Hinweistext nennt die Zahl ausgeschrieben. Weicht sie vom Code ab,
  // behauptet die Oberflaeche etwas Falsches, ohne dass es jemand bemerkt.
  for (const lang of ui.LANGS) {
    assert.match(
      ui.uiLabels.searchTooShort[lang],
      new RegExp(String(search.SEARCH_MIN_LENGTH)),
      `searchTooShort.${lang} muss die Zahl ${search.SEARCH_MIN_LENGTH} nennen`,
    );
  }
});
