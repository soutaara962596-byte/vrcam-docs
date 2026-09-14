import fs from 'node:fs';
import path from 'node:path';
import { collect, scanSecrets } from './publication.mjs';
const pages = collect(process.cwd());
const expected = new Set(['index.html','404.html','_headers','robots.txt',...pages.map(p=>`docs/${p.slug}/index.html`)]);
const seen = new Set();
function walk(dir, prefix='') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + item.name;
    const file = path.join(dir,item.name);
    if (item.isSymbolicLink()) throw Error('Linked build file');
    if (item.isDirectory()) { walk(file, rel+'/'); continue; }
    if (!expected.has(rel) && !/^_astro\/[A-Za-z0-9_.-]+\.css$/.test(rel)) throw Error(`Unexpected public file: ${rel}`);
    const text = fs.readFileSync(file,'utf8');
    scanSecrets(text, rel);
    if (rel.endsWith('.html') && /<script\b|<iframe\b|\son\w+\s*=|\.state\/|authoring\/|LOCAL_VALIDATED_CANDIDATE/i.test(text)) throw Error(`Unsafe build output: ${rel}`);
    if (rel.endsWith('.html')) for (const match of text.matchAll(/(?:href|src)="(\/[^"?#]*)"/g)) {
      const url = match[1];
      const target = url === '/' ? 'index.html' : url.endsWith('/') ? url.slice(1)+'index.html' : url.slice(1);
      if (!fs.existsSync(path.join('dist',target))) throw Error(`Broken built link in ${rel}`);
    }
    seen.add(rel);
  }
}
walk('dist');
for (const file of expected) if (!seen.has(file)) throw Error(`Missing output: ${file}`);
console.log(`Verified ${seen.size} static files; selected pages only`);
