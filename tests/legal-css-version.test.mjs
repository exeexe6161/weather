import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cssVersion, legalPages, versionLegalCssReference, versionLegalPages } from '../build-legal-css.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cssReference = /styles-pages\.min\.css\?v=([a-f0-9]{16})/g;

test('CSS version follows built bytes, including with a commit SHA', () => {
  const first = Buffer.from('body{color:#123456}');
  const second = Buffer.from('body{color:#654321}');
  const originalSha = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  try {
    assert.equal(cssVersion(first), cssVersion(first));
    assert.notEqual(cssVersion(first), cssVersion(second));
    assert.equal(cssVersion(first), createHash('sha256').update(first).digest('hex').slice(0, 16));
  } finally {
    if (originalSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = originalSha;
  }
});

test('all seven built pages share the CSS version and retain unrelated assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weatherpure-legal-css-'));
  try {
    const sourcePages = await Promise.all(legalPages.map(async (name) => ({
      name,
      html: await readFile(join(root, name), 'utf8'),
    })));
    for (const { name, html } of sourcePages) await writeFile(join(directory, name), html);
    const css = Buffer.from('body{color:#123456}');
    await writeFile(join(directory, 'styles-pages.min.css'), css);

    const firstVersion = await versionLegalPages(directory);
    assert.equal(firstVersion, cssVersion(css));
    for (const { name, html } of sourcePages) {
      const built = await readFile(join(directory, name), 'utf8');
      assert.deepEqual([...built.matchAll(cssReference)].map((match) => match[1]), [firstVersion], name);
      assert.ok(!built.includes('styles-pages.min.css?v=20260618-134121'), name);
      assert.equal(built, versionLegalCssReference(html, firstVersion, name));
    }

    assert.equal(await versionLegalPages(directory), firstVersion);
    const changedCss = Buffer.from('body{color:#654321}');
    await writeFile(join(directory, 'styles-pages.min.css'), changedCss);
    const secondVersion = await versionLegalPages(directory);
    assert.notEqual(secondVersion, firstVersion);
    for (const name of legalPages) {
      const built = await readFile(join(directory, name), 'utf8');
      assert.deepEqual([...built.matchAll(cssReference)].map((match) => match[1]), [secondVersion], name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a missing or duplicate CSS reference fails deliberately', () => {
  assert.throws(
    () => versionLegalCssReference('<html></html>', 'abcdef0123456789', 'missing.html'),
    /expected one CSS reference in missing\.html, found 0/,
  );
  const reference = '<link rel="stylesheet" href="./styles-pages.min.css?v=old">';
  assert.throws(
    () => versionLegalCssReference(reference + reference, 'abcdef0123456789', 'duplicate.html'),
    /expected one CSS reference in duplicate\.html, found 2/,
  );
});
