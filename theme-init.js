/* Pre-paint theme boot + theme toggle + back-button wiring (all pages).
 * Rechtsseiten: zusätzlich Sprachkopplung mit der App (weather:lang). */
(function () {
  var html = document.documentElement;

  // Splash-Overlay nur mit JS zeigen (pre-paint gesetzt): ohne JS bliebe es
  // liegen und verdeckte die noscript-Meldung. Universell harmlos — die
  // Rechtsseiten haben kein #splash. Das Splash-CSS hängt an html.js.
  html.classList.add("js");

  // Rechtsseiten tragen data-legal="impressum|datenschutz". Beim Öffnen wird
  // die in der App gespeicherte Sprache übernommen (gleicher localStorage Key
  // wie src/i18n/ui.ts) und pre-paint auf die passende Sprachfassung
  // umgeleitet, damit keine falschsprachige Seite aufblitzt. Deutsch ist die
  // Basisdatei ohne Suffix, EN/TR liegen unter -en/-tr.
  var legalBase = html.getAttribute("data-legal");
  if (legalBase) {
    try {
      var appLang = localStorage.getItem("weather:lang");
      if (
        (appLang === "de" || appLang === "en" || appLang === "tr") &&
        appLang !== html.getAttribute("lang")
      ) {
        location.replace("./" + legalBase + (appLang === "de" ? "" : "-" + appLang));
      }
    } catch (_) {}
  }

  // Sync iOS Safari URL/Status-Bar Farbe mit data-theme (nicht prefers-color-scheme).
  // Verhindert weißen Streifen oben wenn iOS hell ist aber App auf dunkel steht.
  function syncThemeColor() {
    var isDark = html.getAttribute("data-theme") === "dark";
    var color  = isDark ? "#15171A" : "#FFFFFF";
    var metas  = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length) {
      var m = document.createElement("meta");
      m.setAttribute("name", "theme-color");
      m.setAttribute("content", color);
      document.head.appendChild(m);
    } else {
      metas.forEach(function (m) {
        m.removeAttribute("media");
        m.setAttribute("content", color);
      });
    }
  }

  // Theme-Modus: "light" | "dark" | "system". Liegt in localStorage "theme".
  // Fehlt der Wert oder ist er ungültig, gilt "system" (Default für neue Nutzer,
  // folgt dem Gerät). Bestands-Werte "light"/"dark" bleiben unverändert gültig.
  var themeMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function prefersDark() { return !!(themeMedia && themeMedia.matches); }

  function readMode() {
    var v = null;
    try { v = localStorage.getItem("theme"); } catch (_) {}
    if (v === "light" || v === "dark" || v === "system") return v;
    // Unbekannter/veralteter Wert: verwerfen, nichts speichern, Default system.
    if (v != null) { try { localStorage.removeItem("theme"); } catch (_) {} }
    return "system";
  }

  function resolveTheme(mode) {
    if (mode === "dark") return "dark";
    if (mode === "light") return "light";
    return prefersDark() ? "dark" : "light"; // system: folgt dem Gerät
  }

  var currentMode = "system";

  // Setzt data-theme (aufgelöst), data-theme-mode (roher Modus) und Statusbarfarbe.
  function applyMode(mode) {
    currentMode = mode;
    html.setAttribute("data-theme", resolveTheme(mode));
    html.setAttribute("data-theme-mode", mode);
    syncThemeColor();
  }

  // Pre-paint setzen, damit es beim Laden kein Aufblitzen gibt (auch bei system).
  try { applyMode(readMode()); } catch (_) {}

  // Live: wechselt das Gerät hell/dunkel, folgt die App NUR im System-Modus
  // sofort ohne Reload. Bei fest "light"/"dark" bleibt die Wahl unberührt.
  if (themeMedia) {
    var onSystemChange = function () {
      if (currentMode !== "system") return;
      html.setAttribute("data-theme", resolveTheme("system"));
      syncThemeColor();
      document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: html.getAttribute("data-theme"), mode: currentMode } }));
    };
    if (themeMedia.addEventListener) themeMedia.addEventListener("change", onSystemChange);
    else if (themeMedia.addListener) themeMedia.addListener(onSystemChange); // Safari < 14
  }

  var MOON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN_SVG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  // Lucide "sun-moon" (v0.525.0, ISC) — automatisch/Gerät, gleiche Bauart wie oben.
  var SUNMOON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v2"/><path d="M13 8.129A4 4 0 0 1 15.873 11"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/><path d="M9 8a5 5 0 1 0 7 7 7 7 0 1 1-7-7"/></svg>';

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var btn = document.getElementById("themeBtn");
    // Icon zeigt den AKTUELLEN Modus (Zustand, nicht die Aktion):
    // hell → Sonne, dunkel → Mond, system → Sonne+Mond.
    function glyph() {
      if (!btn) return;
      btn.innerHTML = currentMode === "light" ? SUN_SVG : currentMode === "dark" ? MOON_SVG : SUNMOON_SVG;
    }
    glyph();

    if (btn) {
      btn.addEventListener("click", function () {
        // Zyklus: hell → dunkel → system → hell.
        var next = currentMode === "light" ? "dark" : currentMode === "dark" ? "system" : "light";
        var run = function () {
          applyMode(next);
          glyph();
          document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: html.getAttribute("data-theme"), mode: next } }));
        };
        try { localStorage.setItem("theme", next); } catch (_) {}
        // Weicher Crossfade über View Transitions (Dauer in styles-app.css).
        // Ohne Browser-Support oder bei reduzierter Bewegung harter Wechsel —
        // die Funktion hängt nie an der Animation.
        var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (document.startViewTransition && !reduce) document.startViewTransition(run);
        else run();
      });
    }

    var back = document.querySelector('[data-action="back"]');
    if (back) back.addEventListener("click", function () { history.back(); });

    // Sprachumschalter der Rechtsseiten: die Wahl in den App-Key schreiben,
    // BEVOR der Link navigiert — sonst springt die Auto-Weiterleitung oben
    // sofort zurück. Nebeneffekt gewollt: die App wechselt konsistent mit.
    var langLinks = document.querySelectorAll("[data-setlang]");
    for (var i = 0; i < langLinks.length; i++) {
      langLinks[i].addEventListener("click", function () {
        try { localStorage.setItem("weather:lang", this.getAttribute("data-setlang")); } catch (_) {}
      });
    }
  });
})();
