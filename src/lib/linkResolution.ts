// Auflösung eines geteilten Ortslinks (?stadt=…).
//
// Der geteilte Link ist ein Versprechen: der Empfänger soll das Wetter DES
// GETEILTEN Orts sehen. Wird der Ort nicht gefunden, darf die App deshalb
// niemals still den zuletzt gespeicherten Ort des Empfängers anzeigen — das
// wäre fremdes Wetter, ausgegeben als das geteilte, ohne jeden Hinweis.
//
// Reine Funktion ohne DOM und ohne Netz, damit die Entscheidung prüfbar ist.
import type { Place } from "./geocoding";

export type LinkResolution =
  | { kind: "none" }
  | { kind: "exact"; place: Place }
  | { kind: "ambiguous"; place: Place; count: number };

// Gleiche Normalisierung wie beim Bauen des Links (syncCityParam in app.ts
// nutzt place.name.toLowerCase()). Bewusst toLowerCase und nicht
// toLocaleLowerCase: der Link wurde mit toLowerCase erzeugt, beide Seiten
// müssen dieselbe Regel verwenden. Weicht etwas ab, fällt die Entscheidung auf
// "ambiguous" und damit auf die sichere Seite.
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function decideLinkResolution(results: Place[], query: string): LinkResolution {
  if (results.length === 0) return { kind: "none" };
  if (results.length === 1) return { kind: "exact", place: results[0] };

  // Mehrere Treffer sind nur dann eindeutig, wenn GENAU EINER namentlich auf
  // die Anfrage passt (z. B. "Berlin" gegen "Berlin" und "Berlin Heights").
  // Passen mehrere oder keiner, ist die Wahl des ersten Treffers eine Annahme
  // und muss dem Empfänger sichtbar bestätigt werden.
  const wanted = normalize(query);
  const named = results.filter((place) => normalize(place.name) === wanted);
  if (named.length === 1) return { kind: "exact", place: named[0] };

  return { kind: "ambiguous", place: results[0], count: results.length };
}
