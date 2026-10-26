import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Connection } from '../shared/types';

type ConnectionEncryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export function validConnection(value: unknown): Connection {
  if (!value || typeof value !== 'object') throw new Error('资料库连接不完整');
  const c = value as Record<string, unknown>;
  let url: URL;
  try { url = new URL(typeof c.url === 'string' ? c.url : ''); }
  catch { throw new Error('请输入资料库的 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入资料库的 HTTP 或 HTTPS 地址');
  if (typeof c.token !== 'string' || c.token.length < 20) throw new Error('连接凭证不完整');
  return { url: url.origin, token: c.token, name: typeof c.name === 'string' ? c.name.slice(0, 200) : undefined, local: c.local === true };
}

export class LibraryConnections {
  private readonly remoteFile: string;
  private readonly choiceFile: string;
  private remote: Connection | null = null;
  private useLocal = true;

  constructor(directory: string, private readonly local: Connection, private readonly encryption: ConnectionEncryption) {
    mkdirSync(directory, { recursive: true });
    this.remoteFile = join(directory, 'connection.enc');
    this.choiceFile = join(directory, 'library-mode');
    if (existsSync(this.remoteFile) && encryption.isEncryptionAvailable()) {
      try {
        const saved = validConnection(JSON.parse(encryption.decryptString(readFileSync(this.remoteFile))));
        const savedLocal = saved.local || (saved.name === '本机资料库' && new URL(saved.url).hostname === '127.0.0.1');
        if (!savedLocal) this.remote = saved;
      } catch {}
    }
    let mode = '';
    try { mode = readFileSync(this.choiceFile, 'utf8').trim(); } catch {}
    this.useLocal = mode === 'local' || !this.remote;
  }

  current(): Connection { return { ...(this.useLocal ? this.local : this.remote!) }; }
  savedRemote(): Connection | null { return this.remote ? { ...this.remote } : null; }

  select(value: Connection | null): Connection {
    if (!value || value.local) {
      writeFileSync(this.choiceFile, 'local', { mode: 0o600 });
      this.useLocal = true;
    } else {
      const remote = validConnection(value);
      if (!this.encryption.isEncryptionAvailable()) throw new Error('系统无法加密保存资料库连接');
      writeFileSync(this.remoteFile, this.encryption.encryptString(JSON.stringify(remote)), { mode: 0o600 });
      writeFileSync(this.choiceFile, 'remote', { mode: 0o600 });
      this.remote = remote;
      this.useLocal = false;
    }
    return this.current();
  }
}
