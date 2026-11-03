import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkPublicFiles, hasProjectHistory, scanPublicText } from './public-files.mjs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
let failed = false;
function check(ok, message) { console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`); if (!ok) failed = true; }
check(pkg.version === lock.version && pkg.version === lock.packages[''].version, '应用与依赖锁文件版本一致');
check(pkg.engines.node === lock.packages[''].engines?.node && /^24\./.test(fs.readFileSync('.node-version','utf8').trim()), '开发环境版本已声明');
check(pkg.license === 'AGPL-3.0-only' && fs.readFileSync('LICENSE','utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE'), '项目使用 AGPLv3');
check(pkg.build.files.includes('LICENSE') && pkg.build.extraResources.some(item => item.from === 'dist/legal'), '桌面发行包包含协议和第三方许可');
const { files, issues } = checkPublicFiles();
check(['SECURITY.md','CONTRIBUTING.md','.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml'].every(file => files.includes(file)), '安全政策、贡献指南与反馈模板齐全');
check(issues.length === 0, '当前公开源码的个人配置与凭证检查');
for (const issue of issues) console.error(`${issue.file}:${issue.line} ${issue.reason}`);
if (process.argv.includes('--history') && !hasProjectHistory()) check(true, '源码目录不包含独立 Git 历史');
if (process.argv.includes('--history') && hasProjectHistory()) {
  const commits = execFileSync('git',['rev-list','--all'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  let count = 0;
  for (const commit of commits) {
    const names = execFileSync('git',['ls-tree','-r','--name-only',commit],{encoding:'utf8'}).split('\n').filter(name => /\.(?:md|ts|tsx|mjs|json|yaml|yml)$/.test(name) && !name.endsWith('package-lock.json'));
    for (const name of names) {
      const found = scanPublicText(name,execFileSync('git',['show',`${commit}:${name}`],{encoding:'utf8',maxBuffer:8*1024*1024}));
      for (const issue of found) { count++; console.error(`${commit.slice(0,7)} ${issue.file}:${issue.line} ${issue.reason}`); }
    }
  }
  check(count === 0, 'Git 历史中的个人配置与凭证检查；未通过时不得公开这些提交');
}
process.exitCode = failed ? 1 : 0;
