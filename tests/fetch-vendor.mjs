// Downloads every CDN resource index.html loads into tests/vendor/, for offline tests.
// Re-run (`npm run vendor`) after changing a library version in index.html.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const urls = [...new Set([...html.matchAll(/(?:src=|href=|from )["'](https:\/\/[^"']+)["']/g)].map((m) => m[1]))]
  .filter((u) => !u.startsWith('https://fonts.googleapis.com/')); // fonts are stubbed in fixtures.js

const dir = new URL('vendor/', import.meta.url);
await rm(dir, { recursive: true, force: true });
await mkdir(dir);
const manifest = {};
for (const url of urls) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const { hostname, pathname } = new URL(url);
  const ext = pathname.endsWith('.css') ? '.css' : '.js';
  const name = `${hostname}${pathname}`.replace(/[^\w.@-]+/g, '_').replace(/\.(js|css)$/, '') + ext;
  await writeFile(new URL(name, dir), Buffer.from(await res.arrayBuffer()));
  manifest[url] = name;
  console.log(`${url} -> ${name}`);
}
await writeFile(new URL('manifest.json', dir), JSON.stringify(manifest, null, 2) + '\n');
