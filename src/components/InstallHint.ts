// Dezenter Hinweis "Zum Home Bildschirm hinzufügen" (PWA Installation).
// Bewusst zurückhaltend: erst ab dem zweiten Besuch, nie in der installierten
// App, nach Wegklicken eine Woche Ruhe, nach Installation nie wieder. Einziger
// gespeicherter Wert ist ein lokaler Merker (kein personenbezogenes Datum,
// keine Übertragung) — in der Datenschutzerklärung ausgewiesen.
import { t } from "../i18n/ui";
import { esc } from "../dom";
import { renderIcons } from "../icons";
import { isNativeApp, isStandalone } from "../lib/platform";

// Nach dem Wegklicken so viele Tage Ruhe, dann darf der Hinweis wiederkommen
export const REMIND_AFTER_DAYS = 7;

const HINT_KEY = "weather:install-hint";

interface HintState {
  seen?: string;        // erster Besuch (ISO); Hinweis erst ab dem Folgebesuch
  dismissedAt?: string; // letztes Wegklicken (ISO)
  done?: boolean;       // installiert → nie wieder
}

// Chromium-Ereignis; fehlt in lib.dom, daher minimal selbst typisiert
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Variant = "prompt" | "ios";

function readState(): HintState {
  try {
    return JSON.parse(localStorage.getItem(HINT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeState(state: HintState): void {
  try { localStorage.setItem(HINT_KEY, JSON.stringify(state)); } catch {}
}

// iOS Safari: kein beforeinstallprompt, Installation nur über Teilen-Menü.
// iPadOS maskiert sich als Mac (MacIntel + Touch). Chrome/Firefox/Edge auf iOS
// können selbst nicht installieren → dort lieber nichts zeigen (zurückhaltend).
function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIos && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function initInstallHint(root: HTMLElement): void {
  // In der nativen App (Capacitor) nie ein "Zum Home-Bildschirm"-Hinweis: die
  // App ist schon installiert, und isStandalone() greift im WKWebView nicht.
  if (isNativeApp()) return;
  if (isStandalone()) return;

  const state = readState();
  if (state.done) return;

  // Erster Besuch: nur den Marker setzen, Hinweis erst ab dem nächsten Besuch
  if (typeof state.seen !== "string") {
    writeState({ ...state, seen: new Date().toISOString() });
    return;
  }

  if (state.dismissedAt) {
    const elapsed = Date.now() - Date.parse(state.dismissedAt);
    if (Number.isFinite(elapsed) && elapsed < REMIND_AFTER_DAYS * 86_400_000) return;
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let visibleVariant: Variant | null = null;

  function hide(): void {
    visibleVariant = null;
    root.hidden = true;
    root.innerHTML = "";
  }

  function dismiss(): void {
    writeState({ ...readState(), dismissedAt: new Date().toISOString() });
    hide();
  }

  function markDone(): void {
    writeState({ ...readState(), done: true });
    hide();
  }

  function show(variant: Variant): void {
    visibleVariant = variant;
    const title = t(variant === "prompt" ? "install_title_prompt" : "install_title_ios");
    const text = t(variant === "prompt" ? "install_text_prompt" : "install_text_ios");
    root.innerHTML = `
      <section class="install-hint" aria-label="${esc(title)}">
        <div class="install-hint-copy">
          <div class="install-hint-title">${esc(title)}</div>
          <div class="install-hint-text">${esc(text)}</div>
        </div>
        ${variant === "prompt" ? `<button type="button" class="install-hint-btn" id="installHintBtn">${esc(t("install_button"))}</button>` : ""}
        <button type="button" class="install-hint-x" id="installHintX" aria-label="${esc(t("install_dismiss"))}">
          <i data-lucide="x" class="install-hint-x-ico"></i>
        </button>
      </section>`;
    root.hidden = false;
    renderIcons();

    document.getElementById("installHintX")?.addEventListener("click", dismiss);
    document.getElementById("installHintBtn")?.addEventListener("click", () => {
      const prompt = deferredPrompt;
      if (!prompt) return dismiss();
      deferredPrompt = null; // das Ereignis ist nur einmal verwendbar
      prompt.prompt();
      prompt.userChoice.then(({ outcome }) => {
        if (outcome === "accepted") markDone();
        else dismiss(); // nativ abgelehnt → wie Wegklicken, eine Woche Ruhe
      });
    });
  }

  // Chromium (Chrome/Edge): echtes Installationsereignis abfangen. Es feuert
  // nur, wenn die App installierbar und noch nicht installiert ist — die
  // Browser-eigene Infoleiste wird unterdrückt, wir zeigen unseren Hinweis.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    show("prompt");
  });
  window.addEventListener("appinstalled", markDone);

  // iOS Safari: keine auslösbare Installation, stattdessen kurze Anleitung
  if (isIosSafari()) show("ios");
  // Alles andere (Desktop Safari, Firefox): bewusst kein Hinweis

  // Sprachwechsel: sichtbaren Hinweis mit neuen Texten neu rendern
  document.addEventListener("weather:langchange", () => {
    if (visibleVariant) show(visibleVariant);
  });
}
