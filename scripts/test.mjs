import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const checks=["shared/core-check.cjs", "shared/batch-check.cjs", "shared/power-compat-check.cjs", "sample-repeats-check.cjs", "record-features-check.cjs", "outcome-export-check.cjs", "qc-check.cjs", "map-power-check.cjs", "cloud-upgrade-check.cjs", "backend-check.mjs", "code-auth-check.mjs", "backup-check.mjs"];
for(const check of checks){console.log('\n'+check);const result=spawnSync(process.execPath,[check],{cwd:root,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
console.log('\nAll checks passed.');
