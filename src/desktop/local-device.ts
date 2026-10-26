import { existsSync, readFileSync, writeFileSync } from 'node:fs';

type LocalService = { store: { authorize(token: string): unknown }; createDevice(name: string): string };

export function localDeviceToken(filename: string, service: LocalService): string {
  const saved = existsSync(filename) ? readFileSync(filename, 'utf8') : '';
  if (saved && service.store.authorize(saved)) return saved;
  const token = service.createDevice('这台电脑');
  writeFileSync(filename, token, { mode: 0o600 });
  return token;
}
