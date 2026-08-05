// Sichtbarkeitsentscheidung für die datenabhängigen Sektionen Warnungen und
// Pollen.
//
// Vorher versteckte sich jede Sektion einfach, sobald ihr Inhalt leer war. Der
// Nutzer konnte dadurch nicht unterscheiden, ob es nichts zu melden gibt, ob
// die Daten für den Ort fehlen oder ob der Abruf gescheitert ist. Genau diese
// Unterscheidung trifft dieses Modul.
//
// Bewusst ohne DOM, ohne i18n und OHNE JEDEN IMPORT: so bleibt die Entscheidung
// eine reine Funktion und läuft in tests/sectionState.test.ts direkt über Nodes
// Type Stripping, ohne Bündelung und ohne neue Testabhängigkeit.
//
// Leitregel für beide Sektionen: eine positive Aussage darf nur erscheinen,
// wenn der zugrunde liegende Abruf tatsächlich erfolgreich war.

// Frische der angezeigten Wetterdaten. "stale" ist ein DURCHGANGSZUSTAND: es
// wird nur gesetzt, während bereits ein Abruf läuft, und jeder Ausgang schreibt
// "fresh" oder "failed" (fetchWithTimeout begrenzt das auf 12 Sekunden). Nur
// "failed" heißt, dass der letzte Abruf wirklich gescheitert ist.
export type Freshness = "fresh" | "stale" | "failed";

// Ergebnis des Pollenabrufs. Ersetzt das frühere `PollenLevels | null`, in dem
// vier verschiedene Bedeutungen steckten (noch nicht geladen, keine Daten,
// regional nicht verfügbar, Abruf gescheitert).
//   loading     – noch kein Abruf abgeschlossen
//   ok          – Serverantwort erfolgreich, Pollenobjekt vorhanden
//   unavailable – Serverantwort erfolgreich, aber ohne verwertbare Werte
//   failed      – Fehlerstatus, Zeitüberschreitung, Netzfehler oder Exception
export type PollenStatus = "loading" | "ok" | "unavailable" | "failed";

export type AlertsSection = "list" | "none" | "failed" | "hidden";
export type PollenSection = "list" | "none-notable" | "unavailable" | "failed" | "hidden";

// Warnungen.
//
// `alertCount` ist null, wenn der angezeigte Forecast gar kein Warnfeld trägt.
// Das kommt bei Ständen aus dem localStorage Cache vor, die vor der Einführung
// der Warnungen geschrieben wurden (`alerts` ist im Forecast Typ optional).
// Aus einem fehlenden Feld lässt sich weder eine Warnung noch eine Entwarnung
// ableiten, also schweigt die Sektion wie bisher.
//
// Mindestens eine Warnung wird immer gezeigt, auch über einem gescheiterten
// Refresh: eine bekannte Warnung zu verschweigen wäre die gefährlichere
// Richtung, und die Karte trägt den Fehlerhinweis ohnehin sichtbar.
//
// Ohne Warnung entscheidet der Frischezustand:
//   failed – der Abruf ist gescheitert, der Warnstand ist unbestätigt. KEINE
//            Entwarnung, aber auch kein Verschwinden der Sektion: sie bleibt
//            stehen und sagt, dass nicht aktualisiert werden konnte. Ein
//            wortloses Verschwinden nach einem Fehlversuch läse sich als Fehler
//            und wäre derselbe Layoutsprung, nur in die andere Richtung.
//   sonst  – Entwarnung. Bei "stale" läuft bereits ein Abruf, der sie Sekunden
//            später bestätigt, und der angezeigte Stand ist über
//            getUsableForecast altersbegrenzt. Sie dort zu unterdrücken hieße,
//            Überschrift und Karte bei jedem Favoritenwechsel mit Cache erst
//            nachträglich einzublenden.
export function alertsSectionState(alertCount: number | null, freshness: Freshness): AlertsSection {
  if (alertCount === null) return "hidden";
  if (alertCount > 0) return "list";
  return freshness === "failed" ? "failed" : "none";
}

// Pollen.
//
// `measuredCount` zählt die Arten, für die überhaupt eine Zahl vorliegt,
// `notableCount` davon die über der Anzeigeschwelle. Beide werden vom Aufrufer
// berechnet, damit dieses Modul importfrei bleibt.
//
// Wichtig: eine erfolgreiche Antwort ganz ohne Messwert (measuredCount 0) ist
// KEINE Entwarnung. Sie bedeutet, dass für diesen Ort keine verwertbaren Werte
// vorliegen, und wird deshalb wie "unavailable" behandelt. Nur eine Antwort mit
// echten Zahlen, die alle unter der Schwelle liegen, rechtfertigt die positive
// Aussage "keine nennenswerte Belastung".
export function pollenSectionState(
  status: PollenStatus,
  measuredCount: number,
  notableCount: number
): PollenSection {
  switch (status) {
    case "loading":
      return "hidden";
    case "failed":
      return "failed";
    case "unavailable":
      return "unavailable";
    case "ok":
      if (notableCount > 0) return "list";
      return measuredCount > 0 ? "none-notable" : "unavailable";
  }
}
