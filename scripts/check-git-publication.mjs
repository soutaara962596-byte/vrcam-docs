import { spawnSync } from 'node:child_process';
import { assertLfBytes, assertSafePath, parseMarkdown, sha256 } from './publication.mjs';

const argument = process.argv.find(value => value.startsWith('--ref='));
const ref = argument?.slice(6) || 'HEAD';
if (ref !== ':' && ref !== 'HEAD') throw Error('Only the Git index (:) or HEAD may be checked');
function gitBytes(file) {
  const spec = ref === ':' ? `:${file}` : `${ref}:${file}`;
  const result = spawnSync('git', ['show', spec], { encoding: null, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Cannot read ${file} from ${ref}`);
  return result.stdout;
}
const manifestBytes = gitBytes('publication.json');
assertLfBytes(manifestBytes, 'Staged publication.json');
const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
if (manifest.version !== 1 || Object.keys(manifest).sort().join(',') !== 'documents,version' || !Array.isArray(manifest.documents) || !manifest.documents.length || manifest.documents.length > 100) throw Error('Invalid Git publication manifest');
const sources = new Set(); const slugs = new Set();
for (const entry of manifest.documents) {
  if (Object.keys(entry).sort().join(',') !== 'sha256,slug,source') throw Error('Invalid Git selection entry');
  assertSafePath(entry.source);
  if (!/^authoring\/public\/[a-z0-9/-]+\.md$/.test(entry.source) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Invalid Git selection');
  if (sources.has(entry.source) || slugs.has(entry.slug)) throw Error('Duplicate Git selection');
  sources.add(entry.source); slugs.add(entry.slug);
  const sourceBytes = gitBytes(entry.source);
  assertLfBytes(sourceBytes, `Git source ${entry.source}`);
  parseMarkdown(sourceBytes);
  if (sha256(sourceBytes) !== entry.sha256) throw Error(`Git source SHA mismatch: ${entry.source}`);
}
console.log(`Verified ${manifest.documents.length} selected documents from ${ref === ':' ? 'Git index' : 'HEAD'}`);
