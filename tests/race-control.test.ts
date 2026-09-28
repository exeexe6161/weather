import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

type Resolver<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: Error): void };
function deferred<T>(): Resolver<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class ElementDouble {
  hidden = false;
  disabled = false;
  value = "";
  textContent = "";
  innerHTML = "";
  id = "";
  type = "";
  className = "";
  dataset: Record<string, string> = {};
  children: ElementDouble[] = [];
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  private listeners = new Map<string, Array<(event: any) => void>>();
  addEventListener(name: string, listener: (event: any) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  dispatch(name: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(name) ?? []) listener({ target: this, preventDefault() {}, ...event });
  }
  click(): void { this.dispatch("click"); }
  appendChild(child: ElementDouble): void { this.children.push(child); }
  contains(child: unknown): boolean { return child === this || this.children.some((item) => item.contains(child)); }
  setAttribute(_name: string, _value: string): void {}
  removeAttribute(_name: string): void {}
  querySelectorAll(): ElementDouble[] { return []; }
  focus(): void {}
  blur(): void {}
  scrollIntoView(): void {}
  get offsetWidth(): number { return 0; }
}

let bundleNumber = 0;
async function loadWithMockedImports(entry: string, extraExports = ""): Promise<any> {
  const source = readFileSync(entry, "utf8");
  const imports = new Map<string, string[]>();
  for (const match of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";/gm)) {
    imports.set(match[2], match[1].split(",").map((part) => part.trim())
      .filter((part) => !part.startsWith("type "))
      .map((part) => part.split(" as ")[0]));
  }
  const result = await build({
    stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
    plugins: [{
      name: "race-test-imports",
      setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, (args) => args.path === entry
          ? { contents: `${source}\n${extraExports}`, loader: "ts" }
          : undefined);
        builder.onResolve({ filter: /^\./ }, (args) => args.importer === entry
          ? { path: args.path, namespace: "race-test-mock" }
          : undefined);
        builder.onLoad({ filter: /.*/, namespace: "race-test-mock" }, (args) => {
          const names = imports.get(args.path) ?? [];
          const constants: Record<string, string> = {
            GEO_PLACE_ID: "-1", MAX_FAVORITES: "5", POLLEN_LOADING: '{ status: "loading" }',
          };
          return {
            loader: "js",
            contents: names.map((name) => `export const ${name} = ${constants[name] ?? `(...args) => globalThis.__wpRaceMocks.${name}(...args)`};`).join("\n"),
          };
        });
      },
    }],
  });
  const code = result.outputFiles[0].text + `\n// isolated test bundle ${++bundleNumber}`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function installDom(): { elements: Map<string, ElementDouble>; location: URL; document: any } {
  const elements = new Map<string, ElementDouble>();
  const get = (id: string): ElementDouble => {
    if (!elements.has(id)) elements.set(id, new ElementDouble());
    return elements.get(id)!;
  };
  const body = new ElementDouble();
  const location = new URL("https://weatherpure.test/");
  const documentListeners = new Map<string, Array<() => void>>();
  const document = {
    body,
    hidden: false,
    activeElement: body,
    title: "WeatherPure",
    getElementById: get,
    createElement: () => new ElementDouble(),
    querySelector: () => null,
    addEventListener: (name: string, listener: () => void) => {
      documentListeners.set(name, [...(documentListeners.get(name) ?? []), listener]);
    },
    dispatch: (name: string) => { for (const listener of documentListeners.get(name) ?? []) listener(); },
  };
  const stored = new Map<string, string>();
  Object.assign(globalThis, {
    document,
    location,
    window: { matchMedia: () => ({ matches: false }) },
    history: { state: null, replaceState(_state: unknown, _title: string, url: URL) {
      location.href = String(url);
    } },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true, userAgent: "Node", platform: "Node", maxTouchPoints: 0 },
    configurable: true,
  });
  return { elements, location, document };
}

const A = { id: 1, name: "Altstadt", latitude: 1, longitude: 1, country: "DE", countryCode: "DE" };
const B = { id: 2, name: "Neustadt", latitude: 2, longitude: 2, country: "DE", countryCode: "DE" };
const forecast = (temperature: number) => ({
  current: { temperature, weatherCode: 0 }, hourly: [], daily: [], timezone: "UTC", airQuality: null, alerts: [],
});
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function appHarness() {
  const dom = installDom();
  const searches: Array<{ query: string; reply: Resolver<any[]> }> = [];
  const weathers: Array<Resolver<any>> = [];
  const pollens: Array<Resolver<any>> = [];
  let searchOptions: any;
  const functions: Record<string, (...args: any[]) => any> = {
    byId: (id: string) => dom.document.getElementById(id),
    searchCity: (query: string) => {
      const reply = deferred<any[]>();
      searches.push({ query, reply });
      return reply.promise;
    },
    fetchWeather: () => { const reply = deferred<any>(); weathers.push(reply); return reply.promise; },
    fetchPollen: () => { const reply = deferred<any>(); pollens.push(reply); return reply.promise; },
    initSearchBar: (_root: unknown, options: any) => { searchOptions = options; },
    getFavorites: () => [],
    readFavoritesForMutation: () => [],
    readFavWeatherCache: () => new Map(),
    getRecentForecast: () => null,
    isForecastForCurrentLocalDay: () => true,
    isForecastEntryTooOld: () => false,
    formatObservationStampInZone: () => null,
    nextFavWeatherExpiry: () => null,
    bestWeatherDayKey: () => null,
    readPlaceLink: () => ({ kind: "none" }),
    getLang: () => "de",
    getLocale: () => "de",
    t: (key: string) => key,
    getWmo: () => ({ labelKey: "clear" }),
    formatTemp: (value: number) => String(value),
    formatStampInZone: () => null,
    formatHour: () => "now",
    forecastStartHour: () => 0,
    isFavorite: () => false,
    placeLinkUrl: (base: string, place: typeof A) => {
      const url = new URL(base);
      url.searchParams.set("stadt", place.name);
      return url;
    },
    decideLinkResolution: (places: any[]) => places.length ? { kind: "exact", place: places[0] } : { kind: "none" },
    decideProviderLinkResolution: (places: any[]) => places.length ? { kind: "exact", place: places[0] } : { kind: "none" },
    classifyLoadError: () => "network",
    failTitleKey: () => "loadError",
  };
  (globalThis as any).__wpRaceMocks = new Proxy(functions, {
    get(target, name: string) { return target[name] ?? (() => undefined); },
  });
  const module = await loadWithMockedImports(resolve("src/app.ts"),
    "export const raceProbe = { resolveCityLink, refreshCurrentPlace, getState: () => state }; ");
  module.initApp();
  return { ...dom, module, mocks: functions, searches, weathers, pollens, get searchOptions() { return searchOptions; } };
}

test("tab return after local midnight rechecks once and uses the existing load guard", async () => {
  const oldNow = Date.now;
  let now = Date.parse("2099-07-15T14:40:00Z");
  Date.now = () => now;
  try {
    const h = await appHarness();
    const midnight = Date.parse("2099-07-15T15:00:00Z");
    h.mocks.isForecastForCurrentLocalDay = () => Date.now() < midnight;
    h.module.selectPlace(A);
    h.weathers[0].resolve(forecast(11));
    await flush();
    h.document.dispatch("visibilitychange");
    assert.equal(h.weathers.length, 1);
    now = Date.parse("2099-07-15T15:10:00Z");
    let staleCard = false;
    let staleDaily = false;
    h.mocks.renderCurrentWeather = (_el: unknown, props: { calendarStale: boolean }) => { staleCard = props.calendarStale; };
    h.mocks.renderDailyForecast = (_el: unknown, _days: unknown, _count: unknown, calendarStale: boolean) => { staleDaily = calendarStale; };
    h.document.dispatch("visibilitychange");
    assert.equal(h.module.raceProbe.getState().freshness, "stale");
    assert.equal(h.weathers.length, 2);
    assert.equal(staleCard, true);
    assert.equal(staleDaily, true);
    for (const id of ["todayHighlightsHeading", "hourlyHeading", "hourlyHint", "hourlyWrap", "tempCurveHeading", "rainChartHeading", "weekSummary", "dressTodayHeading"]) {
      assert.equal(h.elements.get(id)?.hidden, true, id);
    }
    h.document.dispatch("visibilitychange");
    assert.equal(h.weathers.length, 2);
    h.module.selectPlace(B);
    h.weathers[1].resolve(forecast(12));
    await flush();
    assert.equal(h.module.raceProbe.getState().place.id, B.id);
  } finally {
    Date.now = oldNow;
  }
});

test("expired tab return keeps the previous 60 minute offline boundary", async () => {
  const h = await appHarness();
  h.module.selectPlace(A);
  h.weathers[0].resolve(forecast(11));
  await flush();
  h.mocks.isForecastForCurrentLocalDay = () => false;
  h.mocks.isForecastEntryTooOld = () => true;
  h.document.dispatch("visibilitychange");
  assert.equal(h.weathers.length, 2);
  assert.equal(h.module.raceProbe.getState().forecast, null);
  assert.equal(h.elements.get("weatherContent")?.hidden, true);
  h.weathers[1].reject(new Error("offline"));
  await flush();
  assert.equal(h.elements.get("weatherError")?.hidden, false);
});

test("a missing place cache never reuses another place's forecast on failure", async () => {
  const h = await appHarness();
  h.module.selectPlace(A);
  h.weathers[0].resolve(forecast(11));
  await flush();
  h.module.selectPlace(B);
  assert.equal(h.module.raceProbe.getState().forecast, null);
  h.weathers[1].reject(new Error("offline"));
  await flush();
  assert.equal(h.elements.get("weatherError")?.hidden, false);
  assert.equal(h.module.raceProbe.getState().place.id, B.id);
});

test("old link success and failure cannot replace a newer manual place or URL", async () => {
  for (const fail of [false, true]) {
    const h = await appHarness();
    h.module.raceProbe.resolveCityLink({ kind: "legacy", name: A.name });
    h.module.selectPlace(B);
    h.weathers[0].resolve(forecast(22));
    await flush();
    if (fail) h.searches[0].reply.reject(new Error("old link failed"));
    else h.searches[0].reply.resolve([A]);
    await flush();
    assert.equal(h.module.raceProbe.getState().place.id, B.id);
    assert.equal(h.module.raceProbe.getState().forecast.current.temperature, 22);
    assert.equal(h.location.searchParams.get("stadt"), B.name);
    assert.equal(h.elements.get("weatherContent")?.hidden, false);
    assert.equal(h.weathers.length, 1);
  }
});

test("old quick city success and failure cannot change a newer place", async () => {
  for (const fail of [false, true]) {
    const h = await appHarness();
    h.elements.get("emptyCities")!.children[0].click();
    h.module.selectPlace(B);
    h.weathers[0].resolve(forecast(22));
    await flush();
    if (fail) h.searches[0].reply.reject(new Error("old quick city failed"));
    else h.searches[0].reply.resolve([A]);
    await flush();
    assert.equal(h.module.raceProbe.getState().place.id, B.id);
    assert.equal(h.elements.get("weatherContent")?.hidden, false);
    assert.equal(h.location.searchParams.get("stadt"), B.name);
  }
});

test("geolocation intent expires when a manual place is selected", async () => {
  const h = await appHarness();
  const stillCurrent = h.searchOptions.onGeoStart();
  h.module.selectPlace(B);
  assert.equal(stillCurrent(), false);
  h.searchOptions.onSelect(B);
  assert.equal(h.module.raceProbe.getState().place.id, B.id);
});

test("old refresh finalization does not enable the button during a newer place load", async () => {
  const h = await appHarness();
  h.module.selectPlace(A);
  h.weathers[0].resolve(forecast(11));
  await flush();
  h.module.raceProbe.refreshCurrentPlace();
  h.module.selectPlace(B);
  assert.equal(h.elements.get("topRefresh")?.disabled, true);
  h.weathers[1].resolve(forecast(12));
  await flush();
  assert.equal(h.elements.get("topRefresh")?.disabled, true);
  h.weathers[2].resolve(forecast(22));
  await flush();
  assert.equal(h.elements.get("topRefresh")?.disabled, false);
  assert.equal(h.module.raceProbe.getState().forecast.current.temperature, 22);
});

test("late pollen from the same Place object cannot replace the newer load", async () => {
  const h = await appHarness();
  h.module.selectPlace(A);
  h.module.selectPlace(A);
  h.pollens[1].resolve({ status: "ok", levels: { grass: 2 } });
  await flush();
  h.pollens[0].resolve({ status: "failed" });
  await flush();
  assert.deepEqual(h.module.raceProbe.getState().pollen, { status: "ok", levels: { grass: 2 } });
});

async function searchHarness() {
  const dom = installDom();
  const root = new ElementDouble();
  const input = new ElementDouble();
  const list = new ElementDouble();
  const geo = new ElementDouble();
  const status = new ElementDouble();
  const clear = new ElementDouble();
  list.hidden = true;
  const fields: Record<string, ElementDouble> = {
    "#citySearch": input, "#searchResults": list, "#geoBtn": geo,
    "#searchStatus": status, "#searchClear": clear,
  };
  (root as any).querySelector = (selector: string) => fields[selector];
  root.children = Object.values(fields);
  const searches: Array<Resolver<any[]>> = [];
  const selected: any[] = [];
  let selectionIntent = 0;
  let geoSuccess: ((position: any) => void) | undefined;
  let geoFailure: ((error: any) => void) | undefined;
  (globalThis as any).navigator.geolocation = {
    getCurrentPosition(success: (position: any) => void, failure: (error: any) => void) {
      geoSuccess = success;
      geoFailure = failure;
    },
  };
  const documentClicks: Array<(event: any) => void> = [];
  dom.document.addEventListener = (name: string, listener: (event: any) => void) => {
    if (name === "click") documentClicks.push(listener);
  };
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: () => void) => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof clearTimeout;
  const mocks: Record<string, (...args: any[]) => any> = {
    searchCity: () => { const reply = deferred<any[]>(); searches.push(reply); return reply.promise; },
    searchStatusKey: (outcome: { kind: string }) => outcome.kind,
    shouldSearch: (length: number) => length >= 2,
    t: (key: string) => key,
    getLang: () => "de",
    esc: (value: string) => value,
  };
  (globalThis as any).__wpRaceMocks = new Proxy(mocks, {
    get(target, name: string) { return target[name] ?? (() => undefined); },
  });
  const module = await loadWithMockedImports(resolve("src/components/SearchBar.ts"));
  module.initSearchBar(root, {
    onSelect(place: any) { selected.push(place); selectionIntent++; },
    onGeoStart() { const own = ++selectionIntent; return () => own === selectionIntent; },
  });
  return {
    module, input, list, geo, status, searches, selected, documentClicks,
    fireDebounce() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    change(value: string) { input.value = value; input.dispatch("input"); },
    invalidateGeo() { selectionIntent++; },
    geoSuccess(position: any) { geoSuccess?.(position); },
    geoFailure(error: any) { geoFailure?.(error); },
    restore() { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; },
  };
}

test("new typing invalidates old search before debounce and prevents stale Enter", async () => {
  const h = await searchHarness();
  try {
    h.change("Altstadt");
    h.fireDebounce();
    h.change("Neustadt");
    h.searches[0].resolve([A]);
    await flush();
    assert.equal(h.list.hidden, true);
    h.input.dispatch("keydown", { key: "Enter" });
    assert.equal(h.selected.length, 0);
    h.searches[1].resolve([B]);
    await flush();
    assert.deepEqual(h.selected, [B]);
  } finally { h.restore(); }
});

test("repeated identical query and old error cannot replace newer search results", async () => {
  const h = await searchHarness();
  try {
    h.change("Berlin");
    h.fireDebounce();
    h.change("Zwischenstand");
    h.change("Berlin");
    h.fireDebounce();
    h.searches[1].resolve([B]);
    await flush();
    h.searches[0].resolve([A]);
    await flush();
    assert.ok(h.list.innerHTML.includes(B.name));
    assert.ok(!h.list.innerHTML.includes(A.name));

    h.change("Altstadt");
    h.fireDebounce();
    h.change("Neustadt");
    h.fireDebounce();
    h.searches[3].resolve([B]);
    await flush();
    h.searches[2].reject(new Error("old search failed"));
    await flush();
    assert.ok(h.list.innerHTML.includes(B.name));
    assert.equal(h.list.hidden, false);
  } finally { h.restore(); }
});

test("selecting a result invalidates a pending response for the same query", async () => {
  const h = await searchHarness();
  try {
    h.change("Berlin");
    h.fireDebounce();
    h.input.dispatch("keydown", { key: "Enter" });
    h.searches[1].resolve([B]);
    await flush();
    h.searches[0].resolve([A]);
    await flush();
    assert.deepEqual(h.selected, [B]);
    assert.equal(h.list.hidden, true);
  } finally { h.restore(); }
});

test("closed search and stale geolocation callbacks cannot commit", async () => {
  const h = await searchHarness();
  try {
    h.change("Altstadt");
    h.fireDebounce();
    h.input.dispatch("keydown", { key: "Escape" });
    h.searches[0].resolve([A]);
    await flush();
    assert.equal(h.list.hidden, true);
    h.change("Altstadt");
    h.fireDebounce();
    h.documentClicks[0]({ target: {} });
    h.searches[1].resolve([A]);
    await flush();
    assert.equal(h.list.hidden, true);

    h.geo.click();
    h.invalidateGeo();
    h.geoSuccess({ coords: { latitude: 3, longitude: 3 } });
    assert.equal(h.selected.length, 0);
    h.geo.click();
    h.invalidateGeo();
    h.geoFailure({ code: 1, PERMISSION_DENIED: 1 });
    assert.equal(h.status.textContent, "");
  } finally { h.restore(); }
});
