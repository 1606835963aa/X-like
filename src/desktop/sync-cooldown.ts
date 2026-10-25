import { readFileSync, writeFileSync } from 'node:fs';
import { XSyncBlocked } from './sync-policy';

export class SyncCooldown {
  private until: Record<string, number> = {};
  constructor(private file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      for (const [account, value] of Object.entries(raw ?? {})) {
        if (/^\d+$/.test(account) && typeof value === 'number' && Number.isFinite(value)) this.until[account] = value;
      }
    } catch {}
  }
  check(account: string, now = Date.now()) {
    const until = this.until[account] ?? 0;
    if (until > now) throw new XSyncBlocked(`X 请求频率受限，已暂停同步至 ${new Date(until).toLocaleString('zh-CN')}。届时请手动同步。`, 'rate-limit', until);
  }
  record(account: string, until: number) {
    this.until[account] = Math.max(this.until[account] ?? 0, until);
    writeFileSync(this.file, JSON.stringify(this.until), { mode: 0o600 });
  }
}
