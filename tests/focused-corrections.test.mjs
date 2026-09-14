import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertLfBytes, generate, prepareOutputTargets, sha256 } from '../scripts/publication.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
function temporary(t, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `docs-${label}-`));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.join(path.resolve(os.tmpdir()), `docs-${label}-`)));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}
function publicationFixture(t, label = 'f01') {
  const root = temporary(t, label);
  fs.mkdirSync(path.join(root, 'authoring/public'), { recursive: true });
  const bytes = Buffer.from('---\ntitle: Example\ncategory: faq\npublication: public\n---\n## Body\n');
  fs.writeFileSync(path.join(root, 'authoring/public/example.md'), bytes);
  fs.writeFileSync(path.join(root, 'publication.json'), JSON.stringify({version:1,documents:[{source:'authoring/public/example.md',slug:'example',sha256:sha256(bytes)}]}, null, 2) + '\n');
  return root;
}
function fileSymlinkOrSkip(t, target, link) {
  try { fs.symlinkSync(target, link, 'file'); return true; }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) { t.skip(`file symlink unavailable: ${error.code}`); return false; }
    throw error;
  }
}
function runGit(cwd, args, binary = false) {
  const result = spawnSync('git', args, { cwd, encoding: binary ? null : 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr?.toString() || 'git failed');
  return result.stdout;
}
function gitFixture(t, newline) {
  const root = temporary(t, 'f02-git');
  fs.mkdirSync(path.join(root, 'authoring/public'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, '.gitattributes'), path.join(root, '.gitattributes'));
  const bytes = Buffer.from(['---','title: Example','category: faq','publication: public','---','Body',''].join(newline));
  fs.writeFileSync(path.join(root, 'authoring/public/example.md'), bytes);
  fs.writeFileSync(path.join(root, 'publication.json'), JSON.stringify({version:1,documents:[{source:'authoring/public/example.md',slug:'example',sha256:sha256(bytes)}]}, null, 2) + '\n');
  runGit(root, ['init', '--initial-branch=main']);
  runGit(root, ['config', 'user.name', 'Fixture']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['add', '.']);
  return { root, bytes };
}
function checkGit(root, ref) {
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts/check-git-publication.mjs'), `--ref=${ref}`], { cwd: root, encoding: 'utf8', shell: false });
}

test('F01 creates absent outputs and updates regular files', t => {
  const root = publicationFixture(t);
  generate(root);
  const pages = path.join(root, '.generated/pages.json');
  const report = path.join(root, '.state/publication-report.json');
  assert.ok(fs.lstatSync(pages).isFile()); assert.ok(fs.lstatSync(report).isFile());
  const before = fs.readFileSync(pages);
  generate(root);
  assert.deepEqual(fs.readFileSync(pages), before);
});
test('F01 rejects an existing-target output symlink and preserves its target', t => {
  const root = publicationFixture(t); fs.mkdirSync(path.join(root, '.generated'));
  const outside = path.join(root, 'outside.json'); const canary = Buffer.from('UNCHANGED'); fs.writeFileSync(outside, canary);
  if (!fileSymlinkOrSkip(t, outside, path.join(root, '.generated/pages.json'))) return;
  assert.throws(() => generate(root), /Unsafe output file/);
  assert.deepEqual(fs.readFileSync(outside), canary);
});
test('F01 rejects a dangling output symlink before creating its outside target', t => {
  const root = publicationFixture(t); fs.mkdirSync(path.join(root, '.generated'));
  const outside = path.join(root, 'outside-missing.json'); const link = path.join(root, '.generated/pages.json');
  if (!fileSymlinkOrSkip(t, outside, link)) return;
  assert.equal(fs.existsSync(link), false); assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.throws(() => generate(root), /Unsafe output file/);
  assert.equal(fs.existsSync(outside), false); assert.ok(fs.lstatSync(link).isSymbolicLink());
});
test('F01 rejects an output directory junction and preserves outside content', t => {
  const root = publicationFixture(t); const outside = path.join(root, 'outside-dir'); fs.mkdirSync(outside);
  const canary = path.join(outside, 'canary.txt'); fs.writeFileSync(canary, 'UNCHANGED');
  fs.symlinkSync(outside, path.join(root, '.generated'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => generate(root), /Linked output directory/);
  assert.equal(fs.readFileSync(canary, 'utf8'), 'UNCHANGED'); assert.equal(fs.existsSync(path.join(outside, 'pages.json')), false);
});
test('F01 applies the same no-link guard to selection and PR-body targets', t => {
  const root = publicationFixture(t); fs.mkdirSync(path.join(root, '.state'));
  const [manifest, body] = prepareOutputTargets(root, ['publication.json', '.state/pr-body.md']);
  assert.equal(manifest, path.join(root, 'publication.json')); assert.equal(body, path.join(root, '.state/pr-body.md'));
  const outside = path.join(root, 'outside-dir'); fs.mkdirSync(outside);
  fs.rmSync(path.join(root, '.state'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, '.state'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareOutputTargets(root, ['.state/pr-body.md']), /Linked output directory/);
  assert.equal(fs.existsSync(path.join(outside, 'pr-body.md')), false);
});
test('F01 no-follow policy rejects a dangling-link entry without consulting its target', t => {
  const root = publicationFixture(t, 'f01-lstat-policy'); fs.mkdirSync(path.join(root, '.generated'));
  const target = path.resolve(root, '.generated/pages.json'); const original = fs.lstatSync;
  fs.lstatSync = (file, ...args) => path.resolve(file) === target
    ? { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false }
    : original(file, ...args);
  t.after(() => { fs.lstatSync = original; });
  assert.throws(() => prepareOutputTargets(root, ['.generated/pages.json']), /Unsafe output file/);
});
test('F01 output inspection errors remain failures rather than absence', t => {
  const root = publicationFixture(t, 'f01-lstat-error'); fs.mkdirSync(path.join(root, '.generated'));
  const target = path.resolve(root, '.generated/pages.json'); const original = fs.lstatSync;
  fs.lstatSync = (file, ...args) => {
    if (path.resolve(file) === target) throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' });
    return original(file, ...args);
  };
  t.after(() => { fs.lstatSync = original; });
  assert.throws(() => prepareOutputTargets(root, ['.generated/pages.json']), /EACCES/);
});
test('F02 LF policy accepts LF and rejects CRLF and bare CR', () => {
  assert.doesNotThrow(() => assertLfBytes(Buffer.from('a\nb\n')));
  assert.throws(() => assertLfBytes(Buffer.from('a\r\nb\r\n')), /convert the file to LF/);
  assert.throws(() => assertLfBytes(Buffer.from('a\rb')), /convert the file to LF/);
});
test('F02 select rejects CRLF without changing publication.json', t => {
  const root = publicationFixture(t, 'f02-select-crlf');
  fs.writeFileSync(path.join(root, 'authoring/public/example.md'), Buffer.from('---\r\ntitle: Example\r\ncategory: faq\r\npublication: public\r\n---\r\nBody\r\n'));
  const manifest = fs.readFileSync(path.join(root, 'publication.json'));
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/select.mjs'), 'authoring/public/example.md', 'example'], { cwd: root, encoding: 'utf8', shell: false });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /convert the file to LF/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'publication.json')), manifest);
});
test('F02 selecting unchanged LF content is byte-stable', t => {
  const root = publicationFixture(t, 'f02-select-lf'); const command = [path.join(repoRoot, 'scripts/select.mjs'), 'authoring/public/example.md', 'example'];
  assert.equal(spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', shell: false }).status, 0);
  const once = fs.readFileSync(path.join(root, 'publication.json'));
  assert.equal(spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8', shell: false }).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, 'publication.json')), once);
});
test('F02 staged checker accepts LF source bytes', t => {
  const { root } = gitFixture(t, '\n'); const result = checkGit(root, ':');
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Git index/);
});
test('F02 staged checker rejects CRLF worktree hash after Git normalizes the index', t => {
  const { root, bytes } = gitFixture(t, '\r\n'); const staged = runGit(root, ['show', ':authoring/public/example.md'], true);
  assert.ok(bytes.includes(Buffer.from('\r\n'))); assert.equal(staged.includes(Buffer.from('\r\n')), false);
  const result = checkGit(root, ':'); assert.notEqual(result.status, 0); assert.match(result.stderr, /SHA mismatch/);
});
test('F02 committed checker accepts an unchanged LF commit', t => {
  const { root } = gitFixture(t, '\n'); runGit(root, ['commit', '-m', 'fixture']);
  const result = checkGit(root, 'HEAD'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /HEAD/);
});
