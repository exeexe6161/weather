#!/usr/bin/env node
/* Generate the Service-Worker cache key at build time and bake it into sw.js.
 *
 * Source of truth, in order of precedence:
 *   1. process.env.VERCEL_GIT_COMMIT_SHA  (first 12 chars) — stable per deploy
 *   2. Date.now()                          — fallback for local/offline builds
 *
 * Deliberately never shells out to `git`: VERCEL_GIT_COMMIT_SHA may be unset
 * and a git invocation can fail inside the Vercel build sandbox. This script
 * is the single automatic source for the version — never bump it by hand.
 *
 * Runs against the root sw.js BEFORE build:dist copies it into dist/.
 */
import { readFile, writeFile } from 'node:fs/promises';

const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const token = sha ? sha.slice(0, 12) : String(Date.now());
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

await writeFile(file, src.replace(re, `$1'${version}'`));
console.log(`build-sw: CACHE_VERSION = ${version} (${sha ? 'commit sha' : 'timestamp fallback'})`);
