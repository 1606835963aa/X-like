import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function redactDiagnostic(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, '[地址已隐藏]')
    .replace(/((?:authorization|cookie|set-cookie|auth_token|ct0|pairing[-_ ]?key|(?:device|access|session)[-_ ]?token|password)\s*[=:]\s*)[^\r\n]+/gi, '$1[已隐藏]')
    .replace(/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, '[凭证已隐藏]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP 已隐藏]')
    .replace(/\/(Users|home)\/[^/\s]+/g, '/$1/[用户]').replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, 'C:\\Users\\[用户]');
}

export function startupExplanation(error: unknown): string {
  const e = error as { code?: string; message?: string; errcode?: number };
  if (e?.code?.startsWith('DATABASE_')) return e.message || '资料库无法打开';
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return '资料目录无法写入。请检查目录权限；共享服务请确认运行用户与资料目录的拥有者一致。';
  if (e?.code === 'ENOSPC') return '磁盘空间不足。请清理空间后重试，已有资料会保留。';
  if (e?.code === 'EADDRINUSE') return '服务端口已被占用。请停止占用该端口的服务，或更改 PORT 后重试。';
  if (e?.errcode === 11 || e?.errcode === 26 || /malformed|not a database/i.test(e?.message || '')) return '资料库文件无法读取。可以从升级前备份恢复，当前文件会另外保留。';
  return '拾藏未能完成启动。请查看启动日志，修复后重试，或从资料库备份恢复。';
}

export function writeDiagnostic(directory: string, error: unknown, version: string): string | null {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = join(directory, 'startup.log');
    if (existsSync(filename) && statSync(filename).size > 1024 * 1024) renameSync(filename, join(directory, 'startup.previous.log'));
    const details: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current && depth < 3; depth++) {
      const e = current as Error & { code?: string; cause?: unknown };
      details.push(`[${e.code || e.name || 'Error'}] ${e.stack || String(current)}`);
      current = e.cause;
    }
    appendFileSync(filename, `${new Date().toISOString()} 拾藏 ${version} ${process.platform}/${process.arch}\n${redactDiagnostic(details.join('\nCaused by: ')).slice(0, 20000)}\n`, { mode: 0o600 });
    return filename;
  } catch { return null; }
}
