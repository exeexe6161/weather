/* Pre-paint theme boot + theme toggle + back-button wiring (all pages). */
(function () {
  var html = document.documentElement;

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

  try {
    var saved = null;
    try { saved = localStorage.getItem("theme"); } catch (_) {}
    // Defensive: drop any legacy/invalid theme value
    if (saved && saved !== "dark" && saved !== "light") {
      try { localStorage.removeItem("theme"); } catch (_) {}
      saved = null;
    }
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "dark" || (!saved && prefersDark)) html.setAttribute("data-theme", "dark");
    else if (saved === "light") html.setAttribute("data-theme", "light");
    syncThemeColor();
  } catch (_) {}

  var MOON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN_SVG  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var btn = document.getElementById("themeBtn");
    function glyph() {
      if (!btn) return;
      btn.innerHTML = html.getAttribute("data-theme") === "dark" ? SUN_SVG : MOON_SVG;
    }
    glyph();

    if (btn) {
      btn.addEventListener("click", function () {
        var next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
        html.setAttribute("data-theme", next);
        try { localStorage.setItem("theme", next); } catch (_) {}
        syncThemeColor();
        glyph();
        document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
      });
    }

    var back = document.querySelector('[data-action="back"]');
    if (back) back.addEventListener("click", function () { history.back(); });
  });
})();
