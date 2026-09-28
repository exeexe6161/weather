import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://weatherpure.test';
const html = (body) => new Response(body, { headers: { 'Content-Type': 'text/html' } });
const asset = (body, headers = {}) => new Response(body, { headers });

function createWorker(fetchResponse = async () => html('network')) {
  const cacheData = new Map();
  const cacheCalls = [];
  const listeners = new Map();
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const request = (path, options = {}) => ({
    url: key(path),
    method: options.method ?? 'GET',
    mode: options.mode ?? 'same-origin',
    cache: options.cache ?? 'default',
    headers: new Headers(options.headers),
  });
  class TestRequest {
    constructor(path, options = {}) { Object.assign(this, request(path, options)); }
  }
  const caches = {
    async open(name) {
      cacheCalls.push(['open', name]);
      if (!cacheData.has(name)) cacheData.set(name, new Map());
      const entries = cacheData.get(name);
      return {
        async match(input) {
          cacheCalls.push(['match', name, key(input)]);
          return entries.get(key(input))?.clone();
        },
        async put(input, response) {
          cacheCalls.push(['put', name, key(input)]);
          entries.set(key(input), response.clone());
        },
        async addAll(requests) {
          const responses = await Promise.all(requests.map((input) => fetchResponse(input)));
          if (responses.some((response) => !response?.ok)) throw new Error('core asset unavailable');
          for (let i = 0; i < requests.length; i++) entries.set(key(requests[i]), responses[i].clone());
        },
      };
    },
    async keys() { return [...cacheData.keys()]; },
    async delete(name) { return cacheData.delete(name); },
  };
  const self = {
    location: { origin },
    addEventListener(type, listener) { listeners.set(type, listener); },
    async skipWaiting() { skipWaitingCalls++; },
    clients: { async claim() { claimCalls++; } },
  };
  const context = vm.createContext({ self, caches, Request: TestRequest, Response, URL, fetch: (input) => fetchResponse(input) });
  vm.runInContext(source, context);
  const staticName = vm.runInContext('STATIC_CACHE', context);
  const runtimeName = vm.runInContext('RUNTIME_CACHE', context);
  async function dispatch(type, event = {}) {
    let completion;
    let response;
    listeners.get(type)({
      ...event,
      waitUntil(promise) { completion = promise; },
      respondWith(promise) { response = promise; },
    });
    if (completion) await completion;
    return response ? await response : undefined;
  }
  return {
    caches, cacheData, cacheCalls, request, dispatch, staticName, runtimeName,
    get skipWaitingCalls() { return skipWaitingCalls; },
    get claimCalls() { return claimCalls; },
  };
}

test('A: full core shell installs before skipWaiting; optional failure is tolerated', async () => {
  let worker;
  worker = createWorker(async (request) => {
    if (request.url.endsWith('/favicon.svg')) throw new Error('optional unavailable');
    return request.url === `${origin}/` ? html('shell') : asset('asset');
  });
  await worker.dispatch('install');
  assert.equal(worker.skipWaitingCalls, 1);
  const entries = worker.cacheData.get(worker.staticName);
  for (const path of ['/', '/site.webmanifest', '/styles-app.min.css?v=065a5b200e89', '/theme-init.js?v=065a5b200e89', '/script.min.js?v=065a5b200e89']) {
    assert.ok(entries.has(`${origin}${path}`), path);
  }
});

test('B: missing core asset rejects install and preserves old caches', async () => {
  const worker = createWorker(async (request) => request.url.includes('script.min.js')
    ? new Response('missing', { status: 404 }) : asset('asset'));
  await worker.caches.open('weather-static-vold');
  await assert.rejects(worker.dispatch('install'), /core asset unavailable/);
  assert.equal(worker.skipWaitingCalls, 0);
  assert.deepEqual([...worker.cacheData.get(worker.staticName).keys()], []);
  assert.ok(worker.cacheData.has('weather-static-vold'));
  assert.equal(worker.claimCalls, 0);
});

test('C: activation deletes only old WeatherPure caches', async () => {
  const worker = createWorker();
  for (const name of ['weather-static-vold', 'weather-runtime-vold', worker.staticName, worker.runtimeName, 'another-app-cache']) {
    await worker.caches.open(name);
  }
  await worker.dispatch('activate');
  assert.deepEqual(await worker.caches.keys(), [worker.staticName, worker.runtimeName, 'another-app-cache']);
  assert.equal(worker.claimCalls, 1);
});

test('D: API GET with v bypasses every worker cache path', async () => {
  const worker = createWorker();
  const result = await worker.dispatch('fetch', { request: worker.request('/api/geocoding?q=Berlin&v=1') });
  assert.equal(result, undefined);
  assert.deepEqual(worker.cacheCalls, []);
});

test('E and J: same-token root navigation uses new network HTML and updates runtime cache', async () => {
  const worker = createWorker(async () => html('root B'));
  await (await worker.caches.open(worker.staticName)).put('/', html('root A'));
  await (await worker.caches.open(worker.runtimeName)).put('/', html('runtime A'));
  const response = await worker.dispatch('fetch', { request: worker.request('/', { mode: 'navigate' }) });
  assert.equal(await response.text(), 'root B');
  assert.equal(await (await worker.caches.open(worker.runtimeName)).match('/').then((r) => r.text()), 'root B');
});

test('a navigation with v remains network-first', async () => {
  const worker = createWorker(async () => html('fresh navigation'));
  const path = '/?v=release';
  await (await worker.caches.open(worker.runtimeName)).put(path, html('old navigation'));
  const response = await worker.dispatch('fetch', { request: worker.request(path, { mode: 'navigate' }) });
  assert.equal(await response.text(), 'fresh navigation');
});

test('F: legal navigation returns and stores new HTML with the WP-AUD-014 CSS hash', async () => {
  const page = '<link rel="stylesheet" href="./styles-pages.min.css?v=d9862c9a92b00576">';
  const worker = createWorker(async () => html(page));
  await (await worker.caches.open(worker.runtimeName)).put('/datenschutz', html('old legal'));
  const response = await worker.dispatch('fetch', { request: worker.request('/datenschutz', { mode: 'navigate' }) });
  assert.equal(await response.text(), page);
  assert.equal(await (await worker.caches.open(worker.runtimeName)).match('/datenschutz').then((r) => r.text()), page);
});

test('G: offline visited legal page uses its exact cached HTML', async () => {
  const worker = createWorker(async () => { throw new Error('offline'); });
  await (await worker.caches.open(worker.runtimeName)).put('/datenschutz', html('cached privacy'));
  const response = await worker.dispatch('fetch', { request: worker.request('/datenschutz', { mode: 'navigate' }) });
  assert.equal(await response.text(), 'cached privacy');
});

test('H: offline unvisited legal page never receives the root shell', async () => {
  const worker = createWorker(async () => { throw new Error('offline'); });
  await (await worker.caches.open(worker.staticName)).put('/', html('root shell'));
  const response = await worker.dispatch('fetch', { request: worker.request('/datenschutz', { mode: 'navigate' }) });
  assert.equal(response.type, 'error');
});

test('offline root navigation retains the precached app shell', async () => {
  const worker = createWorker(async () => { throw new Error('offline'); });
  await (await worker.caches.open(worker.staticName)).put('/', html('root shell'));
  const response = await worker.dispatch('fetch', { request: worker.request('/', { mode: 'navigate' }) });
  assert.equal(await response.text(), 'root shell');
});

test('I: missing CSS and JS never receive HTML fallback', async () => {
  const worker = createWorker(async () => { throw new Error('offline'); });
  await (await worker.caches.open(worker.staticName)).put('/', html('root shell'));
  for (const path of ['/styles-app.min.css?v=missing', '/script.min.js?v=missing']) {
    const response = await worker.dispatch('fetch', { request: worker.request(path) });
    assert.equal(response.type, 'error', path);
  }
});

test('K: a versioned cached asset keeps cache-first behavior', async () => {
  let fetches = 0;
  const worker = createWorker(async () => { fetches++; return asset('network'); });
  const path = '/script.min.js?v=cached';
  await (await worker.caches.open(worker.runtimeName)).put(path, asset('cached'));
  const response = await worker.dispatch('fetch', { request: worker.request(path) });
  assert.equal(await response.text(), 'cached');
  assert.equal(fetches, 0);
});

test('an asset response marked no-store is not written to runtime cache', async () => {
  const worker = createWorker(async () => asset('icon', { 'Cache-Control': 'no-store' }));
  const path = '/favicon.ico';
  const response = await worker.dispatch('fetch', { request: worker.request(path) });
  assert.equal(await response.text(), 'icon');
  assert.equal(await (await worker.caches.open(worker.runtimeName)).match(path), undefined);
});
