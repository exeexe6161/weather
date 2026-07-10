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
  // Zwischenablage. Klappt auch das nicht (kein Clipboard-Zugriff), still nichts tun.
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    showToast(t("share_copied"));
  } catch {
    /* kein Clipboard verfügbar: bewusst kein Crash, keine Rückmeldung */
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
        downloadBlob(file, file.name);
        return;
      }
    }
  }
  // Datei-Teilen nicht unterstützt → Text-Teilen (Etappe 1).
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
