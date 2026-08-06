import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RequestError,
  classifyLoadError,
  failNoteKey,
  failTitleKey,
} from "../src/lib/loadError.ts";

// Nachbau der Abbruchfehler, die fetchWithTimeout erzeugt: AbortSignal.timeout
// wirft TimeoutError, der AbortController-Rückfall wirft AbortError.
function abortError(name: "AbortError" | "TimeoutError"): Error {
  const err = new Error("aborted");
  err.name = name;
  return err;
}

test("offline hat Vorrang vor jedem Statuscode", () => {
  // Ohne Verbindung ist jede feinere Unterscheidung bedeutungslos. Auch ein
  // 500er darf dann nicht als Serverproblem erscheinen.
  assert.equal(classifyLoadError(new RequestError("x", 500), false), "offline");
  assert.equal(classifyLoadError(new RequestError("x", 429), false), "offline");
  assert.equal(classifyLoadError(abortError("TimeoutError"), false), "offline");
  assert.equal(classifyLoadError(new TypeError("Failed to fetch"), false), "offline");
});

test("Zeitüberschreitung wird erkannt", () => {
  assert.equal(classifyLoadError(abortError("TimeoutError"), true), "timeout");
  assert.equal(classifyLoadError(abortError("AbortError"), true), "timeout");
});

test("429 wird als Ratenbegrenzung erkannt", () => {
  assert.equal(classifyLoadError(new RequestError("Weather request failed: 429", 429), true), "rateLimit");
});

test("500 und 502 bleiben ein Serverproblem", () => {
  for (const status of [500, 502]) {
    assert.equal(
      classifyLoadError(new RequestError(`Weather request failed: ${status}`, status), true),
      "server",
      `Status ${status}`
    );
  }
});

test("503 wird als ausgelasteter Dienst erkannt, nicht als Serverausfall", () => {
  // Der Server hat den Abruf selbst gestoppt. Das ist eine andere Aussage als
  // "der Wetterdienst ist nicht erreichbar", und der Nutzer bekommt sie jetzt.
  assert.equal(classifyLoadError(new RequestError("Weather request failed: 503", 503), true), "busy");
});

test("504 wird als Zeitueberschreitung erkannt", () => {
  // Der Wetteranbieter war zu langsam. Fuer den Nutzer ist das dasselbe wie
  // eine eigene Zeitueberschreitung, daher dieselbe Klasse und derselbe Text.
  assert.equal(classifyLoadError(new RequestError("Weather request failed: 504", 504), true), "timeout");
});

test("unbekannter Fehler bleibt neutral", () => {
  // fetch wirft bei Netzfehlern einen TypeError. Bei bestehender Verbindung
  // ist das gerade KEIN Offline-Beleg, also darf nichts behauptet werden.
  assert.equal(classifyLoadError(new TypeError("Failed to fetch"), true), "unknown");
  assert.equal(classifyLoadError(new Error("irgendwas"), true), "unknown");
  assert.equal(classifyLoadError(null, true), "unknown");
  assert.equal(classifyLoadError("kaputt", true), "unknown");
});

test("4xx ausser 429 gilt nicht als Serverproblem", () => {
  // Ein 400 oder 404 ist ein Aufruffehler, kein Ausfall des Dienstes.
  assert.equal(classifyLoadError(new RequestError("x", 400), true), "unknown");
  assert.equal(classifyLoadError(new RequestError("x", 404), true), "unknown");
});

test("RequestError wird auch ohne instanceof an seiner Form erkannt", () => {
  // Zweite Sicherung, falls der Fehler eine Bündelgrenze überquert hat.
  const crossBundle = { name: "RequestError", status: 502, message: "x" };
  assert.equal(classifyLoadError(crossBundle, true), "server");
});

test("RequestError traegt Status und unveraenderten Wortlaut", () => {
  const err = new RequestError("Weather request failed: 503", 503);
  assert.equal(err.status, 503);
  assert.equal(err.message, "Weather request failed: 503");
  assert.equal(err.name, "RequestError");
  assert.ok(err instanceof Error);
});

test("offline behaelt Vorrang vor jedem Statuscode, auch vor 503", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(
      classifyLoadError(new RequestError("x", status), false),
      "offline",
      `Status ${status}`
    );
  }
});

test("nur offline verweist auf eine fehlende Verbindung", () => {
  // Der Kern des Befundes: kein anderer Zustand darf den Offline-Text ziehen.
  assert.equal(failNoteKey("offline"), "offlineNote");
  for (const kind of ["timeout", "rateLimit", "busy", "server", "unknown"] as const) {
    assert.notEqual(failNoteKey(kind), "offlineNote", kind);
  }
  assert.equal(failTitleKey("offline"), "errorOffline");
  for (const kind of ["timeout", "rateLimit", "busy", "server", "unknown"] as const) {
    assert.notEqual(failTitleKey(kind), "errorOffline", kind);
  }
});

test("jede Fehlerklasse hat einen eigenen Hinweis und Titel", () => {
  const kinds = ["offline", "timeout", "rateLimit", "busy", "server", "unknown"] as const;
  const notes = new Set(kinds.map(failNoteKey));
  assert.equal(notes.size, kinds.length, "Hinweistexte müssen unterscheidbar sein");
  for (const kind of kinds) {
    assert.equal(typeof failTitleKey(kind), "string");
    assert.ok(failTitleKey(kind).length > 0, kind);
  }
});

test("der ausgelastete Dienst hat eigene Texte, getrennt vom Serverausfall", () => {
  // Genau das war der Befund: beide teilten sich errorServer, und die Aussage
  // "der Wetterdienst ist nicht erreichbar" stimmte im Kontingentfall nicht.
  assert.equal(failNoteKey("busy"), "failBusy");
  assert.equal(failTitleKey("busy"), "errorBusy");
  assert.notEqual(failNoteKey("busy"), failNoteKey("server"));
  assert.notEqual(failTitleKey("busy"), failTitleKey("server"));
});
