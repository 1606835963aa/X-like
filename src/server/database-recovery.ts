import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DATABASE_VERSION = 2;

export class DatabaseRecoveryError extends Error {
  constructor(message: string, readonly code: string, readonly backupFile?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseRecoveryError';
  }
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8); }

export function snapshotBeforeUpgrade(db: DatabaseSync, filename: string): string {
  const directory = join(dirname(filename), 'backups');
  const backupFile = join(directory, `library-before-v${DATABASE_VERSION}-${stamp()}.sqlite`);
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    db.prepare('VACUUM INTO ?').run(backupFile);
    chmodSync(backupFile, 0o600);
    inspectBackup(backupFile);
    return backupFile;
  } catch (cause) {
    try { rmSync(backupFile, { force: true }); } catch {}
    throw new DatabaseRecoveryError('无法创建升级前备份，资料库未升级。请检查磁盘空间和备份目录权限。', 'DATABASE_BACKUP_FAILED', undefined, { cause });
  }
}

export function inspectBackup(filename: string): { version: number; posts: number } {
  if (!lstatSync(filename).isFile()) throw new Error('请选择 SQLite 资料库文件');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const check = db.prepare('PRAGMA quick_check').all();
    if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') throw new Error('备份文件校验失败');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (!['posts', 'sources', 'accounts', 'devices', 'settings', 'jobs'].every(name => tables.has(name))) throw new Error('这个文件不是完整的拾藏资料库');
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > DATABASE_VERSION) throw new DatabaseRecoveryError('这份资料库由更新版本创建，请使用较新的拾藏打开。', 'DATABASE_TOO_NEW');
    return { version, posts: Number(db.prepare('SELECT COUNT(*) AS count FROM posts').get()!.count) };
  } finally { db.close(); }
}

export function listUpgradeBackups(dataDir: string): string[] {
  const directory = join(dataDir, 'backups');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => /^library-before-v\d+-[\w-]+\.sqlite$/.test(name))
    .filter(name => lstatSync(join(directory, name)).isFile()).sort().reverse().map(name => join(directory, name));
}

export function restoreDatabase(dataDir: string, backupFile: string): { previousDirectory: string | null; posts: number } {
  const info = inspectBackup(backupFile);
  const filename = join(resolve(dataDir), 'library.sqlite');
  if (resolve(backupFile) === filename) throw new Error('请选择另一份备份文件');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const staged = join(dataDir, `.library-restore-${randomUUID()}.sqlite`);
  const previousDirectory = join(dataDir, 'backups', `before-restore-${stamp()}`);
  const moved: { from: string; to: string }[] = [];
  try {
    const source = new DatabaseSync(backupFile, { readOnly: true });
    try { source.prepare('VACUUM INTO ?').run(staged); } finally { source.close(); }
    chmodSync(staged, 0o600);
    inspectBackup(staged);
    const files = ['', '-wal', '-shm'].map(suffix => filename + suffix).filter(file => existsSync(file));
    if (files.length) mkdirSync(previousDirectory, { recursive: true, mode: 0o700 });
    for (const from of files) {
      if (!lstatSync(from).isFile()) throw new Error('资料库路径不是普通文件，无法恢复');
      const to = join(previousDirectory, basename(from));
      renameSync(from, to); moved.push({ from, to });
    }
    renameSync(staged, filename);
    return { previousDirectory: files.length ? previousDirectory : null, posts: info.posts };
  } catch (error) {
    for (const { from, to } of moved.reverse()) renameSync(to, from);
    throw error;
  } finally { rmSync(staged, { force: true }); }
}
