import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { restoreDatabase } from '../server/database-recovery';

export function restoreLocalLibrary(profile: string, backup: string) {
  const result = restoreDatabase(join(profile, 'library'), backup);
  writeFileSync(join(profile, 'library-mode'), 'local', { mode: 0o600 });
  return result;
}
