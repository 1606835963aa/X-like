import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function publicFiles(root = process.cwd()) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const directories = /^(?:src|scripts|tests|docs|design|public|resources|android|ios|\.github)\//;
  const files = /^(?:README(?:\.[\w-]+)?\.md|LICENSE|index\.html|package(?:-lock)?\.json|tsconfig\.json|vite\.config\.ts|capacitor\.config\.ts|Dockerfile|compose(?:\.offline)?\.yaml|\.dockerignore|\.gitignore|\.gitattributes|\.node-version|\.env\.example)$/;
  return [...new Set(paths)].filter(name => (directories.test(name) || files.test(name)) && fs.existsSync(path.join(root, name))).sort();
}

export function scanPublicText(name, text) {
  const issues = [];
  const textFile = /\.(?:md|ts|tsx|mjs|js|json|ya?ml|xml|gradle|properties|swift|txt)$/.test(name) || ['Dockerfile', '.env.example'].includes(name);
  if (/\.(?:sqlite(?:-wal|-shm)?|db|keystore|p12|pfx|pem)$|(?:^|\/)\.env$/.test(name)) return [{ file: name, line: 0, reason: '私有资料或密钥文件' }];
  if (!textFile) return issues;
  for (const [index, line] of text.split('\n').entries()) {
    if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(line)) issues.push({ file: name, line: index + 1, reason: '疑似真实凭证' });
    if (!name.startsWith('tests/')) {
      if (/(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//.test(line) || /[A-Z]:\\Users\\[A-Za-z0-9._-]+\\/.test(line)) issues.push({ file: name, line: index + 1, reason: '个人绝对路径' });
      const addresses = line.match(/\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g) || [];
      if (addresses.some(address => address !== '192.168.1.100')) issues.push({ file: name, line: index + 1, reason: '非示例内网地址' });
    }
  }
  return issues;
}

export function checkPublicFiles(root = process.cwd()) {
  const files = publicFiles(root), issues = [];
  for (const file of files) {
    const fullPath = path.join(root, file);
    if (fs.lstatSync(fullPath).isSymbolicLink()) { issues.push({ file, line: 0, reason: '源码包不接收符号链接' }); continue; }
    issues.push(...scanPublicText(file, fs.readFileSync(fullPath, 'utf8')));
  }
  return { files, issues };
}
