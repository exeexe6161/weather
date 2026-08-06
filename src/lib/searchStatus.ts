// Welcher Text steht in der Statusregion der Ortssuche?
//
// Vorher lag diese Entscheidung verstreut in SearchBar.ts, und ein Fall fehlte
// ganz: unter der Mindestlänge wurde der Status geleert. Der Nutzer tippte ein
// oder zwei Zeichen und bekam gar keine Rückmeldung, das Feld sah aus wie eines,
// das nicht funktioniert. Das UI/UX Playbook verlangt für jeden Listenzustand
// eine sichtbare Aussage, und eine Fehlermeldung soll sagen, was passiert ist
// und was der Nutzer tun kann.
//
// Bewusst ohne DOM, ohne i18n und OHNE JEDEN IMPORT (gleiche Bauform wie
// lib/sectionState.ts): so bleibt die Entscheidung eine reine Funktion und läuft
// in tests/searchStatus.test.ts direkt über Nodes Type Stripping, ohne Bündelung
// und ohne neue Testabhängigkeit.

// Ab dieser Länge wird überhaupt gesucht. Kürzere Eingaben lösen KEINEN
// Netzaufruf aus, das war schon vorher so und bleibt so.
//
// Achtung: die Zahl steht zusätzlich ausgeschrieben in den Texten hinter
// "searchTooShort" (i18n/ui.ts, alle drei Sprachen). Wer sie hier ändert, muss
// sie dort mitändern, sonst behauptet die Oberfläche etwas anderes als der Code.
export const SEARCH_MIN_LENGTH = 3;

// Der Zustand, in dem die Suche gerade steckt.
//   typing  – der Nutzer tippt, es läuft (noch) kein Abruf
//   loading – ein Abruf läuft oder wartet auf den Debounce
//   results – eine Antwort ist da, count ist die Trefferzahl (0 erlaubt)
//   error   – der Abruf ist gescheitert
export type SearchOutcome =
  | { kind: "typing"; length: number }
  | { kind: "loading" }
  | { kind: "results"; count: number }
  | { kind: "error" };

// Löst die Mindestlänge aus, ob überhaupt gesucht werden darf. Eine Stelle für
// den Eingabepfad und den Enter-Pfad, damit beide nie auseinanderlaufen können.
export function shouldSearch(length: number): boolean {
  return Number.isFinite(length) && length >= SEARCH_MIN_LENGTH;
}

// Der i18n Schlüssel für die Statusregion, oder null für "Region leer lassen".
//
// null gibt es nur bei komplett leerem Feld: dort hat der Nutzer noch nichts
// getan, und ihn mit einer Anweisung zu begrüßen wäre Lärm. Sobald ein Zeichen
// steht, gilt eine Aussage.
export function searchStatusKey(outcome: SearchOutcome): string | null {
  switch (outcome.kind) {
    case "typing":
      if (outcome.length <= 0) return null;
      return shouldSearch(outcome.length) ? "searchLoading" : "searchTooShort";
    case "loading":
      return "searchLoading";
    case "results":
      if (outcome.count <= 0) return "searchNoResults";
      // Zwei Schlüssel, weil Englisch im Singular "result" ohne s braucht.
      return outcome.count === 1 ? "searchResultsOne" : "searchResultsMany";
    case "error":
      return "searchError";
  }
}
