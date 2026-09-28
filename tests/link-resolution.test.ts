import assert from "node:assert/strict";
import { test } from "node:test";
import { decideLinkResolution, decideProviderLinkResolution, placeLinkUrl, readPlaceLink } from "../src/lib/linkResolution.ts";
import { GEO_PLACE_ID, type Place } from "../src/lib/geocoding.ts";

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

test("zwei gleichnamige Orte erhalten verschiedene Provider Links und bleiben unterscheidbar", () => {
  const first = { ...place(17, "Springfield"), providerId: 17, admin1: "Illinois" };
  const second = { ...place(28, "Springfield"), providerId: 28, admin1: "Massachusetts" };
  const firstUrl = placeLinkUrl("https://weatherpure.com/", first);
  const secondUrl = placeLinkUrl("https://weatherpure.com/", second);
  assert.notEqual(firstUrl.href, secondUrl.href);
  assert.deepEqual(readPlaceLink(firstUrl.search), { kind: "provider", name: "Springfield", providerId: 17 });
  assert.deepEqual(readPlaceLink(secondUrl.search), { kind: "provider", name: "Springfield", providerId: 28 });
  assert.deepEqual(decideProviderLinkResolution([second, first], 17), { kind: "exact", place: first });
  assert.deepEqual(decideProviderLinkResolution([first, second], 28), { kind: "exact", place: second });
});

test("Provider Link prueft die ID statt auf den lesbaren Namen zurueckzufallen", () => {
  const other = { ...place(28, "Springfield"), providerId: 28 };
  assert.deepEqual(decideProviderLinkResolution([other], 17), { kind: "none" });
  assert.deepEqual(decideProviderLinkResolution([{ ...place(17, "Springfield") }], 17), { kind: "none" });
  assert.deepEqual(decideProviderLinkResolution([other, other], 28), { kind: "none" });
});

test("kanonische Unicode Namen bleiben im neuen Link erhalten", () => {
  for (const name of ["İstanbul", "München", "Aix-en-Provence", "L'Aquila", "São Paulo", "東京", " New York "]) {
    const url = placeLinkUrl("https://weatherpure.com/", { ...place(42, name), providerId: 42 });
    assert.equal(url.searchParams.get("stadt"), name);
    assert.deepEqual(readPlaceLink(url.search), { kind: "provider", name, providerId: 42 });
  }
  const istanbul = placeLinkUrl("https://weatherpure.com/", { ...place(42, "İstanbul"), providerId: 42 });
  assert.equal(istanbul.href.includes("%C4%B0stanbul"), true);
  assert.equal(istanbul.href.includes("i%CC%87stanbul"), false);
});

test("Hash Orte und alte gespeicherte Orte bleiben reine Namenslinks", () => {
  const hashPlace = place(123, "Springfield");
  const url = placeLinkUrl("https://weatherpure.com/?placeId=99", hashPlace);
  assert.deepEqual(readPlaceLink(url.search), { kind: "legacy", name: "Springfield" });
  assert.equal(url.searchParams.has("placeId"), false);
  assert.deepEqual(readPlaceLink("?stadt=springfield"), { kind: "legacy", name: "springfield" });
  assert.deepEqual(decideLinkResolution([hashPlace], "springfield"), { kind: "exact", place: hashPlace });
  const mismatched = placeLinkUrl("https://weatherpure.com/", { ...hashPlace, providerId: 999 });
  assert.equal(mismatched.searchParams.has("placeId"), false);
});

test("ungueltige Provider ID wird nicht als alter Namenslink interpretiert", () => {
  for (const search of [
    "?stadt=Springfield&placeId=",
    "?stadt=Springfield&placeId=0",
    "?stadt=Springfield&placeId=-1",
    "?stadt=Springfield&placeId=1.5",
    "?stadt=Springfield&placeId=9007199254740992",
    "?stadt=Springfield&placeId=17&placeId=28",
    "?placeId=17",
  ]) assert.equal(readPlaceLink(search).kind, "invalid", search);
  assert.deepEqual(readPlaceLink(""), { kind: "none" });
});

test("Browser URL und Teilen benutzen dieselbe Linkfunktion ohne Geo Koordinaten", () => {
  const selected = { ...place(17, "Berlin"), providerId: 17 };
  const browser = placeLinkUrl("https://weatherpure.com/?theme=dark#today", selected);
  const shared = placeLinkUrl("https://weatherpure.com/", selected);
  assert.equal(browser.searchParams.get("stadt"), shared.searchParams.get("stadt"));
  assert.equal(browser.searchParams.get("placeId"), shared.searchParams.get("placeId"));
  assert.equal(browser.searchParams.get("theme"), "dark");
  const geo = placeLinkUrl("https://weatherpure.com/?stadt=Berlin&placeId=17", place(GEO_PLACE_ID, "Mein Standort"));
  assert.equal(geo.search, "");
});
