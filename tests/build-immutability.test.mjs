import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildServiceWorker } from '../build-sw.mjs';

test('build versioning writes deterministic HTML and service worker only to dist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weatherpure-build-immutability-'));
  const dist = join(directory, 'dist');
  const sources = {
    'index.html': '<link href="styles-app.min.css?v=old"><script src="script.min.js?v=old"></script>',
    'sw.js': "const CACHE_VERSION = 'vold'; const core = '/script.min.js?v=old';",
    'theme-init.js': 'theme',
  };
  try {
    await mkdir(dist);
    await Promise.all(Object.entries(sources).map(([name, content]) => writeFile(join(directory, name), content)));
    await writeFile(join(dist, 'styles-app.min.css'), 'css');
    await writeFile(join(dist, 'script.min.js'), 'script');

    const token = createHash('sha256').update('cssthemescript').digest('hex').slice(0, 12);
    const first = await buildServiceWorker(directory, dist, '');
    const firstIndex = await readFile(join(dist, 'index.html'), 'utf8');
    const firstSw = await readFile(join(dist, 'sw.js'), 'utf8');
    assert.equal(first.token, token);
    assert.match(firstIndex, new RegExp(`styles-app\\.min\\.css\\?v=${token}`));
    assert.match(firstSw, new RegExp(`CACHE_VERSION = 'v${token}'`));
    assert.match(firstSw, new RegExp(`script\\.min\\.js\\?v=${token}`));

    await buildServiceWorker(directory, dist, '');
    assert.equal(await readFile(join(dist, 'index.html'), 'utf8'), firstIndex);
    assert.equal(await readFile(join(dist, 'sw.js'), 'utf8'), firstSw);
    for (const [name, content] of Object.entries(sources)) {
      assert.equal(await readFile(join(directory, name), 'utf8'), content, name);
    }

    const commit = await buildServiceWorker(directory, dist, 'abcdef1234567890');
    assert.equal(commit.token, 'abcdef123456');
    assert.match(await readFile(join(dist, 'sw.js'), 'utf8'), /CACHE_VERSION = 'vabcdef123456'/);
    for (const [name, content] of Object.entries(sources)) {
      assert.equal(await readFile(join(directory, name), 'utf8'), content, name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
