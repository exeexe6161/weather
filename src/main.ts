// Einstiegspunkt: Sprache initialisieren, App mounten, Sprachmenü und
// Service Worker verdrahten. Theme übernimmt theme-init.js (pre-paint).
import { initLang, setLang, getLang, t, LANGS, type Lang } from "./i18n/ui";
import { initApp } from "./app";
import { initInstallHint } from "./components/InstallHint";
import { renderIcons } from "./icons";
import { isNativeApp } from "./lib/platform";

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

// Das aria-label (und der Titel) des Theme-Knopfs spiegeln den aktuellen Modus
// lokalisiert wider. theme-init.js besitzt die Theme-Logik und schreibt
// data-theme-mode auf <html> plus das themechange-Event; hier wird daraus nur
// der zugängliche Name gesetzt: bei Start, bei Moduswechsel und bei
// Sprachwechsel. Auf den Rechtsseiten ohne App-Bundle bleibt das statische
// Fallback-Label aus dem Markup.
function initThemeLabel(): void {
  const btn = document.getElementById("themeBtn");
  if (!btn) return;
  const keyFor = (mode: string | null): string =>
    mode === "light" ? "themeLight" : mode === "dark" ? "themeDark" : "themeSystem";
  const apply = (): void => {
    const label = t(keyFor(document.documentElement.getAttribute("data-theme-mode")));
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  };
  apply();
  document.addEventListener("themechange", apply);
  document.addEventListener("weather:langchange", apply);
}

// iOS Safari kann den visuellen Viewport nach Tastatur/Fokus oder nach einem
// horizontalen Wisch bei normalem Zoom seitlich versetzt stehen lassen. Echte
// Vergrößerung bleibt erlaubt; nur bei Scale 1 wird die Seite zurückgesetzt.
function stabilizeHorizontalViewport(): void {
  const reset = (): void => {
    if (window.visualViewport && window.visualViewport.scale > 1.01) return;
    if (window.scrollX === 0 && document.documentElement.scrollLeft === 0 && document.body.scrollLeft === 0) return;
    window.scrollTo({ left: 0, top: window.scrollY, behavior: "auto" });
  };

  let pending = 0;
  const scheduleReset = (): void => {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(reset);
  };

  window.addEventListener("scroll", scheduleReset, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleReset, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleReset, { passive: true });
  document.addEventListener("focusout", () => {
    scheduleReset();
    window.setTimeout(scheduleReset, 300);
  }, true);
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
  initThemeLabel();
  initApp();
  stabilizeHorizontalViewport();
  const installHint = document.getElementById("installHint");
  if (installHint) initInstallHint(installHint);
  renderIcons();
  registerServiceWorker();

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
