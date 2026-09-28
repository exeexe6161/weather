import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

type Place = { id: number; name: string };
const A = { id: 1, name: "A" };
const B = { id: 2, name: "B" };
const C = { id: 3, name: "C" };

class ElementDouble {
  readonly document: DocumentDouble;
  hidden = false;
  disabled = false;
  textContent = "";
  dataset: Record<string, string> = {};
  parent: ElementDouble | null = null;
  children: ElementDouble[] = [];
  classes = new Set<string>();
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  constructor(document: DocumentDouble) { this.document = document; }
  get isConnected(): boolean { return this === this.document.body || !!this.parent?.isConnected; }
  get offsetWidth(): number { return 0; }
  focus(): void { if (this.isConnected && !this.disabled) this.document.activeElement = this; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  addEventListener(name: string, fn: () => void): void { this.listeners.set(name, fn); }
  click(): void { if (!this.disabled) this.listeners.get("click")?.(); }
  contains(child: ElementDouble): boolean { return child === this || this.children.some((node) => node.contains(child)); }
  closest(selector: string): ElementDouble | null {
    if (selector === ".fav-row") {
      for (let node: ElementDouble | null = this; node; node = node.parent) {
        if (node.classes.has("fav-row")) return node;
      }
    }
    return null;
  }
  querySelector(selector: string): ElementDouble | null {
    const cls = selector.slice(1);
    return this.children.find((node) => node.classes.has(cls)) ?? null;
  }
  replace(children: ElementDouble[]): void {
    for (const child of this.children) child.parent = null;
    this.children = children;
    for (const child of children) child.parent = this;
    if (!this.contains(this.document.activeElement)) {
      if (!this.document.activeElement.isConnected) this.document.activeElement = this.document.body;
    }
  }
}

class DocumentDouble {
  body = new ElementDouble(this);
  activeElement = this.body;
  title = "";
  nodes = new Map<string, ElementDouble>();
  missingIds = new Set<string>();
  constructor() { this.body.parent = this.body; }
  getElementById(id: string): ElementDouble {
    if (this.missingIds.has(id)) return null as unknown as ElementDouble;
    if (!this.nodes.has(id)) {
      const node = new ElementDouble(this);
      node.parent = this.body;
      this.nodes.set(id, node);
    }
    return this.nodes.get(id)!;
  }
  querySelector(selector: string): ElementDouble | null {
    const match = /^#favoritesList \.fav-row\[data-id="(\d+)"\]$/.exec(selector);
    return match ? this.getElementById("favoritesList").children.find((row) => row.dataset.id === match[1]) ?? null : null;
  }
}

let bundleNumber = 0;
async function loadApp(): Promise<any> {
  const entry = resolve("src/app.ts");
  const source = readFileSync(entry, "utf8");
  const imports = new Map<string, string[]>();
  for (const match of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";/gm)) {
    imports.set(match[2], match[1].split(",").map((part) => part.trim())
      .filter((part) => !part.startsWith("type ")).map((part) => part.split(" as ")[0]));
  }
  const result = await build({
    stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", target: "node22", logLevel: "silent",
    plugins: [{ name: "favorites-focus-imports", setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, (args) => args.path === entry
        ? { contents: `${source}\nexport { paintFavorites, renderContent, state };`, loader: "ts" } : undefined);
      builder.onResolve({ filter: /^\./ }, (args) => args.importer === entry
        ? { path: args.path, namespace: "focus-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "focus-mock" }, (args) => {
        const constants: Record<string, string> = {
          GEO_PLACE_ID: "-1", MAX_FAVORITES: "5", POLLEN_LOADING: '{ status: "loading" }',
        };
        return { loader: "js", contents: (imports.get(args.path) ?? []).map((name) =>
          `export const ${name} = ${constants[name] ?? `(...args) => globalThis.__wpFocusMocks.${name}(...args)`};`).join("\n") };
      });
    }}],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n// ${++bundleNumber}`).toString("base64")}`);
}

async function harness(initial: Place[], current = A) {
  const document = new DocumentDouble();
  (globalThis as any).document = document;
  let favorites = [...initial];
  let failWrite = false;
  let failUndo = false;
  let undoAction: (() => void) | undefined;
  let toastText = "";
  const makeButton = (row: ElementDouble, cls: string, onClick: () => void, disabled = false) => {
    const button = new ElementDouble(document);
    button.classes.add(cls);
    button.disabled = disabled;
    button.parent = row;
    button.addEventListener("click", onClick);
    row.children.push(button);
    return button;
  };
  const mocks: Record<string, (...args: any[]) => any> = {
    byId: (id: string) => document.getElementById(id),
    getFavorites: () => [...favorites],
    readFavoritesForMutation: () => [...favorites],
    isFavorite: (id: number) => favorites.some((p) => p.id === id),
    addFavorite: (place: Place) => failWrite ? null : (favorites = [...favorites, place]),
    removeFavorite: (id: number) => failWrite ? null : (favorites = favorites.filter((p) => p.id !== id)),
    insertFavorite: (place: Place, index: number) => {
      if (failUndo) return null;
      favorites.splice(index, 0, place);
      return [...favorites];
    },
    moveFavorite: (id: number, dir: "up" | "down") => {
      const index = favorites.findIndex((p) => p.id === id);
      const next = index + (dir === "up" ? -1 : 1);
      if (next < 0 || next >= favorites.length) return null;
      [favorites[index], favorites[next]] = [favorites[next], favorites[index]];
      return [...favorites];
    },
    readFavWeatherCache: () => new Map(),
    nextFavWeatherExpiry: () => null,
    refreshFavoritesWeather: () => new Promise(() => {}),
    mirrorForNewFavorite: () => ({ entry: null, needsFetch: false }),
    renderFavoritesList: (list: ElementDouble, places: Place[], _id: number, opts: any) => {
      document.getElementById("favoritesSection").hidden = places.length === 0;
      const rows = places.map((place, index) => {
        const row = new ElementDouble(document);
        row.classes.add("fav-row");
        row.dataset.id = String(place.id);
        makeButton(row, "fav-row-select", () => opts.onSelect(place));
        if (places.length > 1) {
          makeButton(row, "fav-row-up", () => opts.onMove(place, "up"), index === 0);
          makeButton(row, "fav-row-down", () => opts.onMove(place, "down"), index === places.length - 1);
        }
        makeButton(row, "fav-row-x", () => opts.onRemove(place));
        return row;
      });
      list.replace(rows);
    },
    renderCurrentWeather: (card: ElementDouble, props: any) => {
      const star = new ElementDouble(document);
      star.parent = card;
      star.setAttribute("aria-pressed", String(props.isFav));
      card.replace([star]);
      document.nodes.set("favToggle", star);
    },
    showToast: (message: string, options?: { onAction: () => void }) => {
      toastText = message;
      if (options) undoAction = options.onAction;
    },
    getLang: () => "de", getLocale: () => "de", t: (key: string) => key,
    getWmo: () => ({ labelKey: "clear" }),
    weatherLabel: () => "clear", weatherLabelShort: () => "clear",
    formatTemp: (value: number) => String(value),
    formatStampInZone: () => null, formatHour: () => "now",
    forecastStartHour: () => 0, bestWeatherDayKey: () => null,
  };
  (globalThis as any).__wpFocusMocks = new Proxy(mocks, {
    get(target, name: string) { return target[name] ?? (() => undefined); },
  });
  const app = await loadApp();
  app.state.place = current;
  app.state.forecast = { current: { temperature: 20, weatherCode: 0 }, hourly: [], daily: [], timezone: "UTC", airQuality: null, alerts: [] };
  app.state.updatedAt = "";
  app.paintFavorites();
  app.renderContent();
  const button = (id: number, cls: string) => {
    const row = document.querySelector(`#favoritesList .fav-row[data-id="${id}"]`);
    return row?.querySelector(`.${cls}`) ?? null;
  };
  return {
    app, document, button,
    star: () => document.getElementById("favToggle"),
    favorites: () => [...favorites],
    failWrites: () => { failWrite = true; },
    failRestores: () => { failUndo = true; },
    toast: () => toastText,
    undo: () => {
      const inert = new ElementDouble(document);
      inert.parent = document.body;
      inert.focus();
      inert.disabled = true;
      undoAction?.();
      return inert;
    },
  };
}

test("A and B: adding and removing on the main card focus the new star with the new pressed state", async () => {
  const h = await harness([]);
  const original = h.star();
  original.focus();
  original.click();
  assert.notEqual(h.star(), original);
  assert.equal(h.document.activeElement, h.star());
  assert.equal(h.star().getAttribute("aria-pressed"), "true");
  const added = h.star();
  added.click();
  assert.notEqual(h.star(), added);
  assert.equal(h.document.activeElement, h.star());
  assert.equal(h.star().getAttribute("aria-pressed"), "false");
});

for (const [label, target, expected] of [
  ["C middle", B.id, C.id], ["D last", C.id, B.id], ["E first", A.id, B.id],
] as const) {
  test(`${label}: removal focuses the primary button of the neighboring place`, async () => {
    const h = await harness([A, B, C]);
    const remove = h.button(target, "fav-row-x")!;
    remove.focus();
    remove.click();
    assert.equal(h.document.activeElement, h.button(expected, "fav-row-select"));
    assert.notEqual(h.document.activeElement, h.button(expected, "fav-row-x"));
  });
}

test("F: removing the only favorite focuses search and hides the list section", async () => {
  const h = await harness([A]);
  h.button(A.id, "fav-row-x")!.click();
  assert.deepEqual(h.favorites(), []);
  assert.equal(h.document.getElementById("favoritesSection").hidden, true);
  assert.equal(h.document.activeElement, h.document.getElementById("citySearch"));
});

test("F fallback: a missing search field does not interrupt successful removal", async () => {
  const h = await harness([A]);
  h.document.missingIds.add("citySearch");
  assert.doesNotThrow(() => h.button(A.id, "fav-row-x")!.click());
  assert.deepEqual(h.favorites(), []);
});

test("G: failed star and list writes keep the original focused button", async () => {
  const h = await harness([B]);
  h.failWrites();
  const star = h.star();
  star.focus();
  star.click();
  assert.equal(h.document.activeElement, star);
  assert.equal(h.star(), star);
  assert.equal(h.toast(), "favSaveFailed");
  const remove = h.button(B.id, "fav-row-x")!;
  remove.focus();
  remove.click();
  assert.equal(h.document.activeElement, remove);
  assert.equal(h.button(B.id, "fav-row-x"), remove);
});

test("H: moving at both edges keeps the moved place on an enabled arrow", async () => {
  const h = await harness([A, B, C]);
  h.button(B.id, "fav-row-up")!.click();
  assert.equal(h.document.activeElement, h.button(B.id, "fav-row-down"));
  h.button(B.id, "fav-row-down")!.click();
  assert.equal(h.document.activeElement, h.button(B.id, "fav-row-down"));
  h.button(B.id, "fav-row-down")!.click();
  assert.equal(h.document.activeElement, h.button(B.id, "fav-row-up"));
  assert.deepEqual(h.favorites().map((p) => p.id), [A.id, C.id, B.id]);
});

test("I: successful Undo focuses the restored place, not the consumed action", async () => {
  const h = await harness([A, B, C]);
  h.button(B.id, "fav-row-x")!.click();
  const inert = h.undo();
  assert.equal(h.document.activeElement, h.button(B.id, "fav-row-select"));
  assert.notEqual(h.document.activeElement, inert);
});

for (const places of [[A, B], [A]]) {
  test(`J: failed Undo focuses ${places.length > 1 ? "remaining favorite" : "search"}`, async () => {
    const h = await harness(places);
    h.button(A.id, "fav-row-x")!.click();
    h.failRestores();
    const inert = h.undo();
    const expected = places.length > 1 ? h.button(B.id, "fav-row-select") : h.document.getElementById("citySearch");
    assert.equal(h.document.activeElement, expected);
    assert.notEqual(h.document.activeElement, inert);
    assert.equal(h.toast(), "favSaveFailed");
  });
}
