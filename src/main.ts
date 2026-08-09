// Einstiegspunkt: Sprache initialisieren, App mounten, Sprachmenü und
// Service Worker verdrahten. Theme übernimmt theme-init.js (pre-paint).
import { initLang, setLang, getLang, t, LANGS, type Lang } from "./i18n/ui";
import { initApp } from "./app";
import { initInstallHint } from "./components/InstallHint";
import { renderIcons } from "./icons";
import { isNativeApp } from "./lib/platform";

// Sprachwahl als Disclosure, nicht als ARIA-Menü: der Auslöser trägt
// aria-expanded und aria-controls, das Popup ist ein schlichtes div, die
// Einträge sind native Buttons. role="menu"/"menuitem" hätten Pfeiltasten,
// Home, End und roving tabindex versprochen — tatsächlich läuft schlichte
// Tab-Navigation, und genau die kündigt das Disclosure-Muster auch an.
function initLangMenu(): void {
  const btn = document.getElementById("langSwitch") as HTMLButtonElement | null;
  const menu = document.getElementById("langMenu");
  const label = document.getElementById("langSwitchLabel");
  if (!btn || !menu || !label) return;
  // Auslöser und Popup zusammen bilden den Sprachbereich; focusout schließt nur,
  // wenn der Fokus diesen Bereich wirklich verlässt.
  const wrap = btn.closest<HTMLElement>(".top-pill-wrap");

  function sync(): void {
    label!.textContent = getLang().toUpperCase();
    menu!.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((item) => {
      // Nur die aktive Sprache trägt aria-current. aria-current="false" auf den
      // übrigen Einträgen wäre gültig, aber Rauschen. Der Stil hängt an
      // .top-menu-item[aria-current="true"] (styles-app.css) und bleibt gültig.
      if (item.dataset.lang === getLang()) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
  }

  // returnFocus nur dort, wo der Fokus sonst ins Leere fiele: nach Escape und
  // nach der Sprachwahl (der gewählte Button verschwindet mit dem Popup). Beim
  // Klick außerhalb hat der Klick den Fokus bewusst woandershin gesetzt.
  function close(returnFocus: boolean): void {
    if (menu!.hidden) return;
    menu!.hidden = true;
    btn!.setAttribute("aria-expanded", "false");
    if (returnFocus) btn!.focus();
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
      close(true);
    });
  });

  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) close(false);
  });
  // Zwei Bedingungen, beide nötig: Suche (SearchBar) und Stundenpanel
  // (HourlyStrip) hören ebenfalls dokumentweit auf Escape. Ohne menu.hidden
  // risse ein Escape dort den Fokus auf den Sprachknopf. Und der Fokus wandert
  // nur zurück, wenn er wirklich im Sprachbereich liegt: ein Mausklick auf den
  // Auslöser öffnet das Popup, ohne ihn (in Safari) zu fokussieren, der Fokus
  // kann also im Suchfeld stehen, während das Popup offen ist. Kein
  // stopPropagation, damit die anderen Handler ihr Escape weiterhin sehen.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || menu.hidden) return;
    close(wrap ? wrap.contains(document.activeElement) : true);
  });

  // Beim Weitertabben aus dem Sprachbereich heraus schließen. relatedTarget ===
  // null heißt "Fokus ins Nichts" (Safari setzt beim Mausklick auf einen Button
  // keinen Fokus) und darf NICHT schließen, sonst wäre das Popup weg, bevor das
  // click-Event des Eintrags feuert. Diesen Fall deckt der Klick-außerhalb-
  // Handler ab. Kein setTimeout nötig.
  if (wrap) {
    wrap.addEventListener("focusout", (e) => {
      const next = e.relatedTarget as Node | null;
      if (!next) return;
      if (!wrap.contains(next)) close(false);
    });
  }

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
