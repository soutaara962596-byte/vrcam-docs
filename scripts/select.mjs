import fs from 'node:fs';
import { collect, parseMarkdown, prepareOutputTargets, safeRead, sha256 } from './publication.mjs';
const [source, slug] = process.argv.slice(2);
if (!source || !slug) throw Error('Usage: pnpm select authoring/public/example.md example');
const [manifestFile] = prepareOutputTargets(process.cwd(), ['publication.json']);
const original = fs.readFileSync(manifestFile);
const manifest = JSON.parse(original);
const bytes = safeRead(process.cwd(), source);
parseMarkdown(bytes);
const entry = { source, slug, sha256: sha256(bytes) };
const index = manifest.documents.findIndex(x => x.source === source);
if (index < 0) manifest.documents.push(entry); else manifest.documents[index] = entry;
try {
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  collect(process.cwd());
} catch (error) {
  prepareOutputTargets(process.cwd(), ['publication.json']);
  fs.writeFileSync(manifestFile, original);
  throw error;
}
console.log('Selection updated. Human PR review is still required.');
