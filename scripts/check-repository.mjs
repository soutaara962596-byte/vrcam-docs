import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { scanSecrets, collect } from './publication.mjs';
collect(process.cwd());
const files = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if (!files.length) throw Error('Repository must be initialized and staged before checking');
for (const file of files) {
  if (/(^|\/)(\.env[^/]*|\.dev.vars[^/]*|\.obsidian|private|node_modules|\.state|\.generated)(\/|$)/.test(file) || /\.(pem|key|p12|pfx)$/i.test(file)) throw Error(`Forbidden tracked path: ${file}`);
  if (fs.lstatSync(file).isSymbolicLink()) throw Error(`Tracked link: ${file}`);
  if (!file.endsWith('.zip') && fs.statSync(file).size < 1024*1024) scanSecrets(fs.readFileSync(file,'utf8'),file);
}
for (const file of fs.readdirSync('.github/workflows')) {
  const text=fs.readFileSync(`.github/workflows/${file}`,'utf8');
  const doc=parseDocument(text); if(doc.errors.length) throw Error(`Invalid workflow: ${file}`);
  const workflow=doc.toJS();
  if (Object.keys(workflow.permissions ?? {}).length) throw Error('Workflow default permissions must be empty');
  if (/pull_request_target|secrets: inherit|persist-credentials: true/.test(text)) throw Error('Unsafe workflow');
  for(const job of Object.values(workflow.jobs)) {
    for(const [permission,value] of Object.entries(job.permissions ?? {})) if(permission!=='contents' || value!=='read') throw Error('Unexpected job permissions');
    for(const step of job.steps ?? []) if(step.uses && !/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(step.uses)) throw Error('Action must be pinned');
  }
}
console.log(`Checked ${files.length} tracked files and pinned workflows`);
