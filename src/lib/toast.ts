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
// Rückfall, falls transitionend ausbleibt (gleiches Muster wie hideSplash in
// main.ts). Muss über der Ausblend-Transition liegen.
const DROP_ACTION_MS = 600;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let dropTimer: ReturnType<typeof setTimeout> | undefined;

// Die aktuell gültige Aktion. Nur sie darf ausgelöst werden. hideToast setzt
// sie auf null, womit eine abgelaufene Aktion wirkungslos wird — sonst könnte
// ein längst verstrichenes Rückgängig später noch die gespeicherte
// Favoritenliste verändern, ohne dass der Nutzer versteht, was er ausgelöst hat.
let activeAction: ToastAction | null = null;

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
  // inert VOR dem Setzen des Inhalts entfernen: eine inerte Live Region meldet
  // ihre Inhaltsänderung nicht an den Screenreader.
  el.removeAttribute("inert");
  // Ein noch laufendes Aufräumen des vorherigen Toasts darf den neuen Knopf
  // nicht mit abräumen.
  if (dropTimer !== undefined) {
    clearTimeout(dropTimer);
    dropTimer = undefined;
  }
  el.textContent = "";
  const msg = document.createElement("span");
  msg.textContent = message;
  el.appendChild(msg);
  el.classList.toggle("wp-toast--interactive", action !== undefined);
  activeAction = action ?? null;
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wp-toast-undo";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      // Die Aktion VOR dem Ausblenden festhalten: hideToast macht sie
      // ungültig, sonst wäre auch der legitime Klick wirkungslos.
      const pending = activeAction;
      hideToast();
      if (pending === action) action.onAction();
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
  // Zuerst ungültig machen, dann ausblenden: ab hier löst nichts mehr aus.
  activeAction = null;
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer);
    toastTimer = undefined;
  }
  // Beide Klassen entfernen: ein ausgeblendeter Toast darf nicht klickbar
  // bleiben (der Knoten samt Knopf bleibt bis zum nächsten showToast stehen).
  el.classList.remove("wp-toast--show", "wp-toast--interactive");
  // inert nimmt den Knoten aus Tastatur, Zeiger UND Screenreader. opacity:0
  // allein tut das nicht: ein unsichtbarer Knopf bleibt fokussierbar, und
  // pointer-events:none stoppt keinen Enter auf einem fokussierten Knopf.
  el.setAttribute("inert", "");
  // Den Aktionsknopf nach dem Ausblenden ganz entfernen, damit auch in
  // Umgebungen ohne inert nichts Bedienbares zurückbleibt.
  const dropAction = (): void => {
    // Ist der Toast inzwischen wieder sichtbar, gehört der Knopf zum neuen
    // Toast und bleibt.
    if (el.classList.contains("wp-toast--show")) return;
    el.querySelector(".wp-toast-undo")?.remove();
  };
  el.addEventListener("transitionend", dropAction, { once: true });
  if (dropTimer !== undefined) clearTimeout(dropTimer);
  dropTimer = setTimeout(dropAction, DROP_ACTION_MS);
}
