import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect, generate, sha256, scanSecrets, assertSafePath } from '../scripts/publication.mjs';
function fixture(t, body='## Hello\n\nPublic text.', meta='publication: public') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'docs-publication-'));
  t.after(()=>{assert.ok(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()),'docs-publication-')));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'authoring/public'),{recursive:true});
  const bytes=Buffer.from(`---\ntitle: Example\ncategory: faq\n${meta}\n---\n${body}\n`);
  fs.writeFileSync(path.join(root,'authoring/public/example.md'),bytes);
  const manifest={version:1,documents:[{source:'authoring/public/example.md',slug:'example',sha256:sha256(bytes)}]};
  const save=()=>fs.writeFileSync(path.join(root,'publication.json'),JSON.stringify(manifest)); save();
  return {root,manifest,save};
}
test('only selected pages appear; source paths and hashes are not public',t=>{
  const {root}=fixture(t);
  fs.writeFileSync(path.join(root,'authoring/public/unselected.md'),'PRIVATE-CANARY-UNSELECTED');
  generate(root);
  const text=fs.readFileSync(path.join(root,'.generated/pages.json'),'utf8');
  assert.match(text,/Public text/); assert.doesNotMatch(text,/CANARY|authoring|sha256/);
});
test('changed bytes invalidate selection',t=>{const {root}=fixture(t);fs.appendFileSync(path.join(root,'authoring/public/example.md'),'drift');assert.throws(()=>collect(root),/SHA mismatch/);});
test('duplicate slug/source rejected',t=>{const f=fixture(t);f.manifest.documents.push(f.manifest.documents[0]);f.save();assert.throws(()=>collect(f.root),/Duplicate/);});
test('missing selected document rejected',t=>{const f=fixture(t);fs.unlinkSync(path.join(f.root,'authoring/public/example.md'));assert.throws(()=>collect(f.root));});
test('private frontmatter rejected',t=>{const f=fixture(t,'text','publication: private');assert.throws(()=>collect(f.root),/metadata/);});
test('unknown metadata rejected',t=>{const f=fixture(t,'text','publication: public\ninternal: hidden');assert.throws(()=>collect(f.root),/frontmatter/);});
test('duplicate YAML keys rejected',t=>{const f=fixture(t,'text','publication: public\npublication: private');assert.throws(()=>collect(f.root),/frontmatter/);});
test('invalid UTF-8 rejected',t=>{const f=fixture(t);const b=Buffer.from([255,254]);fs.writeFileSync(path.join(f.root,'authoring/public/example.md'),b);f.manifest.documents[0].sha256=sha256(b);f.save();assert.throws(()=>collect(f.root));});
for(const [label,body] of Object.entries({html:'<script>alert(1)</script>',nested:'> <img src=x onerror=alert(1)>',javascript:'[click](javascript:alert)',data:'[click](data:text/html,x)',http:'[click](http://example.com)',protocolRelative:'[click](//example.com)',image:'![image](https://example.com/x)',wikilink:'[[Private Note]]',comment:'%% private text %%',broken:'[missing](/docs/missing/)'})) {
  test(`reject ${label}`,t=>{const f=fixture(t,body);assert.throws(()=>collect(f.root));});
}
test('safe links and code examples survive',t=>{const f=fixture(t,'[site](https://example.com) [home](/)\n\n```html\n<script>example</script>\n```');const pages=collect(f.root);assert.match(pages[0].html,/&lt;script&gt;/);assert.doesNotMatch(pages[0].html,/<script>/);});
test('representative secrets blocked without echoing values',()=>{
  for(const value of ['gh'+'p_'+'a'.repeat(36),'api_'+'token: '+'x'.repeat(40),'-----BEGIN '+'PRIVATE KEY-----',['https:', '', 'user:pass@example.com'].join('/'),'C:'+'\\Users\\private']) assert.throws(()=>scanSecrets(value),e=>!e.message.includes(value));
});
test('traversal and Windows collisions rejected',()=>{for(const rel of ['../x','a/../x','/x','C:/x','a\\x','a//b','con.md','a./b','a/aux.md','a:b','a/é.md'])assert.throws(()=>assertSafePath(rel));});
test('selection cannot target private directory',t=>{const f=fixture(t);f.manifest.documents[0].source='authoring/private/example.md';f.save();assert.throws(()=>collect(f.root),/selection/i);});
test('linked source directory rejected',t=>{
  const f=fixture(t);const dest=path.join(f.root,'elsewhere');fs.renameSync(path.join(f.root,'authoring/public'),dest);fs.symlinkSync(dest,path.join(f.root,'authoring/public'),process.platform==='win32'?'junction':'dir');assert.throws(()=>collect(f.root),/Linked/);
});
test('source size bounded',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,'authoring/public/example.md'),'x'.repeat(300000));assert.throws(()=>collect(f.root),/size/);});
test('unknown fragment rejected',t=>{const f=fixture(t,'[missing](#missing)');assert.throws(()=>collect(f.root),/link/);});
test('linked report output rejected',t=>{const f=fixture(t);const dest=path.join(f.root,'elsewhere');fs.mkdirSync(dest);fs.symlinkSync(dest,path.join(f.root,'.state'),process.platform==='win32'?'junction':'dir');assert.throws(()=>generate(f.root),/Linked/);});
