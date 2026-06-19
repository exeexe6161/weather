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

// iOS ignoriert minimum-scale im Meta-Tag im Standalone. Daher den viewport zur
// Laufzeit hart auf scale 1.0 festnageln (nur in der installierten PWA), damit
// die App nicht herausgezoomt starten oder bleiben kann. Vergrößern bleibt durch
// preventPinchZoomInStandalone separat geregelt.
function lockStandaloneScale(): void {
  if (!isStandalone()) return;
  const vp = document.querySelector('meta[name="viewport"]');
  if (!vp) return;
  vp.setAttribute(
    "content",
    "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, viewport-fit=cover"
  );
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

// TEMPORÄR (Überlauf-Sonde 2, nach Messung entfernen): läuft in JEDEM Modus,
// blendet unten eine Zeile ein und benennt das nicht-fixed/sticky Element, dessen
// rechte Kante über die Dokumentbreite ragt. Kein scrollX (das war der Messfehler).
function probe2(): void {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#000;color:#0f0;font:11px monospace;padding:4px 6px;text-align:center;pointer-events:none;";
  document.body.appendChild(box);
  const upd = () => {
    const de = document.documentElement;
    const docW = de.clientWidth;
    const hsw = de.scrollWidth;
    let worst = "", worstR = docW;
    de.querySelectorAll("body *").forEach((node) => {
      const e = node as HTMLElement;
      if (e === box) return;
      const cs = getComputedStyle(e);
      if (cs.position === "fixed" || cs.position === "sticky") return;
      const r = e.getBoundingClientRect();
      if (r.right > worstR + 0.5) {
        let child = false;
        for (const c of Array.from(e.children)) {
          const cr = (c as HTMLElement).getBoundingClientRect();
          const ccs = getComputedStyle(c as HTMLElement);
          if (ccs.position !== "fixed" && ccs.position !== "sticky" && cr.right > docW + 0.5) { child = true; break; }
        }
        if (!child) {
          let n = e.tagName.toLowerCase();
          if (e.id) n += "#" + e.id; else if (typeof e.className === "string" && e.className.trim()) n += "." + e.className.trim().split(/\s+/)[0];
          worst = n + " right=" + Math.round(r.right); worstR = r.right;
        }
      }
    });
    box.textContent = "docW" + docW + " hsw" + hsw + (hsw > docW ? " OVER+" + (hsw - docW) : " ok") + " | " + (worst || "kein nicht-fixed Ueberlaeufer");
  };
  upd();
  window.addEventListener("scroll", upd, { passive: true });
  window.addEventListener("resize", upd);
  window.setTimeout(upd, 500);
  window.setTimeout(upd, 1500);
}

function boot(): void {
  const splashStart = Date.now();
  initLang();
  initLangMenu();
  initApp();
  lockStandaloneScale();
  preventPinchZoomInStandalone();
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
  probe2();
}

if (document.readyState !== "loading") boot();
else document.addEventListener("DOMContentLoaded", boot);
