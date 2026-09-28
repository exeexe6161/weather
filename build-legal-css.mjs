#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const legalPages = [
  'datenschutz.html',
  'datenschutz-en.html',
  'datenschutz-tr.html',
  'impressum.html',
  'impressum-en.html',
  'impressum-tr.html',
  '404.html',
];

export function cssVersion(cssBytes) {
  return createHash('sha256').update(cssBytes).digest('hex').slice(0, 16);
}

export function versionLegalCssReference(html, version, page) {
  const reference = /(<link rel="stylesheet" href="(?:\.\/|\/)styles-pages\.min\.css\?v=)[A-Za-z0-9._-]+(">)/g;
  const count = [...html.matchAll(reference)].length;
  if (count !== 1) {
    throw new Error(`build-legal-css: expected one CSS reference in ${page}, found ${count}`);
  }
  return html.replace(reference, (_match, prefix, suffix) => `${prefix}${version}${suffix}`);
}

export async function versionLegalPages(directory) {
  const cssBytes = await readFile(join(directory, 'styles-pages.min.css'));
  const version = cssVersion(cssBytes);
  const pages = await Promise.all(legalPages.map(async (name) => {
    const path = join(directory, name);
    const html = await readFile(path, 'utf8');
    return { path, html: versionLegalCssReference(html, version, name) };
  }));
  await Promise.all(pages.map(({ path, html }) => writeFile(path, html)));
  return version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const directory = fileURLToPath(new URL('./dist/', import.meta.url));
  const version = await versionLegalPages(directory);
  console.log(`build-legal-css: styles-pages.min.css v${version} (${legalPages.length} pages)`);
}
