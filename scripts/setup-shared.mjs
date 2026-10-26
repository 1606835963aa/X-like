import fs from 'node:fs';
import path from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';

export function configureShared(root = process.cwd(), overrides = process.env) {
  const filename = path.join(root, '.env');
  const existing = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
  const saved = Object.fromEntries(existing.split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [];
  }));
  const value = key => overrides[key] || saved[key];
  const relative = value('SHIZANG_DATA_PATH') || './data';
  if (/[\r\n]/.test(relative)) throw new Error('资料目录路径包含换行');
  const dataDir = path.resolve(root, relative);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const owner = fs.statSync(dataDir), account = userInfo();
  const uid = value('SHIZANG_UID') || String(process.platform === 'win32' ? 1000 : owner.uid ?? account.uid);
  const gid = value('SHIZANG_GID') || String(process.platform === 'win32' ? 1000 : owner.gid ?? account.gid);
  if (![uid, gid].every(id => /^\d+$/.test(id) && Number(id) <= 2147483647)) throw new Error('运行用户和组必须为有效的数字编号');
  const port = value('SHIZANG_PORT') || '5368';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('服务端口必须在 1–65535 之间');
  const bind = value('SHIZANG_BIND') || '0.0.0.0';
  if (!/^[\d.]+$/.test(bind)) throw new Error('监听地址请填写 IPv4 地址');
  const version = value('SHIZANG_VERSION') || 'local';
  if (!/^[\w.-]+$/.test(version)) throw new Error('镜像版本格式不正确');
  const entries = { SHIZANG_UID: uid, SHIZANG_GID: gid, SHIZANG_PORT: port, SHIZANG_BIND: bind, SHIZANG_DATA_PATH: JSON.stringify(relative), SHIZANG_VERSION: version };
  let text = existing.trimEnd();
  for (const [key, entry] of Object.entries(entries)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, () => `${key}=${entry}`) : text + (text ? '\n' : '') + `${key}=${entry}`;
  }
  fs.writeFileSync(filename, text + '\n', { mode: 0o600 });
  return { dataDir, uid, gid, port, filename };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = configureShared();
    console.log(`共享资料库配置已保存：${result.filename}\n资料目录：${result.dataDir}\n运行用户：${result.uid}:${result.gid}\n端口：${result.port}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
