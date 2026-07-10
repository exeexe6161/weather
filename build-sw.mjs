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
 * Runs against the root sw.js BEFORE build:dist copies it into dist/.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const assetFiles = ['styles-app.min.css', 'theme-init.js', 'script.min.js'];
const assetContents = await Promise.all(assetFiles.map((name) => readFile(new URL(`./${name}`, import.meta.url))));
const contentToken = createHash('sha256').update(Buffer.concat(assetContents)).digest('hex').slice(0, 12);
const token = sha ? sha.slice(0, 12) : contentToken;
const version = 'v' + token;

const file = new URL('./sw.js', import.meta.url);
const src = await readFile(file, 'utf8');

// Replace the single CACHE_VERSION string literal. The pattern tolerates any
// prior value, so the step is idempotent across repeated rebuilds.
const re = /(const CACHE_VERSION\s*=\s*)'[^']*'/;
if (!re.test(src)) {
  console.error('build-sw: CACHE_VERSION literal not found in sw.js — aborting');
  process.exit(1);
}

const nextSw = src.replace(re, `$1'${version}'`);
if (nextSw !== src) await writeFile(file, nextSw);
console.log(`build-sw: CACHE_VERSION = ${version} (${sha ? 'commit sha' : 'content hash'})`);

const verRe = /\?v=(?:BUILD|[A-Za-z0-9._-]+)/g;
for (const f of ["index.html", "sw.js"]) {
  const p = new URL(f, import.meta.url);
  const current = await readFile(p, "utf8");
  const next = current.replace(verRe, `?v=${token}`);
  if (next !== current) await writeFile(p, next);
}
