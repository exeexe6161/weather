// Fehlerklassifizierung für Netzabrufe.
//
// Ohne sie meldet jeder gescheiterte Abruf pauschal "Keine Verbindung" — auch
// ein Serverfehler, ein Providerausfall oder eine Ratenbegrenzung, obwohl die
// Verbindung des Nutzers einwandfrei ist. Das ist eine Falschaussage der App
// über den Zustand des Nutzers: er sucht den Fehler bei sich, schaltet WLAN um,
// startet neu. Ein Fehlertext muss sagen, was tatsächlich passiert ist.
//
// Bewusst OHNE Zugriff auf navigator: der Online-Zustand kommt als Parameter
// herein, damit die Klassifizierung eine reine Funktion bleibt und in Node
// ohne DOM geprüft werden kann.

// Fehler eines Abrufs, der eine Antwort bekommen hat, aber keine gültige.
// Trägt den HTTP Status als auswertbare Eigenschaft; die Meldung bleibt
// unverändert zum bisherigen Wortlaut, damit bestehende Prüfungen greifen.
export class RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

export type LoadErrorKind = "offline" | "timeout" | "rateLimit" | "server" | "unknown";

// Status eines RequestError, auch wenn instanceof scheitert. Letzteres kann
// passieren, wenn ein Fehler eine Bündelgrenze überquert und damit auf eine
// zweite Klassenidentität trifft. Die zweite Prüfung schaut auf die Form,
// statt sie zu raten.
function statusOf(err: unknown): number | null {
  if (err instanceof RequestError) return err.status;
  if (typeof err === "object" && err !== null) {
    const shape = err as { name?: unknown; status?: unknown };
    if (shape.name === "RequestError" && typeof shape.status === "number") return shape.status;
  }
  return null;
}

export function classifyLoadError(err: unknown, online: boolean): LoadErrorKind {
  // Echtes Offline hat Vorrang vor allem anderen: liegt keine Verbindung an,
  // ist jede feinere Unterscheidung für den Nutzer ohne Bedeutung.
  if (online === false) return "offline";

  // fetchWithTimeout bricht über ein AbortSignal ab. Je nach Browser heißt der
  // Fehler TimeoutError (AbortSignal.timeout) oder AbortError (der
  // AbortController Rückfall in http.ts).
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";

  const status = statusOf(err);
  if (status !== null) {
    if (status === 429) return "rateLimit";
    if (status >= 500) return "server";
  }

  // fetch wirft bei Netzfehlern einen TypeError. Bei online === true bedeutet
  // das gerade NICHT "offline", sondern nur "hat nicht geklappt". Deshalb
  // neutral bleiben, statt eine Ursache zu behaupten.
  return "unknown";
}

// Hinweistext in der Wetterkarte, wenn gespeicherte Daten weiter angezeigt
// werden. Liefert nur den Schlüssel, damit dieses Modul frei von i18n bleibt.
export function failNoteKey(kind: LoadErrorKind): string {
  switch (kind) {
    case "offline": return "offlineNote";
    case "timeout": return "failTimeout";
    case "rateLimit": return "failRateLimit";
    case "server": return "failServer";
    default: return "failUnknown";
  }
}

// Titel der Fehleransicht, wenn gar nichts anzeigbar ist.
//
// Ein aufgebrauchtes Kontingent ist hier bewusst NICHT eigens benannt: die
// Route in api/weather.ts fasst Providerausfall und Kontingentende zu einem
// 502 zusammen, und der Server steht unter Freeze. Der Sammeltext für 5xx ist
// für beide Fälle wahr und behauptet nichts, was nicht belegt ist.
export function failTitleKey(kind: LoadErrorKind): string {
  switch (kind) {
    case "offline": return "errorOffline";
    case "timeout": return "errorTimeout";
    case "rateLimit": return "errorRateLimit";
    case "server": return "errorServer";
    default: return "loadError";
  }
}
