import assert from "node:assert/strict";
import { test } from "node:test";
import { decideLinkResolution } from "../src/lib/linkResolution.ts";
import type { Place } from "../src/lib/geocoding.ts";

function place(id: number, name: string, country = "Deutschland"): Place {
  return {
    id,
    name,
    latitude: 52.52,
    longitude: 13.405,
    country,
    countryCode: "DE",
  };
}

test("leere Linkaufloesung ergibt none", () => {
  // Der entscheidende Fall: kein Treffer darf NIEMALS still zum zuletzt
  // gespeicherten Ort des Empfängers führen.
  assert.deepEqual(decideLinkResolution([], "trabzon"), { kind: "none" });
});

test("ein Treffer ergibt exact", () => {
  const berlin = place(1, "Berlin");
  assert.deepEqual(decideLinkResolution([berlin], "berlin"), { kind: "exact", place: berlin });
});

test("mehrere gleichwertige Treffer ergeben ambiguous", () => {
  const results = [place(1, "Springfield", "USA"), place(2, "Springfield", "USA")];
  const decision = decideLinkResolution(results, "springfield");
  assert.equal(decision.kind, "ambiguous");
  if (decision.kind !== "ambiguous") return;
  assert.equal(decision.count, 2);
  assert.equal(decision.place, results[0]);
});

test("genau ein namentlicher Treffer unter mehreren ist eindeutig", () => {
  // "Berlin" gegen "Berlin" und "Berlin Heights": nur einer heißt wirklich so.
  const berlin = place(1, "Berlin");
  const results = [berlin, place(2, "Berlin Heights", "USA")];
  assert.deepEqual(decideLinkResolution(results, "Berlin"), { kind: "exact", place: berlin });
});

test("kein namentlicher Treffer unter mehreren bleibt ambiguous", () => {
  const results = [place(1, "Berlin Heights", "USA"), place(2, "Berliner Vorstadt")];
  const decision = decideLinkResolution(results, "berlin");
  assert.equal(decision.kind, "ambiguous");
  if (decision.kind !== "ambiguous") return;
  assert.equal(decision.place, results[0]);
});

test("Grossschreibung und Leerzeichen veraendern die Entscheidung nicht", () => {
  const berlin = place(1, "Berlin");
  const results = [berlin, place(2, "Berlin Heights", "USA")];
  const expected = { kind: "exact", place: berlin };
  for (const query of ["berlin", "Berlin", "BERLIN", "  Berlin  ", "\tbErLiN\n"]) {
    assert.deepEqual(decideLinkResolution(results, query), expected, `Anfrage ${JSON.stringify(query)}`);
  }
});

test("bei Mehrdeutigkeit bleibt der erste Treffer die Wahl", () => {
  // Die Wahl selbst ändert sich nicht, sie wird nur sichtbar bestätigt.
  const results = [place(7, "Springfield", "USA"), place(8, "Springfield", "USA"), place(9, "Springfield", "USA")];
  const decision = decideLinkResolution(results, "springfield");
  assert.equal(decision.kind, "ambiguous");
  if (decision.kind !== "ambiguous") return;
  assert.equal(decision.place.id, 7);
  assert.equal(decision.count, 3);
});
