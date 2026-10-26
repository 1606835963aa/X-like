import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { listUpgradeBackups, restoreDatabase } from './database-recovery';

try {
  const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, backup: { type: 'string' }, list: { type: 'boolean' } } });
  const directory = resolve(values['data-dir'] || process.env.SHIZANG_DATA_DIR || 'data');
  if (values.list) console.log(listUpgradeBackups(directory).join('\n') || '没有升级前备份');
  else {
    if (!values.backup) throw new Error('请先停止对应资料库，再指定 --data-dir 和 --backup；用 --list 查看升级前备份。');
    const result = restoreDatabase(directory, resolve(values.backup));
    console.log(`已恢复 ${result.posts} 条资料。${result.previousDirectory ? '\n恢复前的数据库保存在：' + result.previousDirectory : ''}`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : '恢复失败'); process.exitCode = 1; }
