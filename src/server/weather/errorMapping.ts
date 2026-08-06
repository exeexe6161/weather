// Öffentliche Fehlerklasse einer Serverantwort.
//
// Vorher fingen alle vier API Routen jeden Fehler mit einem parameterlosen
// `catch {}` und antworteten pauschal mit 502. Ein aufgebrauchtes Kontingent,
// ein Ausfall der Schutzinfrastruktur, ein Providerfehler, eine
// Zeitüberschreitung und ein eigener Programmierfehler waren damit von außen
// nicht zu unterscheiden, und die App sagte dem Nutzer in mehreren dieser Fälle
// eine Ursache, die nicht zutraf.
//
// Bewusst ohne DOM, ohne i18n und OHNE JEDEN IMPORT (gleiche Bauform wie
// lib/sectionState.ts und lib/searchStatus.ts): so bleibt die Entscheidung eine
// reine Funktion und läuft in tests/errorMapping.test.ts direkt über Nodes
// Type Stripping, ohne Bündelung und ohne neue Testabhängigkeit.
//
// ERKENNUNG ÜBER `name`, NICHT ÜBER instanceof. Die Routen unter api/ laden
// den Servercode über eine eigene Modulkante (`../src/server/....js`). Ein
// Fehler kann diese Grenze überqueren und dabei auf eine zweite Klassenidentität
// treffen, unter der `instanceof` still `false` liefert. Genau dieser Fall wäre
// hier der gefährlichste: der Kontingentschutz würde als interner Fehler
// durchgehen. Dieselbe Begründung trägt bereits `statusOf` in lib/loadError.ts.

export type ServerErrorReason =
  | "service_busy"
  | "provider_error"
  | "provider_timeout"
  | "rate_limited"
  | "internal_error";

export interface MappedError {
  readonly status: number;
  readonly reason: ServerErrorReason;
  // Fester Text aus diesem Modul. Wird NIE aus dem Eingabefehler gebildet,
  // damit keine Providermeldung, keine URL und kein Schlüssel nach außen kann.
  readonly message: string;
  readonly retryAfterSeconds?: number;
}

// Einheitliche Wartezeit für JEDE Antwort mit 503.
//
// Bewusst ein fester, grober Wert und ausdrücklich NICHT aus dem echten
// Zustand abgeleitet. Ein aus dem Burst Fenster berechneter Wert wäre klein,
// ein aus dem Monatsbudget berechneter groß. Genau daran ließe sich ablesen,
// welcher Schutz gerade greift und ob eine Lastspitze wirkt. Die
// Zusammenfassung aller Kontingentzustände zu einer Kategorie wäre damit durch
// die Hintertür wieder aufgehoben.
//
// Retry-After ist ein Hinweis, keine Zusage. Bei aufgebrauchtem Monatsbudget
// kann es nach 60 Sekunden erneut scheitern; das ist hinnehmbar, ein
// Informationsleck wäre es nicht.
export const SERVICE_BUSY_RETRY_AFTER_SECONDS = 60;

function errorName(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

// Bildet einen beliebigen geworfenen Wert auf genau eine öffentliche Klasse ab.
// Wirft nie und liefert für alles Unbekannte den neutralen internen Fehler.
//
// Die Reihenfolge ist Absicht: der Kontingentschutz wird ZUERST geprüft, damit
// er unter keinen Umständen in eine andere Kategorie rutschen kann.
export function mapServerError(err: unknown): MappedError {
  const name = errorName(err);

  // 1. Kontingentschutz. Deckt bewusst ALLE Zustände gemeinsam ab: Burst
  //    erschöpft, Monatsbudget erschöpft, Upstash nicht erreichbar, Upstash
  //    antwortet ungültig, Schutz nicht konfigurierbar. Nach außen sind sie
  //    ununterscheidbar, und das ist der Schutz selbst: sonst wäre ablesbar,
  //    ob eine Lastspitze wirkt oder ob der Schutz gerade blind ist.
  if (name === "WeatherQuotaProtectionError") {
    return {
      status: 503,
      reason: "service_busy",
      message: "Service temporarily unavailable",
      retryAfterSeconds: SERVICE_BUSY_RETRY_AFTER_SECONDS,
    };
  }

  // 2. Zeitüberschreitung beim Provider. AbortSignal.timeout meldet
  //    TimeoutError, der AbortController Rückfall in lib/http.ts meldet
  //    AbortError. Beide Namen bedeuten hier dasselbe.
  if (name === "TimeoutError" || name === "AbortError") {
    return { status: 504, reason: "provider_timeout", message: "Weather provider timed out" };
  }

  // 3. Provider hat geantwortet, aber nicht mit einem verwertbaren Status.
  //    Der Statuswert selbst bleibt serverintern und geht nicht nach außen.
  if (name === "ProviderHttpError") {
    return { status: 502, reason: "provider_error", message: "Weather provider request failed" };
  }

  // 4. Alles übrige: eigener Fehler, Fehlkonfiguration, defekte Antwort,
  //    gescheiterte Abbildung. Neutral und ohne jedes Detail.
  return { status: 500, reason: "internal_error", message: "Internal server error" };
}
