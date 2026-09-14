import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareOutputTargets } from './publication.mjs';
const [task, mode = 'prepare'] = process.argv.slice(2);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task ?? '') || !['prepare','submit'].includes(mode)) throw Error('Usage: pnpm pr task-slug [prepare|submit]');
function run(cmd,args){const r=spawnSync(cmd,args,{stdio:'inherit',shell:false});if(r.error)throw r.error;if(r.status!==0)throw Error(`${cmd} failed`);}
function read(args){const r=spawnSync('git',args,{encoding:'utf8',shell:false});if(r.status!==0)throw Error(r.stderr);return r.stdout.trimEnd();}
const branch=`docs/${task}`;
if(mode==='prepare') {
  if(read(['status','--porcelain'])) throw Error('Clean working tree required before preparing branch');
  run('git',['fetch','origin','main']);
  run('git',['switch','--create',branch,'origin/main']);
  console.log('Edit curated Markdown, update selection with pnpm select, then submit.');
} else {
  if(read(['branch','--show-current'])!==branch) throw Error('Wrong task branch');
  const changes=read(['status','--porcelain','--untracked-files=all']).split('\n').filter(Boolean);
  for(const line of changes) {
    const file=line.slice(3);
    if(file!=='publication.json' && !/^authoring\/public\/[a-z0-9/-]+\.md$/.test(file)) throw Error('Content PR helper only accepts curated Markdown and publication.json');
  }
  if(!changes.length) throw Error('No changes to submit');
  run('git',['add','--','authoring/public','publication.json']);
  run(process.execPath,['scripts/check-git-publication.mjs','--ref=:']);
  run(process.execPath,['scripts/check-repository.mjs']);
  run(process.execPath,['scripts/build.mjs']);
  const [body]=prepareOutputTargets(process.cwd(),['.state/pr-body.md']);
  fs.writeFileSync(body,`公開用Markdownと選択manifestを更新します。\n\n検証: ローカル公開対象検査・Astroビルド・生成物検査を実施。\n\nHuman review: 公開範囲、秘密情報、事実と承認根拠を確認してください。自動mergeは行いません。\n`);
  run('git',['commit','-m',`docs: ${task}`]);
  run(process.execPath,['scripts/check-git-publication.mjs','--ref=HEAD']);
  run('git',['push','--set-upstream','origin',branch]);
  run('gh',['pr','create','--draft','--base','main','--head',branch,'--title',`docs: ${task}`,'--body-file',body]);
}
