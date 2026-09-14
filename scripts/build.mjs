import { spawnSync } from 'node:child_process';
const env={...process.env,ASTRO_TELEMETRY_DISABLED:'1'};
for(const args of [['scripts/publication.mjs'],['node_modules/astro/bin/astro.mjs','build'],['scripts/check-dist.mjs']]) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env,shell:false});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status || 1);
}
