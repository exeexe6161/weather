#!/usr/bin/env node
/* Generate the Service-Worker cache key at build time and bake it into sw.js.
 *
 * Source of truth, in order of precedence:
 *   1. process.env.VERCEL_GIT_COMMIT_SHA  (first 12 chars) — stable per deploy
 *   2. Hash der gebauten Kern-Assets       — stabil bei identischem Inhalt
 *
 * Deliberately never shells out to `git`: VERCEL_GIT_COMMIT_SHA may be unset
 * and a git invocation can fail inside the Vercel build sandbox. This script
 * is the single automatic source for the version — never bump it by hand.
 *
 * Reads root templates and built assets, then writes only to dist/.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildServiceWorker(sourceDirectory, outputDirectory, sha = process.env.VERCEL_GIT_COMMIT_SHA) {
  const assetContents = await Promise.all([
    readFile(join(outputDirectory, 'styles-app.min.css')),
    readFile(join(sourceDirectory, 'theme-init.js')),
    readFile(join(outputDirectory, 'script.min.js')),
  ]);
  const contentToken = createHash('sha256').update(Buffer.concat(assetContents)).digest('hex').slice(0, 12);
  const token = sha ? sha.slice(0, 12) : contentToken;
  const version = 'v' + token;

  const [swSource, indexSource] = await Promise.all([
    readFile(join(sourceDirectory, 'sw.js'), 'utf8'),
    readFile(join(sourceDirectory, 'index.html'), 'utf8'),
  ]);

  // The source may contain an older token; only the dist copy is updated.
  const re = /(const CACHE_VERSION\s*=\s*)'[^']*'/;
  if (!re.test(swSource)) {
    throw new Error('build-sw: CACHE_VERSION literal not found in sw.js');
  }
  const verRe = /\?v=(?:BUILD|[A-Za-z0-9._-]+)/g;
  const nextSw = swSource.replace(re, `$1'${version}'`).replace(verRe, `?v=${token}`);
  const nextIndex = indexSource.replace(verRe, `?v=${token}`);
  await Promise.all([
    writeFile(join(outputDirectory, 'sw.js'), nextSw),
    writeFile(join(outputDirectory, 'index.html'), nextIndex),
  ]);
  return { token, source: sha ? 'commit sha' : 'content hash' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const { token, source } = await buildServiceWorker(sourceDirectory, join(sourceDirectory, 'dist'));
  console.log(`build-sw: CACHE_VERSION = v${token} (${source})`);
}
