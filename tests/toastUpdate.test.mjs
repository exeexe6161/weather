import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showToast } from '../src/lib/toast.ts';

test('persistent reload action returns after another toast and runs once', () => {
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 1;
  class Element {
    constructor() {
      this.children = [];
      this.events = new Map();
      this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => this.classes.add(name)),
        remove: (...names) => names.forEach((name) => this.classes.delete(name)),
        toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
        contains: (name) => this.classes.has(name),
      };
    }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text; }
    get offsetWidth() { return 1; }
    appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); }
    setAttribute() {}
    removeAttribute() {}
    addEventListener(type, callback) { this.events.set(type, callback); }
    querySelector(selector) { return selector === '.wp-toast-undo' ? this.children.find((child) => child.className === 'wp-toast-undo') : undefined; }
    remove() { this.removed = true; }
    click() { this.events.get('click')?.(); }
  }
  const body = new Element();
  globalThis.document = {
    body,
    createElement: () => new Element(),
    getElementById: (id) => elements.get(id) ?? null,
  };
  globalThis.setTimeout = (callback) => {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  try {
    let reloads = 0;
    showToast('New version available', { label: 'Reload', persistent: true, onAction: () => { reloads++; } });
    assert.equal(timers.size, 0);
    showToast('Temporary feedback');
    assert.equal(timers.size, 1);
    const [timerId, expire] = [...timers.entries()][0];
    timers.delete(timerId);
    expire();
    const toast = elements.get('wpToast');
    assert.equal(toast.children[0].textContent, 'New version available');
    const button = toast.querySelector('.wp-toast-undo');
    assert.equal(button.textContent, 'Reload');
    button.click();
    button.click();
    assert.equal(reloads, 1);
  } finally {
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
