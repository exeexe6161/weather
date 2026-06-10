// Einstiegspunkt: Sprache initialisieren, App mounten, Sprachmenü und
// Service Worker verdrahten. Theme übernimmt theme-init.js (pre-paint).
import { initLang, setLang, getLang, LANGS, type Lang } from "./i18n/ui";
import { initApp } from "./app";
import { renderIcons } from "./icons";

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

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

function boot(): void {
  initLang();
  initLangMenu();
  initApp();
  renderIcons();
  registerServiceWorker();
}

if (document.readyState !== "loading") boot();
else document.addEventListener("DOMContentLoaded", boot);
