import assert from 'node:assert/strict';
import test from 'node:test';
import { WARM_MUCH, WARM_SOME, tempCompareKey } from '../src/lib/tempCompare.ts';

test('ungueltige Eingaben liefern null (kein Vergleich, keine Zeile)', () => {
  assert.equal(tempCompareKey(null, 10), null);
  assert.equal(tempCompareKey(10, null), null);
  assert.equal(tempCompareKey(undefined, 10), null);
  assert.equal(tempCompareKey(10, undefined), null);
  assert.equal(tempCompareKey(NaN, 10), null);
  assert.equal(tempCompareKey(10, NaN), null);
  assert.equal(tempCompareKey(Infinity, 10), null);
  assert.equal(tempCompareKey(10, -Infinity), null);
  assert.equal(tempCompareKey('20', 10), null); // falscher Typ, kein Koerzieren
});

test('Differenz 0 oder unterhalb WARM_SOME bleibt stumm (null)', () => {
  assert.equal(tempCompareKey(20, 20), null);
  assert.equal(tempCompareKey(20 + (WARM_SOME - 0.01), 20), null); // knapp unter der Schwelle
  assert.equal(tempCompareKey(20 - (WARM_SOME - 0.01), 20), null); // knapp unter der Schwelle, kuehler
});

test('waermer: WARM_SOME-Schwelle (>= WARM_SOME, < WARM_MUCH)', () => {
  assert.equal(tempCompareKey(20 + WARM_SOME, 20), 'cmp_bit_warmer');
  assert.equal(tempCompareKey(20 + (WARM_MUCH - 0.01), 20), 'cmp_bit_warmer'); // knapp unter WARM_MUCH
});

test('waermer: WARM_MUCH-Schwelle (>= WARM_MUCH)', () => {
  assert.equal(tempCompareKey(20 + WARM_MUCH, 20), 'cmp_much_warmer');
  assert.equal(tempCompareKey(20 + WARM_MUCH + 5, 20), 'cmp_much_warmer'); // deutlich darueber
});

test('kuehler: WARM_SOME-Schwelle (<= -WARM_SOME, > -WARM_MUCH), symmetrisch', () => {
  assert.equal(tempCompareKey(20 - WARM_SOME, 20), 'cmp_bit_cooler');
  assert.equal(tempCompareKey(20 - (WARM_MUCH - 0.01), 20), 'cmp_bit_cooler'); // knapp ueber -WARM_MUCH
});

test('kuehler: WARM_MUCH-Schwelle (<= -WARM_MUCH), symmetrisch', () => {
  assert.equal(tempCompareKey(20 - WARM_MUCH, 20), 'cmp_much_cooler');
  assert.equal(tempCompareKey(20 - WARM_MUCH - 5, 20), 'cmp_much_cooler'); // deutlich darunter
});
