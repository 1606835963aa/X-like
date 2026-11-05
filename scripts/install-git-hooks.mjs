import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hasProjectHistory } from './public-files.mjs';

if (hasProjectHistory() && !process.env.CI) {
  let configured = '';
  try { configured = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
  catch (error) { if (error.status !== 1) throw error; }
  const defaultHook = execFileSync('git', ['rev-parse', '--git-path', 'hooks/pre-push'], { encoding: 'utf8' }).trim();
  if (configured && configured !== '.githooks' || !configured && fs.existsSync(defaultHook)) {
    console.warn('保留已有 Git hooks；请在现有 pre-push 中调用 node scripts/check-push.mjs "$@"。');
  } else {
    fs.chmodSync('.githooks/pre-push', 0o755);
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks']);
    console.log('已启用 Git 推送前的个人信息检查。');
  }
}
