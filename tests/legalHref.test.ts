import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { loadBundledModule } from './testHarness.ts';
import type * as Ui from '../src/i18n/ui.ts';

const { legalHref, LANGS, applyI18n, setLang } = await loadBundledModule<typeof Ui>(`
  export { legalHref, LANGS, applyI18n, setLang } from './src/i18n/ui.ts';
`);

// Die Footer-Links der App müssen auf die sprachlich passende Rechtsseite
// zeigen, schon beim ersten Besuch. Deutsch ist die Basisdatei ohne Suffix,
// EN und TR liegen unter -en bzw. -tr — dieselbe Konvention, nach der
// theme-init.js auf den Rechtsseiten selbst umleitet.

test('Deutsch fuehrt auf die Basisdatei ohne Suffix', () => {
  assert.equal(legalHref('impressum', 'de'), './impressum');
  assert.equal(legalHref('datenschutz', 'de'), './datenschutz');
});

test('Englisch fuehrt auf die -en Fassung', () => {
  assert.equal(legalHref('impressum', 'en'), './impressum-en');
  assert.equal(legalHref('datenschutz', 'en'), './datenschutz-en');
});

test('Tuerkisch fuehrt auf die -tr Fassung', () => {
  assert.equal(legalHref('impressum', 'tr'), './impressum-tr');
  assert.equal(legalHref('datenschutz', 'tr'), './datenschutz-tr');
});

test('jede unterstuetzte Sprache liefert fuer beide Seiten einen relativen Pfad', () => {
  // Kommt eine vierte Sprache dazu, faellt hier auf, wenn legalHref sie nicht
  // abdeckt — statt still auf die deutsche Fassung zu zeigen.
  for (const lang of LANGS) {
    for (const base of ['impressum', 'datenschutz'] as const) {
      const href = legalHref(base, lang);
      assert.ok(href.startsWith(`./${base}`), `${base}/${lang} muss auf ./${base} aufbauen`);
      assert.ok(!href.includes('//'), `${base}/${lang} darf keinen doppelten Trenner enthalten`);
    }
  }
});

test('die Zieldatei ist je Sprache eindeutig', () => {
  // Zwei Sprachen duerfen nie auf dieselbe Datei zeigen, sonst waere eine
  // Sprachfassung unerreichbar.
  const hrefs = LANGS.map((lang) => legalHref('impressum', lang));
  assert.equal(new Set(hrefs).size, LANGS.length);
});

const bases = ['datenschutz', 'impressum'] as const;
const themeScript = readFileSync(new URL('../theme-init.js', import.meta.url), 'utf8');
const fileName = (base: string, lang: string) => `${base}${lang === 'de' ? '' : `-${lang}`}.html`;

function installGlobal(context: TestContext, key: string, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  });
}

function element(attributes: Record<string, string> = {}) {
  const listeners = new Map<string, () => void>();
  return {
    attributes, listeners, textContent: '',
    getAttribute(name: string) { return this.attributes[name] ?? null; },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    removeAttribute(name: string) { delete this.attributes[name]; },
    addEventListener(name: string, callback: () => void) { listeners.set(name, callback); },
    click() { listeners.get('click')?.call(this); },
  };
}

// Execute the existing standalone navigation script against the actual six HTML
// files. This models hrefs and events, not WKWebView or a device runtime.
function legalPage(base: string, lang: string, capacitor?: unknown, saved = lang, storageThrows = false) {
  const html = readFileSync(new URL(`../${fileName(base, lang)}`, import.meta.url), 'utf8');
  const attributes = (source: string) => Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const root = { ...element(attributes(html.match(/<html\b([^>]*)>/)![1])), classList: { add() {} } };
  const anchors = [...html.matchAll(/<a\b([^>]*)>/g)].map(m => element(attributes(m[1])));
  const originalHrefs = anchors.map(a => a.getAttribute('href'));
  const back = element();
  const storage = new Map([['weather:lang', saved]]);
  const redirects: string[] = [];
  let backCalls = 0;
  let onReady = () => {};
  const document = {
    documentElement: root, readyState: 'loading', head: { appendChild() {} },
    createElement: () => element(), getElementById: () => null,
    querySelector: (selector: string) => selector === '[data-action="back"]' ? back : null,
    querySelectorAll: (selector: string) => selector === '[data-setlang]'
      ? anchors.filter(a => a.getAttribute('data-setlang')) : selector === 'a[href]' ? anchors : [],
    addEventListener: (name: string, callback: () => void) => { assert.equal(name, 'DOMContentLoaded'); onReady = callback; },
  };
  vm.runInNewContext(themeScript, {
    document, window: { Capacitor: capacitor },
    localStorage: {
      getItem: (key: string) => { if (storageThrows) throw new Error('storage unavailable'); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (storageThrows) throw new Error('storage unavailable'); storage.set(key, value); },
    },
    location: { replace: (href: string) => redirects.push(href) }, history: { back: () => backCalls++ },
    fetch: () => { throw new Error('Network is unavailable'); },
  });
  onReady();
  return { anchors, originalHrefs, redirects, storage, back, backCalls: () => backCalls };
}

for (const native of [false, true]) {
  test(`N01 app footer and language changes use ${native ? 'local HTML' : 'web clean URLs'}`, (context) => {
    installGlobal(context, 'window', { Capacitor: { isNativePlatform: () => native } });
    const anchors = bases.map(base => element({ 'data-i18n-href': base, href: './' + base }));
    installGlobal(context, 'document', {
      documentElement: {}, title: '', dispatchEvent() {},
      querySelectorAll: (selector: string) => selector === '[data-i18n-href]' ? anchors : [],
    });
    for (const lang of LANGS) {
      setLang(lang);
      applyI18n();
      for (const [i, base] of bases.entries()) {
        const expected = './' + fileName(base, lang).replace(native ? /$/ : /\.html$/, '');
        assert.equal(legalHref(base, lang), expected);
        assert.equal(anchors[i].getAttribute('href'), expected);
        if (native) assert.ok(existsSync(new URL(`../${fileName(base, lang)}`, import.meta.url)));
      }
    }
  });

  test(`N01 all six legal documents preserve ${native ? 'native' : 'web'} language links and cross references`, () => {
    const cap = { isNativePlatform: () => native };
    for (const base of bases) for (const lang of LANGS) {
      const page = legalPage(base, lang, cap);
      assert.deepEqual(page.redirects, []);
      for (const [i, anchor] of page.anchors.entries()) {
        const original = page.originalHrefs[i];
        const localLegal = /^\.\/(datenschutz|impressum)(-en|-tr)?$/.test(original);
        assert.equal(anchor.getAttribute('href'), original + (native && localLegal ? '.html' : ''));
        if (native && localLegal) {
          const target = new URL(anchor.getAttribute('href'), `capacitor://localhost/${fileName(base, lang)}`);
          assert.equal(target.protocol, 'capacitor:');
          assert.equal(target.host, 'localhost');
          assert.ok(existsSync(new URL(`..${target.pathname}`, import.meta.url)));
        }
        const nextLang = anchor.getAttribute('data-setlang');
        if (nextLang) {
          anchor.click();
          assert.equal(page.storage.get('weather:lang'), nextLang);
          assert.deepEqual(legalPage(base, nextLang, cap, page.storage.get('weather:lang')).redirects, []);
        }
      }
      page.back.click();
      assert.equal(page.backCalls(), 1);
      assert.ok(page.anchors.some(a => a.getAttribute('href') === './'));
      for (const saved of LANGS) {
        const redirected = legalPage(base, lang, cap, saved).redirects;
        const target = './' + fileName(base, saved).replace(native ? /$/ : /\.html$/, '');
        assert.deepEqual(redirected, saved === lang ? [] : [target]);
      }
    }
  });
}

test('N01 platform fallback matches the existing native detector, without user agent inference', (context) => {
  const window = { Capacitor: undefined as unknown };
  installGlobal(context, 'window', window);
  for (const [cap, suffix] of [[undefined, ''], [{ isNative: true }, '.html'], [{ isNativePlatform: () => false, isNative: true }, '']] as const) {
    window.Capacitor = cap;
    assert.equal(legalHref('datenschutz', 'en'), './datenschutz-en' + suffix);
    const page = legalPage('datenschutz', 'en', cap, 'tr');
    assert.deepEqual(page.redirects, ['./datenschutz-tr' + suffix]);
  }
});

test('N01 local legal navigation works with unavailable storage and network', () => {
  for (const base of bases) for (const lang of LANGS) {
    const page = legalPage(base, lang, { isNativePlatform: () => true }, lang, true);
    assert.deepEqual(page.redirects, []);
    for (const anchor of page.anchors.filter(a => a.getAttribute('data-setlang'))) {
      anchor.click();
      assert.match(anchor.getAttribute('href'), /^\.\/(datenschutz|impressum)(-en|-tr)?\.html$/);
    }
  }
  assert.equal(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).cleanUrls, true);
});
