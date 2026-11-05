import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const project = process.cwd();
const git = (root: string, ...args: string[]) => execFileSync('git', ['-c','commit.gpgsign=false',...args], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();

function fixture(work: (root: string, remote: string, base: string) => void) {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(resolve('tmp/push-guard-'));
  const root = join(directory, 'checkout'), remote = join(directory, 'remote.git');
  mkdirSync(root); mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'tests'));
  try {
    git(root, 'init', '--initial-branch=main');
    git(root, 'config', 'user.name', 'Shizang Test');
    git(root, 'config', 'user.email', 'test@example.invalid');
    git(root, 'config', 'core.hooksPath', join(project, '.githooks'));
    for (const name of ['check-push.mjs', 'public-files.mjs']) copyFileSync(join(project, 'scripts', name), join(root, 'scripts', name));
    writeFileSync(join(root, 'README.md'), 'Example: http://192.168.1.100:5368\n');
    git(root, 'add', '.'); git(root, 'commit', '-m', 'Initial example');
    git(root, 'init', '--bare', remote);
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'push', '-u', 'origin', 'main');
    work(root, remote, git(root, 'rev-parse', 'HEAD'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('真实 Git 推送拦截藏在较早新提交中的测试地址，后续删掉也不能绕过', () => fixture((root, remote, base) => {
  const address = '192.168.1.100'.replace(/100$/, '42');
  const file = join(root, 'tests', 'fixture.test.ts');
  writeFileSync(file, 'const address=' + JSON.stringify(address.split('.')) + '.join(".");\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Add connection fixture');
  writeFileSync(file, 'const address="192.168.1.100";\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Use public example');
  const result = spawnSync('git', ['push', 'origin', 'main'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /非示例内网地址/);
  assert.ok(!result.stderr.includes(address));
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), base);
  const event = join(root, 'event.json');
  writeFileSync(event, JSON.stringify({ before: base, after: git(root, 'rev-parse', 'HEAD') }));
  const ci = spawnSync(process.execPath, [join(root, 'scripts/check-push.mjs'), '--ci'], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event } });
  assert.notEqual(ci.status, 0);
  assert.match(ci.stderr, /非示例内网地址/);
}));

test('推送检查阻止强制加入的私人配置和标签说明里的地址，正常新分支可推送', () => fixture((root, remote, base) => {
  git(root, 'checkout', '-b', 'feature');
  writeFileSync(join(root, 'tests', 'fixture.test.ts'), 'const address="192.168.1.100";\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Add public example');
  git(root, 'push', 'origin', 'feature');
  const accepted = git(root, 'rev-parse', 'HEAD');
  assert.equal(git(remote, 'rev-parse', 'refs/heads/feature'), accepted);
  writeFileSync(join(root, '.gitignore'), '.env.local\n');
  writeFileSync(join(root, '.env.local'), 'DEVICE_TOKEN=private-device-token\n');
  git(root, 'add', '.'); git(root, 'add', '-f', '.env.local'); git(root, 'commit', '-m', 'Add local settings');
  const failed = spawnSync('git', ['push', 'origin', 'feature'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /私有资料/);
  assert.ok(!failed.stderr.includes('private-device-token'));
  assert.equal(git(remote, 'rev-parse', 'refs/heads/feature'), accepted);
  const address = '192.168.1.100'.replace(/100$/, '42');
  git(root, 'tag', '-a', 'example', accepted, '-m', 'Service: ' + address);
  const tag = spawnSync('git', ['push', 'origin', 'refs/tags/example'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(tag.status, 0);
  assert.match(tag.stderr, /非示例内网地址/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), base);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'Example: http://192.168.1.100:5368\n');
}));
