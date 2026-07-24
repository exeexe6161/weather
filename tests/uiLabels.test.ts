import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBundledModule } from './testHarness.ts';

interface UiModule {
  LANGS: Array<'de' | 'en' | 'tr'>;
  uiLabels: Record<string, Record<'de' | 'en' | 'tr', string>>;
}

const ui = await loadBundledModule<UiModule>(`
  export { LANGS, uiLabels } from './src/i18n/ui.ts';
`);

test('every ui label carries a non-empty string for all three languages', () => {
  const keys = Object.keys(ui.uiLabels);
  assert.ok(keys.length > 0, 'uiLabels must not be empty');
  for (const key of keys) {
    const entry = ui.uiLabels[key];
    for (const lang of ui.LANGS) {
      const value = entry[lang];
      assert.equal(typeof value, 'string', `${key}.${lang} must be a string`);
      assert.ok(value.trim().length > 0, `${key}.${lang} must not be empty`);
    }
  }
});

test('placeholder tokens match across all three languages', () => {
  // Ein {token}, das in einer Sprache fehlt, würde beim .replace() im Code
  // stumm verloren gehen — Platzhalter müssen daher in allen Sprachen
  // identisch vorkommen (Reihenfolge egal, Menge zählt).
  for (const [key, entry] of Object.entries(ui.uiLabels)) {
    const tokensOf = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
    const expected = tokensOf(entry.de);
    for (const lang of ui.LANGS) {
      assert.deepEqual(tokensOf(entry[lang]), expected, `${key}.${lang} placeholder mismatch`);
    }
  }
});
