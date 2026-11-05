import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { scanPublicText } from './public-files.mjs';

const sha = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const zero = value => /^0+$/.test(value);
const git = (root, args, options = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });

export function commitsForUpdates(root, updates, remote) {
  const commits = new Set();
  const known = git(root, ['for-each-ref', '--format=%(objectname)', `refs/remotes/${remote}/`]).trim().split('\n').filter(Boolean);
  for (const line of updates.trim().split('\n').filter(Boolean)) {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localRef || !remoteRef || !sha.test(localSha) || !sha.test(remoteSha)) throw new Error('无法解析待推送的 Git 引用');
    if (zero(localSha)) continue;
    const exclusions = [...known, ...(!zero(remoteSha) ? [remoteSha] : [])];
    for (const commit of git(root, ['rev-list', '--reverse', localSha, '--not', ...exclusions]).trim().split('\n').filter(Boolean)) commits.add(commit);
  }
  return [...commits];
}

export function checkCommits(root, commits) {
  const issues = [], blobs = new Set();
  for (const commit of commits) {
    if (!sha.test(commit)) throw new Error('无效的提交编号');
    const message = git(root, ['show', '-s', '--format=%B', commit]);
    issues.push(...scanPublicText('COMMIT_MESSAGE.txt', message).map(issue => ({ ...issue, commit })));
    const files = git(root, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean);
    for (const row of files) {
      const separator = row.indexOf('\t');
      const metadata = row.slice(0, separator), file = row.slice(separator + 1);
      const [mode, kind, object] = metadata.split(' ');
      if (kind !== 'blob' || mode === '120000') { issues.push({ file, line: 0, reason: '提交包含外部仓库或符号链接', commit }); continue; }
      const key = `${file}:${object}`;
      if (blobs.has(key)) continue;
      blobs.add(key);
      issues.push(...scanPublicText(file, git(root, ['cat-file', 'blob', object])).map(issue => ({ ...issue, commit })));
    }
  }
  return issues;
}

function main() {
  const root = process.cwd();
  let commits, tagIssues = [];
  if (process.argv[2] === '--current') commits = [git(root, ['rev-parse', 'HEAD']).trim()];
  else if (process.argv[2] === '--ci') {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const head = event.pull_request?.head.sha || event.after || git(root, ['rev-parse', 'HEAD']).trim();
    const base = event.pull_request?.base.sha || event.before;
    if (!sha.test(head) || base && !sha.test(base)) throw new Error('无效的自动检查提交范围');
    commits = base && !zero(base) ? git(root, ['rev-list', '--reverse', head, '--not', base]).trim().split('\n').filter(Boolean) : [head];
  } else {
    const updates = fs.readFileSync(0, 'utf8');
    commits = commitsForUpdates(root, updates, process.argv[2] || 'origin');
    for (const line of updates.trim().split('\n').filter(Boolean)) {
      const object = line.trim().split(/\s+/)[1];
      if (!zero(object) && git(root, ['cat-file', '-t', object]).trim() === 'tag') {
        tagIssues.push(...scanPublicText('TAG_MESSAGE.txt', git(root, ['cat-file', 'tag', object])).map(issue => ({ ...issue, commit: object })));
      }
    }
  }
  const issues = [...checkCommits(root, commits), ...tagIssues];
  for (const issue of issues) console.error(`${issue.commit.slice(0,7)} ${issue.file}:${issue.line} ${issue.reason}`);
  if (issues.length) { console.error('推送检查未通过：请将个人配置改为公开示例，并从待推送提交中移除私人资料。'); process.exitCode = 1; }
  else console.log(`PASS 推送检查：${commits.length} 个提交，不含非示例内网地址、私人资料或疑似凭证。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) { console.error(`推送检查无法完成：${error.message}`); process.exitCode = 1; }
}
