// Teilen über die Web Share API mit Clipboard-Fallback. Muster 1:1 aus EVSpend
// (script.js:458-464): nativer Teilen-Dialog, wenn vorhanden, sonst Text in die
// Zwischenablage. AbortError = Nutzer hat den Dialog abgebrochen, das ist KEIN
// Fehler und wird still verschluckt. Etappe 1 teilt nur Text (kein Bild).
import { t } from "../i18n/ui";

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

// Schlanke, transiente Rückmeldung für den Clipboard-Fallback. Genau ein Toast-
// Knoten modulweit, role=status/aria-live für Screenreader, automatisch nach
// kurzer Zeit wieder ausgeblendet.
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string): void {
  let el = document.getElementById("wpToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "wpToast";
    el.className = "wp-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  // Reflow erzwingen, damit die Einblend-Transition auch bei schnellem
  // Nacheinander-Anzeigen erneut greift.
  void el.offsetWidth;
  el.classList.add("wp-toast--show");
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el?.classList.remove("wp-toast--show");
  }, 2400);
}
