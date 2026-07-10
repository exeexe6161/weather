// Transiente, dezente Rückmeldung am unteren Rand (aus share.ts hierher
// gehoben, damit auch andere Stellen sie nutzen können). Genau ein Toast-Knoten
// modulweit, role=status/aria-live für Screenreader, automatisch wieder
// ausgeblendet. Optional mit EINER Aktion (z. B. Rückgängig): dann bleibt der
// Toast länger stehen und wird klickbar (wp-toast--interactive; der Grund-
// zustand bleibt pointer-events:none, ein unsichtbarer Toast fängt nie Tipps
// ab). Aufbau über DOM-APIs, kein innerHTML mit dynamischen Werten nötig.
export interface ToastAction {
  label: string;
  onAction(): void;
}

const SHOW_MS = 2400;
// Mit Aktion länger sichtbar: der Nutzer braucht Zeit, Rückgängig zu erkennen
// und zu treffen (UX Playbook: Undo statt Bestätigungsdialog).
const SHOW_ACTION_MS = 6000;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, action?: ToastAction): void {
  let el = document.getElementById("wpToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "wpToast";
    el.className = "wp-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = "";
  const msg = document.createElement("span");
  msg.textContent = message;
  el.appendChild(msg);
  el.classList.toggle("wp-toast--interactive", action !== undefined);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wp-toast-undo";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      hideToast();
      action.onAction();
    });
    el.appendChild(btn);
  }
  // Reflow erzwingen, damit die Einblend-Transition auch bei schnellem
  // Nacheinander-Anzeigen erneut greift.
  void el.offsetWidth;
  el.classList.add("wp-toast--show");
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? SHOW_ACTION_MS : SHOW_MS);
}

function hideToast(): void {
  const el = document.getElementById("wpToast");
  if (!el) return;
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer);
    toastTimer = undefined;
  }
  // Beide Klassen entfernen: ein ausgeblendeter Toast darf nicht klickbar
  // bleiben (der Knoten samt Knopf bleibt bis zum nächsten showToast stehen).
  el.classList.remove("wp-toast--show", "wp-toast--interactive");
}
