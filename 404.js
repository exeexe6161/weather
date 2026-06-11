"use strict";

// Lang-detect: localStorage weather:lang -> fallback navigator.language -> de.
(function () {
  var lang = "de";

  try {
    var saved = localStorage.getItem("weather:lang");
    if (saved === "de" || saved === "en" || saved === "tr") {
      lang = saved;
    } else {
      var navLang = (navigator.language || "de").toLowerCase();
      if (navLang.indexOf("tr") === 0) {
        lang = "tr";
      } else if (navLang.indexOf("de") !== 0) {
        lang = "en";
      }
    }
  } catch (_) {}

  var translations = {
    de: {
      title: "Seite nicht gefunden",
      text: "Die angeforderte Seite existiert nicht oder wurde verschoben.",
      cta: "Zur Wetter App",
      htmlLang: "de",
      pageTitle: "404 – Seite nicht gefunden | WeatherPure"
    },
    en: {
      title: "Page not found",
      text: "The page you requested does not exist or has been moved.",
      cta: "Back to the weather app",
      htmlLang: "en",
      pageTitle: "404 – Page not found | WeatherPure"
    },
    tr: {
      title: "Sayfa bulunamadı",
      text: "İstediğin sayfa mevcut değil veya taşındı.",
      cta: "Hava uygulamasına dön",
      htmlLang: "tr",
      pageTitle: "404 – Sayfa bulunamadı | WeatherPure"
    }
  };

  var t = translations[lang] || translations.de;
  document.documentElement.lang = t.htmlLang;
  document.title = t.pageTitle;
  var elTitle = document.getElementById("errTitle");
  var elText = document.getElementById("errText");
  var elCta = document.getElementById("errCta");
  if (elTitle) elTitle.textContent = t.title;
  if (elText) elText.textContent = t.text;
  if (elCta) elCta.textContent = t.cta;
})();
