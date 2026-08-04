// Teilen über die Web Share API mit Clipboard-Fallback. Muster 1:1 aus EVSpend
// (script.js:458-464): nativer Teilen-Dialog, wenn vorhanden, sonst Text in die
// Zwischenablage. AbortError = Nutzer hat den Dialog abgebrochen, das ist KEIN
// Fehler und wird still verschluckt. Etappe 1 teilt nur Text (kein Bild).
import { t } from "../i18n/ui";
import { showToast } from "./toast";

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

// Welche Fähigkeiten das Gerät für das Teilen mitbringt. Bewusst reine Flags
// statt der Browser-Objekte: so lässt sich die Entscheidung darunter ohne DOM
// und ohne Browser prüfen.
export interface ShareCapabilities {
  hasShare: boolean;
  canShareFiles: boolean;
  hasClipboard: boolean;
}

export type SharePath = "image" | "native-text" | "clipboard" | "unsupported";

// Entscheidet den Teilen-Pfad allein aus den Fähigkeiten — reine Funktion, ruft
// selbst keine Browser-API auf. Der Aufrufer prüft die Fähigkeiten EINMAL vorab
// und weiß dadurch schon vor der teuren Bilderzeugung, ob ein Bild überhaupt
// einen Abnehmer hat.
//
// Reihenfolge:
//   1. Dateien teilbar        -> "image"        (bestes Ergebnis, hat Vorrang)
//   2. nur Text teilbar       -> "native-text"  (nativer Dialog ohne Bild)
//   3. kein natives Teilen    -> "clipboard"    (Text in die Zwischenablage)
//   4. gar nichts             -> "unsupported"  (ehrlich melden statt still enden)
//
// canShareFiles ohne hasShare ist kein realer Browserzustand (canShare gibt es
// nur zusammen mit share) und zählt deshalb nicht als eigener Pfad.
export function decideSharePath(caps: ShareCapabilities): SharePath {
  if (caps.hasShare && caps.canShareFiles) return "image";
  if (caps.hasShare) return "native-text";
  if (caps.hasClipboard) return "clipboard";
  return "unsupported";
}

export async function shareText(payload: SharePayload): Promise<void> {
  const { title, text, url } = payload;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      // Abbruch des Teilen-Dialogs ist kein Fehler → keine Rückmeldung, kein Fallback.
      if ((err as DOMException)?.name === "AbortError") return;
    }
  }
  // Fallback (kein navigator.share ODER ein anderer Fehler): Text samt URL in die
  // Zwischenablage. Fehlt navigator.clipboard ganz, wirft schon der Zugriff und
  // landet im selben catch — beide Fälle sind für den Nutzer dasselbe: es hat
  // nicht geklappt, und das muss er erfahren statt ins Leere zu tippen.
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    showToast(t("share_copied"));
  } catch {
    showToast(t("share_failed"));
  }
}

// Bild-Teilen (Etappe 2), Muster aus EVSpend (shareImageCanvas). Dreistufig:
//   1) navigator.share({files, title, text, url})
//   2) bei Fehler erneut OHNE url (manche Ziele lehnen files+url ab)
//   3) scheitert auch das, das PNG herunterladen.
// Kann das Gerät gar keine Dateien teilen (kein canShare(files), z. B. Desktop),
// fällt es auf Text-Teilen aus Etappe 1 zurück — nützlicher als ein Zwangs-
// Download. AbortError (Nutzer bricht ab) ist in keiner Stufe ein Fehler.
export async function shareImage(payload: SharePayload, file: File): Promise<void> {
  const { title, text, url } = payload;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text, url });
      return;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      try {
        await navigator.share({ files: [file], title, text });
        return;
      } catch (err2) {
        if ((err2 as DOMException)?.name === "AbortError") return;
        // Letzte Stufe: das Bild landet im Download-Ordner. Ohne Rückmeldung
        // sähe das aus, als wäre nichts passiert.
        downloadBlob(file, file.name);
        showToast(t("share_downloaded"));
        return;
      }
    }
  }
  // Selten erreichbar, aber NICHT tot: app.ts prüft vorab mit einer winzigen
  // Probedatei, hier oben wird mit dem echten, deutlich größeren PNG erneut
  // gefragt. Sagt der Browser für die Probe ja und für die echte Datei nein
  // (Größen- oder Typgrenzen), landen wir hier. Dann bleibt Text-Teilen, das
  // seinen Ausgang selbst meldet. Deckt zusätzlich einen künftigen Aufrufer ab,
  // der ohne Vorprüfung kommt (gleiches Muster wie der Geo-Guard in favorites.ts).
  await shareText(payload);
}

function downloadBlob(blob: Blob, name: string): void {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
