import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { build } from "esbuild";

type EventDouble = { target: ElementDouble; key: string; defaultPrevented: boolean; preventDefault(): void };
type Listener = (event: EventDouble) => void;

class EventTargetDouble {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
  listenerCount(type: string): number { return this.listeners.get(type)?.size ?? 0; }
}

// Small DOM model for the actual component markup, focus ownership and bubbling.
// No layout or icon hydration is modeled; no browser or network is used.
class ElementDouble extends EventTargetDouble {
  document: DocumentDouble;
  tag: string;
  parent: ElementDouble | null = null;
  children: ElementDouble[] = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  value = "";
  textContent = "";
  tabIndex = -1;
  focusCalls = 0;
  private markup = "";
  private isHidden = false;
  constructor(document: DocumentDouble, tag: string) { super(); this.document = document; this.tag = tag; }
  get id(): string { return this.getAttribute("id") ?? ""; }
  get isConnected(): boolean { return this === this.document.body || !!this.parent?.isConnected; }
  get hidden(): boolean { return this.isHidden; }
  set hidden(value: boolean) {
    this.isHidden = value;
    if (value && this.contains(this.document.activeElement)) this.document.activeElement = this.document.body;
  }
  focus(): void {
    this.focusCalls++;
    for (let node: ElementDouble | null = this; node; node = node.parent) if (node.hidden) return;
    if (this.isConnected && (["button", "input"].includes(this.tag) || this.attributes.has("tabindex"))) {
      this.document.activeElement = this;
    }
  }
  blur(): void { if (this.document.activeElement === this) this.document.activeElement = this.document.body; }
  scrollIntoView(): void {}
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "class") this.classes = new Set(value.split(/\s+/));
    if (name === "tabindex") this.tabIndex = Number(value);
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  append(child: ElementDouble): void { child.parent = this; this.children.push(child); }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
    if (this.contains(this.document.activeElement)) this.document.activeElement = this.document.body;
  }
  contains(node: ElementDouble | null): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }
  matches(selector: string): boolean {
    const id = /^#([\w-]+)/.exec(selector)?.[1];
    const cls = /^\.([\w-]+)/.exec(selector)?.[1];
    const attr = /\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/.exec(selector);
    return (!id || this.id === id) && (!cls || this.classes.has(cls)) &&
      (!attr || (this.attributes.has(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2])));
  }
  closest(selector: string): ElementDouble | null {
    for (let node: ElementDouble | null = this; node; node = node.parent) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector: string): ElementDouble[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string): ElementDouble | null { return this.querySelectorAll(selector)[0] ?? null; }
  get innerHTML(): string { return this.markup; }
  set innerHTML(html: string) {
    for (const child of [...this.children]) child.remove();
    this.markup = html;
    const stack: ElementDouble[] = [this];
    for (const match of html.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)) {
      if (match[1]) { stack.pop(); continue; }
      const child = new ElementDouble(this.document, match[2]);
      for (const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attr[1], attr[2] ?? "");
      stack.at(-1)!.append(child);
      if (!["input", "br", "hr", "img", "meta"].includes(child.tag)) stack.push(child);
    }
  }
  dispatch(type: string, key = ""): EventDouble {
    const event: EventDouble = { target: this, key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    // Snapshot the propagation path before a listener replaces or removes DOM.
    const path: EventTargetDouble[] = [];
    for (let node: ElementDouble | null = this; node; node = node.parent) path.push(node);
    if (this.isConnected) path.push(this.document);
    for (const target of path) for (const listener of [...(target.listeners.get(type) ?? [])]) listener(event);
    return event;
  }
}

class DocumentDouble extends EventTargetDouble {
  body = new ElementDouble(this, "body");
  activeElement = this.body;
  getElementById(id: string): ElementDouble | null { return this.body.querySelector(`#${id}`); }
  querySelectorAll(): ElementDouble[] { return []; } // decorative Lucide icons
}

const bundle = build({
  stdin: {
    contents: `export { renderHourlyStrip } from './src/components/HourlyStrip.ts';
      export { initSearchBar } from './src/components/SearchBar.ts';`,
    resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "esm", target: "node22", logLevel: "silent",
  plugins: [{ name: "hourly-focus-search-data", setup(builder) {
    builder.onResolve({ filter: /\/geocoding$/ }, () => ({ path: "geocoding", namespace: "focus-data" }));
    builder.onLoad({ filter: /.*/, namespace: "focus-data" }, () => ({ contents:
      `export const GEO_PLACE_ID = -1; export const searchCity = (...args) => globalThis.__n05Search(...args);` }));
  }}],
});
let instance = 0;

async function harness(t: TestContext) {
  const document = new DocumentDouble();
  // Same relevant structure as index.html: search, strip and panel are separate.
  document.body.innerHTML = `<section id="searchBar"><input id="citySearch" aria-expanded="false">
    <ul id="searchResults" hidden></ul><button id="geoBtn"></button>
    <span id="searchStatus"></span><button id="searchClear" hidden></button></section>
    <div id="hourlyStrip"></div><div id="hourPanel" tabindex="-1" hidden></div><button id="unrelated"></button>`;
  const node = (id: string) => document.getElementById(id)!;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const setTimer = (callback: () => void, delay = 0) => { timers.set(++timerId, { callback, delay }); return timerId; };
  const clearTimer = (id: number) => { timers.delete(id); };
  const searches: Array<{ query: string; resolve: (places: unknown[]) => void }> = [];
  const selected: unknown[] = [];
  const overrides = {
    document, Element: ElementDouble,
    navigator: { userAgent: "Node", platform: "", maxTouchPoints: 0 },
    window: { setTimeout: setTimer, clearTimeout: clearTimer, matchMedia: () => ({ matches: false }) },
    setTimeout: setTimer, clearTimeout: clearTimer,
    fetch: () => { throw new Error("Unexpected network access in focus test"); },
    __n05Search: (query: string) => new Promise<unknown[]>((resolve) => searches.push({ query, resolve })),
  };
  for (const [key, value] of Object.entries(overrides)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else Reflect.deleteProperty(globalThis, key); });
  }
  const code = (await bundle).outputFiles[0].text + `\n// isolated focus fixture ${++instance}`;
  const { renderHourlyStrip, initSearchBar } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  initSearchBar(node("searchBar"), { onSelect: (place: unknown) => selected.push(place), onGeoStart: () => () => true });
  const forecast = {
    current: { time: "2026-10-13T11:30" }, daily: [],
    hourly: [10, 11, 12].map((hour) => ({ time: `2026-10-13T${hour}:00`, temperature: 15,
      apparentTemperature: 14, weatherCode: 0, precipitationProbability: 0 })),
  };
  return {
    document, node, timers, searches, selected, input: node("citySearch"), list: node("searchResults"),
    panel: node("hourPanel"), strip: node("hourlyStrip"),
    render: (autoOpen = false) => renderHourlyStrip(node("hourlyStrip"), forecast, autoOpen),
    hour: (index: number) => node("hourlyStrip").querySelector(`.hour-cell[data-hour-index="${index}"]`)!,
    escape: () => document.activeElement.dispatch("keydown", "Escape"),
    runTimers: (delay: number) => {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    },
  };
}

test("N05 A: automatically opened hour detail leaves Escape and typed text in search", async (t) => {
  const h = await harness(t);
  h.input.focus();
  h.input.value = "Be";
  h.input.dispatch("input");
  assert.equal(h.render(true), true);
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.hour(1).getAttribute("aria-expanded"), "true");
  h.escape();
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.input.value, "Be");
  assert.equal(h.node("searchStatus").textContent, "");
  assert.equal(h.panel.hidden, false);
});

test("N05 B: SearchBar closes results on Escape without surrendering focus", async (t) => {
  const h = await harness(t);
  h.render(true);
  h.input.focus();
  h.input.value = "Berlin";
  h.input.dispatch("input");
  h.runTimers(500);
  assert.equal(h.searches[0].query, "Berlin");
  h.searches[0].resolve([{ id: 1, name: "Berlin", country: "Deutschland" }]);
  await Promise.resolve();
  assert.equal(h.list.hidden, false);
  assert.equal(h.input.getAttribute("aria-expanded"), "true");
  h.input.dispatch("keydown", "ArrowDown");
  assert.equal(h.input.getAttribute("aria-activedescendant"), "searchOpt0");
  h.escape();
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.list.hidden, true);
  assert.equal(h.list.children.length, 0);
  assert.equal(h.input.getAttribute("aria-expanded"), "false");
  assert.equal(h.input.getAttribute("aria-activedescendant"), null);
  assert.equal(h.input.value, "Berlin");
  assert.equal(h.node("searchStatus").textContent, "");
  assert.equal(h.panel.hidden, false);
  assert.deepEqual(h.selected, []);
});

test("N05 B: Escape still invalidates pending search responses", async (t) => {
  const h = await harness(t);
  h.render(true);
  h.input.focus();
  h.input.value = "Berlin";
  h.input.dispatch("input");
  h.runTimers(500);
  assert.equal(h.input.getAttribute("aria-busy"), "true");
  h.escape();
  h.searches[0].resolve([{ id: 1, name: "Berlin" }]);
  await Promise.resolve();
  assert.equal(h.document.activeElement, h.input);
  assert.equal(h.list.hidden, true);
  assert.equal(h.input.getAttribute("aria-busy"), null);
  assert.equal(h.panel.hidden, false);
  assert.deepEqual(h.selected, []);
});

for (const focus of ["panel", "descendant"] as const) {
  test(`N05 C: Escape in ${focus} closes detail and returns focus to its hour`, async (t) => {
    const h = await harness(t);
    h.render();
    h.hour(2).dispatch("click");
    assert.equal(h.document.activeElement, h.panel);
    if (focus === "descendant") h.panel.querySelector(".hour-panel-close")!.focus();
    h.runTimers(0);
    assert.equal(h.document.listenerCount("click"), 2); // search + open hour detail
    h.escape();
    assert.equal(h.panel.hidden, true);
    assert.equal(h.panel.children.length, 0);
    assert.equal(h.document.activeElement, h.hour(2));
    assert.equal(h.hour(2).getAttribute("aria-expanded"), "false");
    assert.equal(h.hour(2).classList.contains("hour-cell--active"), false);
    assert.equal(h.document.listenerCount("click"), 1);
  });
}

test("N05 D: Escape on the owning hour button closes its detail", async (t) => {
  const h = await harness(t);
  h.render(true);
  h.hour(1).focus();
  h.escape();
  assert.equal(h.panel.hidden, true);
  assert.equal(h.document.activeElement, h.hour(1));
  assert.equal(h.hour(1).getAttribute("aria-expanded"), "false");
  assert.equal(h.timers.size, 0);
});

for (const focus of ["unrelated button", "other hour button"] as const) {
  test(`N05 E: Escape on ${focus} preserves independent focus and open detail`, async (t) => {
    const h = await harness(t);
    h.render(true);
    const target = focus === "unrelated button" ? h.node("unrelated") : h.hour(0);
    target.focus();
    h.escape();
    assert.equal(h.document.activeElement, target);
    assert.equal(h.panel.hidden, false);
    assert.equal(h.hour(1).getAttribute("aria-expanded"), "true");
  });
}

test("N05 F: Escape on a closed detail has no further focus action", async (t) => {
  const h = await harness(t);
  h.render();
  h.hour(1).focus();
  h.escape();
  assert.equal(h.panel.hidden, true);
  assert.equal(h.document.activeElement, h.hour(1));
  assert.equal(h.hour(1).focusCalls, 1);
  h.hour(1).dispatch("click");
  h.escape();
  const calls = h.hour(1).focusCalls;
  h.escape();
  assert.equal(h.hour(1).focusCalls, calls);
  assert.equal(h.document.activeElement, h.hour(1));
  assert.equal(h.panel.hidden, true);
});

test("N05 G: repeated render and open/close keep one handler and clean pending listeners", async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 4; i++) {
    h.render();
    assert.equal(h.document.listenerCount("keydown"), 1);
    assert.equal(h.strip.listenerCount("keydown"), 1);
    assert.equal(h.strip.listenerCount("click"), 1);
    const owner = h.hour(i % 3);
    owner.dispatch("click");
    assert.equal(h.document.activeElement, h.panel);
    assert.equal(h.panel.hidden, false);
    assert.equal(h.timers.size, 1);
    if (i % 2) h.runTimers(0);
    h.escape();
    h.runTimers(0);
    assert.equal(h.panel.hidden, true);
    assert.equal(h.document.activeElement, owner);
    assert.equal(owner.focusCalls, 1);
    assert.equal(h.document.listenerCount("click"), 1);
    assert.equal(h.timers.size, 0);
  }
});

test("N05: removed owning button is never focused when Escape closes its detail", async (t) => {
  const h = await harness(t);
  h.render();
  const owner = h.hour(1);
  owner.dispatch("click");
  h.panel.querySelector(".hour-panel-close")!.focus();
  owner.remove();
  h.escape();
  assert.equal(h.panel.hidden, true);
  assert.equal(h.document.activeElement, h.document.body);
  assert.equal(owner.focusCalls, 0);
});

test("N05: detached hour DOM cannot take focus from a remaining control", async (t) => {
  const h = await harness(t);
  h.render();
  h.hour(1).dispatch("click");
  h.strip.remove();
  h.panel.remove();
  h.node("unrelated").focus();
  h.escape();
  h.runTimers(0);
  assert.equal(h.document.activeElement, h.node("unrelated"));
  assert.equal(h.panel.hidden, false);
  assert.equal(h.document.listenerCount("keydown"), 1);
});
