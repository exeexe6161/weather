"use strict";

// Lang-detect: localStorage weather:lang -> fallback navigator.language.
(function () {
  var lang = "de";
  var saved;

  try {
    saved = localStorage.getItem("weather:lang");
  } catch (_) {}
  if (saved === "de" || saved === "en" || saved === "tr") {
    lang = saved;
  } else {
    var navLang = (navigator.language || "de").slice(0, 2).toLowerCase();
    lang = navLang === "de" ? "de" : navLang === "tr" ? "tr" : "en";
  }

  var translations = {
    de: {
      title: "Seite nicht gefunden",
      text: "Die angeforderte Seite existiert nicht oder wurde verschoben.",
      cta: "Zur Wetter App",
      htmlLang: "de",
      pageTitle: "404 – Seite nicht gefunden | WeatherPure",
      description: "Seite nicht gefunden. Zurück zur Wetter App."
    },
    en: {
      title: "Page not found",
      text: "The page you requested does not exist or has been moved.",
      cta: "Back to the weather app",
      htmlLang: "en",
      pageTitle: "404 – Page not found | WeatherPure",
      description: "Page not found. Back to the weather app."
    },
    tr: {
      title: "Sayfa bulunamadı",
      text: "İstediğin sayfa mevcut değil veya taşındı.",
      cta: "Hava uygulamasına dön",
      htmlLang: "tr",
      pageTitle: "404 – Sayfa bulunamadı | WeatherPure",
      description: "Sayfa bulunamadı. Hava uygulamasına dön."
    }
  };

  var t = translations[lang] || translations.de;
  document.documentElement.lang = t.htmlLang;
  document.title = t.pageTitle;
  var description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", t.description);
  var elTitle = document.getElementById("errTitle");
  var elText = document.getElementById("errText");
  var elCta = document.getElementById("errCta");
  if (elTitle) elTitle.textContent = t.title;
  if (elText) elText.textContent = t.text;
  if (elCta) elCta.textContent = t.cta;
})();
