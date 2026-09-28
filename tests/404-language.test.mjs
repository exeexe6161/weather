import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../404.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../404.js', import.meta.url), 'utf8');
const initialDescription = html.match(/<meta name="description" content="([^"]+)">/)?.[1];
assert.ok(initialDescription);

function render404({ saved = null, browser = 'de-DE', storageThrows = false } = {}) {
  const elements = new Map(['errTitle', 'errText', 'errCta'].map((id) => [id, { textContent: '' }]));
  const description = {
    content: initialDescription,
    setAttribute(name, value) {
      assert.equal(name, 'content');
      this.content = value;
    },
  };
  const document = {
    documentElement: { lang: 'de' },
    title: '404 – Seite nicht gefunden | WeatherPure',
    querySelector(selector) {
      assert.equal(selector, 'meta[name="description"]');
      return description;
    },
    getElementById(id) { return elements.get(id) ?? null; },
  };
  const localStorage = {
    getItem(key) {
      assert.equal(key, 'weather:lang');
      if (storageThrows) throw new Error('storage unavailable');
      return saved;
    },
  };
  vm.runInNewContext(script, { document, localStorage, navigator: { language: browser } });
  return {
    lang: document.documentElement.lang,
    title: document.title,
    heading: elements.get('errTitle').textContent,
    text: elements.get('errText').textContent,
    cta: elements.get('errCta').textContent,
    description: description.content,
  };
}

const expected = {
  de: {
    lang: 'de',
    title: '404 – Seite nicht gefunden | WeatherPure',
    heading: 'Seite nicht gefunden',
    text: 'Die angeforderte Seite existiert nicht oder wurde verschoben.',
    cta: 'Zur Wetter App',
    description: 'Seite nicht gefunden. Zurück zur Wetter App.',
  },
  en: {
    lang: 'en',
    title: '404 – Page not found | WeatherPure',
    heading: 'Page not found',
    text: 'The page you requested does not exist or has been moved.',
    cta: 'Back to the weather app',
    description: 'Page not found. Back to the weather app.',
  },
  tr: {
    lang: 'tr',
    title: '404 – Sayfa bulunamadı | WeatherPure',
    heading: 'Sayfa bulunamadı',
    text: 'İstediğin sayfa mevcut değil veya taşındı.',
    cta: 'Hava uygulamasına dön',
    description: 'Sayfa bulunamadı. Hava uygulamasına dön.',
  },
};

const cases = [
  ['A: gespeichertes DE', { saved: 'de' }, 'de'],
  ['B: gespeichertes EN', { saved: 'en' }, 'en'],
  ['C: gespeichertes TR', { saved: 'tr' }, 'tr'],
  ['D: Speicherfehler und en-US', { storageThrows: true, browser: 'en-US' }, 'en'],
  ['E: Speicherfehler und tr-TR', { storageThrows: true, browser: 'tr-TR' }, 'tr'],
  ['F: Speicherfehler und de-DE', { storageThrows: true, browser: 'de-DE' }, 'de'],
  ['G: regionale Variante en-GB', { browser: 'en-GB' }, 'en'],
  ['H: unbekannte Browsersprache fr-FR', { browser: 'fr-FR' }, 'en'],
  ['I: gespeichertes TR vor Browser EN', { saved: 'tr', browser: 'en-US' }, 'tr'],
  ['J: ungueltiger Speicherwert und Browser TR', { saved: 'invalid', browser: 'tr-TR' }, 'tr'],
];

for (const [name, options, language] of cases) {
  test(name, () => assert.deepEqual(render404(options), expected[language]));
}
