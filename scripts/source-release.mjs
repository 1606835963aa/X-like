import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { checkPublicFiles } from './public-files.mjs';
import { prepareLegal } from './legal.mjs';

const root = process.cwd(), { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const result = checkPublicFiles();
if (result.issues.length) throw new Error('源码公开检查未通过，请先运行 npm run release:check');
for (const required of ['index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','src/ui/main.tsx','src/desktop/main.ts','src/server/entry.ts','LICENSE','README.md','README.en.md','SECURITY.md','CONTRIBUTING.md','.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml','docs/安装与更新.md','docs/反馈与诊断.md']) {
  if (!result.files.includes(required)) throw new Error(`源码包缺少必要文件：${required}`);
}
const temporary = path.join(root, 'tmp');
const hadTemporary = fs.existsSync(temporary);
fs.mkdirSync(temporary, { recursive: true });
const work = fs.mkdtempSync(path.join(temporary, 'source-export-'));
const name = `Shizang-${version}-source`, destination = path.join(work, name);
try {
  for (const file of result.files) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
    fs.chmodSync(target, fs.statSync(path.join(root, file)).mode & 0o777);
  }
  prepareLegal(path.join(destination, 'legal'));
  fs.writeFileSync(path.join(destination, 'SOURCE_MANIFEST.json'), JSON.stringify({ version, files: result.files }, null, 2) + '\n');
  fs.mkdirSync('release', { recursive: true });
  const archive = path.join(root, 'release', `${name}.tar.gz`);
  const bsd = /bsdtar/i.test(execFileSync('tar', ['--version'], { encoding: 'utf8' }));
  const owner = bsd ? ['--uid','0','--gid','0','--uname','root','--gname','root'] : ['--owner=0','--group=0','--numeric-owner'];
  const packed = spawnSync('tar', ['--format=ustar', ...owner, '-czf', archive, '-C', work, name], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  if (packed.status !== 0) throw new Error('源码打包失败，请检查 tar 是否可用');
  console.log(`已生成不含 Git 历史、个人配置和安装包的源码包：${archive}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
  if (!hadTemporary && fs.readdirSync(temporary).length === 0) fs.rmdirSync(temporary);
}
