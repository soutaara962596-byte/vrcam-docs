import { spawnSync } from 'node:child_process';
import { generate } from './publication.mjs';
generate(process.cwd());
const result=spawnSync(process.execPath,['node_modules/astro/bin/astro.mjs','dev','--host','127.0.0.1'],{stdio:'inherit',env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'}});
if(result.error)throw result.error;
process.exit(result.status || 0);
