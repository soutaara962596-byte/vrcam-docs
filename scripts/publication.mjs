import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const categories = ['handoff', 'adr', 'release-notes', 'faq'];
function lstatEntry(file) {
  try { return fs.lstatSync(file); }
  catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw Error(`Cannot inspect output path (${error?.code ?? 'UNKNOWN'})`);
  }
}
function assertDirectoryEntry(directory, allowCreate = false) {
  let entry = lstatEntry(directory);
  if (!entry && allowCreate) {
    fs.mkdirSync(directory);
    entry = lstatEntry(directory);
  }
  if (entry?.isSymbolicLink()) throw Error('Linked output directory');
  if (!entry || !entry.isDirectory()) throw Error('Unsafe output directory');
}
export function prepareOutputTargets(root, relativePaths) {
  const resolvedRoot = path.resolve(root);
  const ancestors = [];
  for (let current = resolvedRoot; ; current = path.dirname(current)) {
    ancestors.push(current);
    if (current === path.dirname(current)) break;
  }
  for (const directory of ancestors.reverse()) assertDirectoryEntry(directory);
  const outputs = [];
  for (const relative of relativePaths) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) throw Error('Unsafe output path');
    const target = path.resolve(resolvedRoot, relative);
    const within = path.relative(resolvedRoot, target);
    if (!within || within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) throw Error('Output path escapes root');
    let directory = resolvedRoot;
    for (const part of path.dirname(within).split(path.sep).filter(part => part && part !== '.')) {
      if (part === '..') throw Error('Output path escapes root');
      directory = path.join(directory, part);
      assertDirectoryEntry(directory, true);
    }
    outputs.push(target);
  }
  // Inspect every target before writing any of them. lstat sees dangling links;
  // ENOENT alone means absent, while access errors remain failures.
  for (const target of outputs) {
    const entry = lstatEntry(target);
    if (entry && (entry.isSymbolicLink() || !entry.isFile())) throw Error('Unsafe output file');
  }
  return outputs;
}
export function assertLfBytes(bytes, label = 'Selected Markdown') {
  if (bytes.includes(0x0d)) throw Error(`${label} must use LF line endings; convert the file to LF before selection`);
}
export function assertSafePath(rel) {
  if (typeof rel !== 'string' || rel.length > 160 || !/^[a-z0-9][a-z0-9./-]*$/.test(rel)) throw Error('Unsafe path');
  for (const part of rel.split('/')) {
    if (!part || part === '.' || part === '..' || part.endsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part)) throw Error('Unsafe path component');
  }
  return rel;
}
export function safeRead(root, rel) {
  assertSafePath(rel);
  let current = path.resolve(root);
  // Check ancestors too: a junction above the configured root must not redirect reads.
  for (let ancestor = current; ; ancestor = path.dirname(ancestor)) {
    if (fs.lstatSync(ancestor).isSymbolicLink()) throw Error('Linked root');
    if (ancestor === path.dirname(ancestor)) break;
  }
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Linked source');
  }
  const stat = fs.statSync(current);
  if (!stat.isFile() || stat.size > 256 * 1024) throw Error('Invalid source size/type');
  return fs.readFileSync(current);
}
export function scanSecrets(text, label = 'content') {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,})\b/,
    /\b(?:api[_-]?key|api[_-]?token|access[_-]?token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_/+.-]{16,}/i,
    /\b(?:CLOUDFLARE_API_TOKEN|GH_TOKEN|GITHUB_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/,
    /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
    /\b[A-Z]:[\\/](?:Users|Dev|CODEX)[\\/]/i,
  ];
  const rule=patterns.findIndex(p => p.test(text));
  if (rule >= 0) throw Error(`Sensitive content detected in ${label} (rule ${rule+1}); value redacted`);
}
export function parseMarkdown(bytes) {
  assertLfBytes(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n');
  scanSecrets(text);
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw Error('YAML frontmatter required');
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) throw Error('Invalid frontmatter');
  const meta = doc.toJS({ maxAliasCount: 0 });
  if (!meta || Object.keys(meta).sort().join(',') !== 'category,publication,title') throw Error('Unknown or missing frontmatter fields');
  if (meta.publication !== 'public' || !categories.includes(meta.category) || typeof meta.title !== 'string' || !meta.title.trim() || meta.title.length > 120) throw Error('Publication metadata rejected');
  if (/\[\[|!\[|%%/.test(match[2])) throw Error('Convert wiki links, images and Obsidian comments before publication');
  return { meta, body: match[2] };
}
export function collect(root) {
  const manifest = JSON.parse(safeRead(root, 'publication.json'));
  if (manifest.version !== 1 || Object.keys(manifest).sort().join(',') !== 'documents,version' || !Array.isArray(manifest.documents) || !manifest.documents.length || manifest.documents.length > 100) throw Error('Invalid publication manifest');
  const slugs = new Set(); const sources = new Set();
  const entries = manifest.documents.map(entry => {
    if (Object.keys(entry).sort().join(',') !== 'sha256,slug,source') throw Error('Invalid selection entry');
    const { source, slug, sha256: expected } = entry;
    assertSafePath(source);
    if (!/^authoring\/public\/[a-z0-9/-]+\.md$/.test(source) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid selection');
    if (slugs.has(slug) || sources.has(source)) throw Error('Duplicate selection');
    slugs.add(slug); sources.add(source);
    const bytes = safeRead(root, source);
    if (sha256(bytes) !== expected) throw Error(`Selection SHA mismatch: ${source}`);
    return { slug, source, sha256: expected, ...parseMarkdown(bytes) };
  });
  for (const entry of entries) {
    const tokens = marked.lexer(entry.body, { gfm: true });
    marked.walkTokens(tokens, token => {
      if (['html', 'image'].includes(token.type)) throw Error(`HTML/images are disabled: ${entry.slug}`);
      if (token.type === 'link') {
        const href = token.href;
        if (href.startsWith('https://')) {
          const url = new URL(href);
          if (url.username || url.password) throw Error('Credential URL');
        } else if (href !== '#main' && !(href === '/' || /^\/docs\/[a-z0-9-]+\/$/.test(href) && slugs.has(href.split('/')[2]))) throw Error(`Unapproved/broken link: ${entry.slug}`);
      }
    });
    const html = marked.parser(tokens);
    entry.html = sanitizeHtml(html, {
      allowedTags: ['p','br','hr','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','strong','em','del','a','table','thead','tbody','tr','th','td'],
      allowedAttributes: { a: ['href','title'], code: ['class'] },
      allowedSchemes: ['https'], allowProtocolRelative: false,
    });
  }
  return entries;
}
export function generate(root) {
  const entries = collect(root);
  const [pagesFile, reportFile] = prepareOutputTargets(root, ['.generated/pages.json', '.state/publication-report.json']);
  const pagesBytes = JSON.stringify(entries.map(({slug,meta,html}) => ({slug,...meta,html})), null, 2);
  const reportBytes = JSON.stringify({
    version: 1, state: 'LOCAL_VALIDATED_CANDIDATE', humanAcceptance: false,
    selectionSha256: sha256(safeRead(root, 'publication.json')),
    documents: entries.map(({source,slug,sha256}) => ({source,slug,sha256})),
  }, null, 2);
  // Public output contains no source locations, receipts, or private provenance.
  fs.writeFileSync(pagesFile, pagesBytes);
  fs.writeFileSync(reportFile, reportBytes);
  return entries;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`Validated ${generate(process.cwd()).length} selected documents`);
}
