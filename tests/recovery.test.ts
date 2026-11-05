import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../src/server/store';
import { DATABASE_VERSION, inspectBackup, listUpgradeBackups, restoreDatabase } from '../src/server/database-recovery';
import { startService } from '../src/server/service';
import { redactDiagnostic, startupExplanation, writeDiagnostic } from '../src/shared/diagnostics';
import { localDeviceToken } from '../src/desktop/local-device';
import { restoreLocalLibrary } from '../src/desktop/local-recovery';
import { LibraryConnections } from '../src/desktop/connections';

mkdirSync('tmp', { recursive: true });
function fixture(run: (directory: string) => void) {
  const directory = mkdtempSync(resolve('tmp/recovery-'));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
function seed(directory: string) {
  const store = new Store(join(directory, 'library.sqlite'));
  store.ingest([{id:'1001',text:'资料 #猫咪',author:'demo',authorName:'演示作者',publishedAt:null,url:'https://x.com/demo/status/1001',media:[]}], '42', 'bookmark');
  store.edit(['1001'], {tags:['分类'],note:'原有备注',pinned:true});
  store.addDevice('这台电脑', 'fixture-device-token');
  store.close();
}

test('升级前备份包含已提交 WAL 内容，升级和重启不丢整理信息及设备凭证', () => fixture(directory => {
  seed(directory);
  const legacy = new DatabaseSync(join(directory, 'library.sqlite'));
  legacy.exec("PRAGMA journal_mode=WAL; ALTER TABLE posts DROP COLUMN hashtags; PRAGMA user_version=1; UPDATE posts SET note='WAL 中已提交的备注'");
  const store = new Store(join(directory, 'library.sqlite'));
  try {
    assert.equal(listUpgradeBackups(directory).length, 1);
    const backup = store.upgradeBackup!;
    assert.deepEqual(inspectBackup(backup), {version:1,posts:1});
    const saved = new DatabaseSync(backup, {readOnly:true});
    try {
      assert.equal(saved.prepare('SELECT note FROM posts').get()!.note, 'WAL 中已提交的备注');
      assert.ok(!saved.prepare('PRAGMA table_info(posts)').all().some(column => column.name === 'hashtags'));
    } finally { saved.close(); }
    assert.deepEqual(store.getPost('1001')!.hashtags,['猫咪']);
    assert.deepEqual(store.getPost('1001')!.tags,['分类']);
    assert.ok(store.authorize('fixture-device-token'));
  } finally { store.close(); legacy.close(); }
  const reopened = new Store(join(directory,'library.sqlite'));reopened.close();
  assert.equal(listUpgradeBackups(directory).length,1);
}));

test('无法创建备份时不执行升级，原资料和旧结构保持完整', () => fixture(directory => {
  seed(directory);
  const filename=join(directory,'library.sqlite'), legacy=new DatabaseSync(filename);
  legacy.exec('ALTER TABLE posts DROP COLUMN hashtags; PRAGMA user_version=1');legacy.close();
  writeFileSync(join(directory,'backups'),'这个路径被普通文件占用');
  assert.throws(()=>new Store(filename),{code:'DATABASE_BACKUP_FAILED'});
  const original=new DatabaseSync(filename,{readOnly:true});
  try {
    assert.equal(original.prepare('PRAGMA user_version').get()!.user_version,1);
    assert.ok(!original.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='hashtags'));
    assert.equal(original.prepare('SELECT note FROM posts').get()!.note,'原有备注');
  } finally {original.close();}
}));

test('升级中途失败时回滚新增字段和内容，保留可读取的升级前备份', () => fixture(directory => {
  seed(directory);
  const filename=join(directory,'library.sqlite'), legacy=new DatabaseSync(filename);
  legacy.exec("ALTER TABLE posts DROP COLUMN hashtags; PRAGMA user_version=1; CREATE TRIGGER reject_migration BEFORE UPDATE ON posts BEGIN SELECT RAISE(ABORT,'升级写入失败'); END;");legacy.close();
  assert.throws(()=>new Store(filename),{code:'DATABASE_MIGRATION_FAILED'});
  const original=new DatabaseSync(filename,{readOnly:true});
  try {
    assert.equal(original.prepare('PRAGMA user_version').get()!.user_version,1);
    assert.ok(!original.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='hashtags'));
    assert.equal(original.prepare('SELECT note FROM posts').get()!.note,'原有备注');
  } finally {original.close();}
  assert.equal(inspectBackup(listUpgradeBackups(directory)[0]).posts,1);
}));

test('旧软件拒绝更高版本数据库，文件不被改写，也不生成降级备份', () => fixture(directory => {
  seed(directory);const filename=join(directory,'library.sqlite'), db=new DatabaseSync(filename);
  db.exec(`PRAGMA user_version=${DATABASE_VERSION+1}`);db.close();
  const before=readFileSync(filename);
  assert.throws(()=>new Store(filename),{code:'DATABASE_TOO_NEW'});
  assert.deepEqual(readFileSync(filename),before);
  assert.equal(listUpgradeBackups(directory).length,0);
}));

test('恢复损坏数据库时保留原文件和 WAL，媒体文件不变，恢复后凭证仍可用', () => fixture(directory => {
  const saved=join(directory,'saved'),target=join(directory,'target');mkdirSync(saved);mkdirSync(target);seed(saved);
  const database=join(target,'library.sqlite');writeFileSync(database,'损坏的数据库');writeFileSync(database+'-wal','旧 WAL');writeFileSync(database+'-shm','旧 SHM');
  mkdirSync(join(target,'media'));writeFileSync(join(target,'media','video.mp4'),'已保存视频');
  const restored=restoreDatabase(target,join(saved,'library.sqlite'));
  assert.equal(restored.posts,1);
  assert.equal(readFileSync(join(restored.previousDirectory!,'library.sqlite'),'utf8'),'损坏的数据库');
  assert.equal(readFileSync(join(restored.previousDirectory!,'library.sqlite-wal'),'utf8'),'旧 WAL');
  assert.equal(existsSync(database+'-wal'),false);
  assert.equal(readFileSync(join(target,'media','video.mp4'),'utf8'),'已保存视频');
  const store=new Store(database);
  try {assert.equal(store.getPost('1001')!.note,'原有备注');assert.ok(store.authorize('fixture-device-token'));} finally {store.close();}
}));

test('拒绝错误备份或当前数据库本身，不改动当前资料', () => fixture(directory => {
  seed(directory);const filename=join(directory,'library.sqlite'), before=readFileSync(filename),invalid=join(directory,'wrong.sqlite');writeFileSync(invalid,'不是数据库');
  assert.throws(()=>restoreDatabase(directory,invalid));
  assert.throws(()=>restoreDatabase(directory,filename),/另一份/);
  assert.deepEqual(readFileSync(filename),before);
}));

test('诊断日志隐藏地址、个人路径和凭证，并给出常见启动故障的操作说明', () => fixture(directory => {
  const error=Object.assign(new Error('connect https://example.org/private?token=hidden\nAuthorization: Bearer secret\n/Users/alice/private\nC:\\Users\\alice\\private'),{code:'EACCES'});
  const logfile=writeDiagnostic(directory,error,'test')!;
  const text=readFileSync(logfile,'utf8');
  for(const value of ['example.org','Bearer secret','alice'])assert.ok(!text.includes(value));
  assert.match(startupExplanation(error),/权限/);
  assert.match(startupExplanation({code:'ENOSPC'}),/空间/);
  assert.match(startupExplanation({code:'EADDRINUSE'}),/端口/);
  assert.equal(redactDiagnostic('ct0: hidden'),'ct0: [已隐藏]');
  const address='192.168.1.100';
  assert.ok(!redactDiagnostic('/home/alice/private '+address).includes('alice'));
  assert.ok(!redactDiagnostic('host '+address).includes(address));
}));

test('共享服务保留用户设置的目录权限，关闭可重复调用',async()=>{
  const directory=mkdtempSync(resolve('tmp/shared-permissions-'));
  try {
    if(process.platform!=='win32')chmodSync(directory,0o750);
    const service=await startService({dataDir:directory});
    if(process.platform!=='win32')assert.equal(statSync(directory).mode&0o777,0o750);
    await service.close();await service.close();
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('端口被占用时关闭已打开的数据库，释放端口后同一份资料可正常启动',async()=>{
  const directory=mkdtempSync(resolve('tmp/startup-port-'));
  const occupied=await startService({dataDir:join(directory,'one')});
  try {
    const dataDir=join(directory,'two');
    await assert.rejects(startService({dataDir,port:occupied.port}),{code:'EADDRINUSE'});
    const db=new DatabaseSync(join(dataDir,'library.sqlite'));
    try {assert.equal(db.prepare('PRAGMA journal_mode=DELETE').get()!.journal_mode,'delete');} finally {db.close();}
    await occupied.close();
    const recovered=await startService({dataDir,port:occupied.port});await recovered.close();
  } finally {await occupied.close();rmSync(directory,{recursive:true,force:true});}
});

test('恢复较旧备份后本机自动重新连接，已有有效凭证保持不变',async()=>{
  const directory=mkdtempSync(resolve('tmp/restore-local-device-'));
  const dataDir=join(directory,'library'),saved=join(directory,'saved');mkdirSync(saved);seed(saved);
  const tokenFile=join(directory,'local-device');let service=await startService({dataDir});
  try {
    const previous=localDeviceToken(tokenFile,service);
    assert.equal(localDeviceToken(tokenFile,service),previous);
    await service.close();restoreDatabase(dataDir,join(saved,'library.sqlite'));
    service=await startService({dataDir});
    const current=localDeviceToken(tokenFile,service);
    assert.notEqual(current,previous);assert.equal(readFileSync(tokenFile,'utf8'),current);
    const response=await fetch(`http://127.0.0.1:${service.port}/api/stats`,{headers:{Authorization:'Bearer '+current}});
    assert.equal(response.status,200);assert.equal((await response.json()).total,1);
  } finally {await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('恢复本机备份后显示本机资料，远程地址和凭证保持可切换',()=>fixture(directory=>{
  const saved=join(directory,'saved');mkdirSync(saved);seed(saved);
  const encryption={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString()};
  const local={url:'http://127.0.0.1:5368',token:'local-fixture-token-000000',local:true};
  const remote={url:'https://library.example.org',token:'remote-fixture-token-000000'};
  const connections=new LibraryConnections(directory,local,encryption);connections.select(remote);
  const encrypted=readFileSync(join(directory,'connection.enc'));
  restoreLocalLibrary(directory,join(saved,'library.sqlite'));
  const restored=new LibraryConnections(directory,local,encryption);
  assert.deepEqual(restored.current(),local);assert.equal(restored.savedRemote()!.url,remote.url);
  assert.deepEqual(readFileSync(join(directory,'connection.enc')),encrypted);
  assert.equal(restored.select(restored.savedRemote()).url,remote.url);
}));
