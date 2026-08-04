import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideSharePath, type ShareCapabilities, type SharePath } from '../src/lib/share.ts';

// decideSharePath entscheidet den Teilen-Weg allein aus den Fähigkeiten, ohne
// Browser-API. Genau deshalb ist sie hier ohne DOM und ohne jsdom prüfbar — und
// genau deshalb weiß app.ts schon VOR der teuren Bilderzeugung, ob ein Bild
// überhaupt einen Abnehmer hat.

function caps(hasShare: boolean, canShareFiles: boolean, hasClipboard: boolean): ShareCapabilities {
  return { hasShare, canShareFiles, hasClipboard };
}

// Alle acht Kombinationen, vollstaendig ausgeschrieben statt generiert: die
// Tabelle IST die Spezifikation und faellt bei einer Aenderung sofort auf.
const MATRIX: Array<{ share: boolean; files: boolean; clip: boolean; erwartet: SharePath }> = [
  { share: true,  files: true,  clip: true,  erwartet: 'image' },
  { share: true,  files: true,  clip: false, erwartet: 'image' },
  { share: true,  files: false, clip: true,  erwartet: 'native-text' },
  { share: true,  files: false, clip: false, erwartet: 'native-text' },
  { share: false, files: true,  clip: true,  erwartet: 'clipboard' },
  { share: false, files: true,  clip: false, erwartet: 'unsupported' },
  { share: false, files: false, clip: true,  erwartet: 'clipboard' },
  { share: false, files: false, clip: false, erwartet: 'unsupported' },
];

test('alle acht Faehigkeitskombinationen liefern den erwarteten Pfad', () => {
  for (const fall of MATRIX) {
    assert.equal(
      decideSharePath(caps(fall.share, fall.files, fall.clip)),
      fall.erwartet,
      `share=${fall.share} files=${fall.files} clip=${fall.clip}`
    );
  }
});

test('Dateifreigabe hat Vorrang, wenn sie unterstuetzt wird', () => {
  // Auch wenn die Zwischenablage bereitstuende: das Bild ist das bessere Ergebnis.
  assert.equal(decideSharePath(caps(true, true, true)), 'image');
  assert.equal(decideSharePath(caps(true, true, false)), 'image');
});

test('natives Textteilen, wenn Teilen geht aber keine Dateien', () => {
  assert.equal(decideSharePath(caps(true, false, true)), 'native-text');
  assert.equal(decideSharePath(caps(true, false, false)), 'native-text');
});

test('Zwischenablage, wenn es kein natives Teilen gibt', () => {
  assert.equal(decideSharePath(caps(false, false, true)), 'clipboard');
  // canShareFiles ohne hasShare ist kein realer Browserzustand und darf den
  // Zwischenablage-Pfad nicht verdraengen.
  assert.equal(decideSharePath(caps(false, true, true)), 'clipboard');
});

test('unsupported nur, wenn wirklich kein Weg bleibt', () => {
  const alleFaelle = MATRIX.filter((f) => f.erwartet === 'unsupported');
  for (const fall of alleFaelle) {
    assert.equal(fall.share, false, 'unsupported darf nie bei vorhandenem Teilen entstehen');
    assert.equal(fall.clip, false, 'unsupported darf nie bei vorhandener Zwischenablage entstehen');
  }
  assert.equal(alleFaelle.length, 2);
});

test('kein Bildpfad ohne natives Teilen', () => {
  // Ein "image" ohne hasShare waere fatal: app.ts wuerde das grosse PNG zeichnen
  // und haette danach niemanden, der es entgegennimmt.
  for (const fall of MATRIX) {
    if (fall.erwartet === 'image') assert.equal(fall.share, true);
  }
});

test('der Pfad ist immer einer der vier bekannten Werte', () => {
  const erlaubt: SharePath[] = ['image', 'native-text', 'clipboard', 'unsupported'];
  for (const fall of MATRIX) {
    assert.ok(erlaubt.includes(decideSharePath(caps(fall.share, fall.files, fall.clip))));
  }
});
