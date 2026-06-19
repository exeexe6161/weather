// Einstiegspunkt: Sprache initialisieren, App mounten, Sprachmenü und
// Service Worker verdrahten. Theme übernimmt theme-init.js (pre-paint).
import { initLang, setLang, getLang, LANGS, type Lang } from "./i18n/ui";
import { initApp } from "./app";
import { initInstallHint } from "./components/InstallHint";
import { renderIcons } from "./icons";
import { isNativeApp, isStandalone } from "./lib/platform";

function initLangMenu(): void {
  const btn = document.getElementById("langSwitch") as HTMLButtonElement | null;
  const menu = document.getElementById("langMenu");
  const label = document.getElementById("langSwitchLabel");
  if (!btn || !menu || !label) return;

  function sync(): void {
    label!.textContent = getLang().toUpperCase();
    menu!.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((item) => {
      item.setAttribute("aria-current", String(item.dataset.lang === getLang()));
    });
  }

  function close(): void {
    menu!.hidden = true;
    btn!.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });

  menu.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((item) => {
    item.addEventListener("click", () => {
      const lang = item.dataset.lang as Lang;
      if (LANGS.includes(lang)) setLang(lang);
      sync();
      close();
    });
  });

  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  sync();
}

// Pinch-Zoom nur in der vom Home-Bildschirm gestarteten PWA unterbinden. Im
// normalen Browser bleibt Zoom erlaubt (Barrierefreiheit). Nur gesturestart,
// kein Doppeltipp und kein touchmove, damit Scrollen unberührt bleibt.
function preventPinchZoomInStandalone(): void {
  if (!isStandalone()) return;
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

// TEMPORÄR (Mess-Overlay zur Überlauf-Diagnose, nach Messung entfernen): zeigt
// nur im Standalone-Modus oben links innerWidth, body/html scrollWidth und die
// safe-area-Werte. Rein additiv, kein Layout-Eingriff (pointer-events:none).
function debugViewportOverlay(): void {
  if (!isStandalone()) return;
  const update = () => {
    let el = document.getElementById("vpDebug");
    if (!el) {
      el = document.createElement("div");
      el.id = "vpDebug";
      el.style.cssText = "position:fixed;top:60px;left:8px;z-index:99999;background:#000;color:#0f0;font:12px monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre;line-height:1.4;";
      document.body.appendChild(el);
    }
    const iw = window.innerWidth;
    const bsw = document.body.scrollWidth;
    const dew = document.documentElement.scrollWidth;
    const sr = getComputedStyle(document.documentElement).getPropertyValue("--safe-r") || "?";
    const sl = getComputedStyle(document.documentElement).getPropertyValue("--safe-l") || "?";
    el.textContent =
      "innerWidth: " + iw + "\n" +
      "body.scrollW: " + bsw + (bsw > iw ? "  OVERFLOW +" + (bsw - iw) : "  ok") + "\n" +
      "html.scrollW: " + dew + (dew > iw ? "  OVERFLOW +" + (dew - iw) : "  ok") + "\n" +
      "safe-l/r: " + sl.trim() + " / " + sr.trim();
  };
  update();
  window.addEventListener("resize", update);
}

function registerServiceWorker(): void {
  // Native App (Capacitor): kein Service Worker. Im WKWebView ist er ohnehin
  // wirkungslos, das Web-Bundle wird lokal aus dem App-Container geladen.
  if (isNativeApp()) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Splash ausblenden: Klasse togglen (CSP-konform, kein Inline-Style), nach der
// Transition das Element entfernen, damit es die App darunter nicht blockiert.
// Fallback-Timeout greift, falls transitionend ausbleibt.
function hideSplash(): void {
  const el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("splash--hidden");
  const remove = (): void => el.remove();
  el.addEventListener("transitionend", remove, { once: true });
  window.setTimeout(remove, 600);
}

function boot(): void {
  const splashStart = Date.now();
  initLang();
  initLangMenu();
  initApp();
  preventPinchZoomInStandalone();
  const installHint = document.getElementById("installHint");
  if (installHint) initInstallHint(installHint);
  renderIcons();
  registerServiceWorker();
  debugViewportOverlay();

  // Splash nur beim Seitenstart ausblenden — NICHT an refreshCurrentPlace
  // gekoppelt (der lädt nur Daten, nicht die Seite). Sichtbar mindestens ~1,2 s,
  // spätestens nach ~2 s weg (harte Obergrenze, damit langsames Laden nicht
  // blockiert). Die App lädt im Hintergrund normal weiter, nichts wird künstlich
  // verzögert. boot() läuft synchron → "App bereit" ≈ jetzt.
  const elapsed = Date.now() - splashStart;
  const delay = Math.max(0, Math.min(2000, Math.max(1200, elapsed)) - elapsed);
  window.setTimeout(hideSplash, delay);
}

if (document.readyState !== "loading") boot();
else document.addEventListener("DOMContentLoaded", boot);
