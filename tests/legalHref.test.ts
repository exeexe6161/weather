import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legalHref, LANGS } from '../src/i18n/ui.ts';

// Die Footer-Links der App müssen auf die sprachlich passende Rechtsseite
// zeigen, schon beim ersten Besuch. Deutsch ist die Basisdatei ohne Suffix,
// EN und TR liegen unter -en bzw. -tr — dieselbe Konvention, nach der
// theme-init.js auf den Rechtsseiten selbst umleitet.

test('Deutsch fuehrt auf die Basisdatei ohne Suffix', () => {
  assert.equal(legalHref('impressum', 'de'), './impressum');
  assert.equal(legalHref('datenschutz', 'de'), './datenschutz');
});

test('Englisch fuehrt auf die -en Fassung', () => {
  assert.equal(legalHref('impressum', 'en'), './impressum-en');
  assert.equal(legalHref('datenschutz', 'en'), './datenschutz-en');
});

test('Tuerkisch fuehrt auf die -tr Fassung', () => {
  assert.equal(legalHref('impressum', 'tr'), './impressum-tr');
  assert.equal(legalHref('datenschutz', 'tr'), './datenschutz-tr');
});

test('jede unterstuetzte Sprache liefert fuer beide Seiten einen relativen Pfad', () => {
  // Kommt eine vierte Sprache dazu, faellt hier auf, wenn legalHref sie nicht
  // abdeckt — statt still auf die deutsche Fassung zu zeigen.
  for (const lang of LANGS) {
    for (const base of ['impressum', 'datenschutz'] as const) {
      const href = legalHref(base, lang);
      assert.ok(href.startsWith(`./${base}`), `${base}/${lang} muss auf ./${base} aufbauen`);
      assert.ok(!href.includes('//'), `${base}/${lang} darf keinen doppelten Trenner enthalten`);
    }
  }
});

test('die Zieldatei ist je Sprache eindeutig', () => {
  // Zwei Sprachen duerfen nie auf dieselbe Datei zeigen, sonst waere eine
  // Sprachfassung unerreichbar.
  const hrefs = LANGS.map((lang) => legalHref('impressum', lang));
  assert.equal(new Set(hrefs).size, LANGS.length);
});
