import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

mkdirSync('tmp', { recursive: true });
process.env.electron_config_cache??=resolve('tmp/electron-cache');
const {default:electron}=await import('electron');
const work = mkdtempSync(resolve('tmp/collector-test-'));
try {
  const entry = join(work, 'scenarios.cjs');
  await build({ entryPoints: ['tests/collector-scenarios.ts'], outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
  const args = process.platform === 'linux' && process.env.CI ? ['--no-sandbox', entry] : [entry];
  const result = spawnSync(electron, args, { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, SHIZANG_TEST_DIR: work } });
  if (result.error) console.error(result.error);
  if (result.signal) console.error(`Electron 测试进程收到 ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally { rmSync(work, { recursive: true, force: true }); }
