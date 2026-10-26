import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LibraryConnections, validConnection } from '../src/desktop/connections';
import { startService } from '../src/server/service';
import type { Connection } from '../src/shared/types';

mkdirSync(resolve('tmp'), { recursive: true });
const local:Connection={url:'http://127.0.0.1:10001',token:'test-local-device-token',name:'本机资料库',local:true};
const remote:Connection={url:'http://192.0.2.50:5368',token:'test-remote-device-token',name:'我的共享资料库'};
const secret=randomBytes(32);
const encryption={
  isEncryptionAvailable:()=>true,
  encryptString(text:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);},
  decryptString(data:Buffer){const decipher=createDecipheriv('aes-256-gcm',secret,data.subarray(0,12));decipher.setAuthTag(data.subarray(-16));return Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]).toString('utf8');},
};
function fixture(run:(dir:string)=>void){const dir=mkdtempSync(resolve('tmp/connections-'));try{run(dir);}finally{rmSync(dir,{recursive:true,force:true});}}

test('全新安装直接使用本机资料库，不需要远程地址或连接文件',()=>fixture(dir=>{
  const connections=new LibraryConnections(dir,local,encryption);
  assert.deepEqual(connections.current(),local);assert.equal(connections.savedRemote(),null);
  assert.equal(existsSync(join(dir,'connection.enc')),false);
}));

test('本机与远程往返切换保留加密连接，重启记住当前资料库并使用新的本机端口',()=>fixture(dir=>{
  let connections=new LibraryConnections(dir,local,encryption);
  assert.deepEqual(connections.select(remote),validConnection(remote));
  const encrypted=readFileSync(join(dir,'connection.enc'));
  assert.equal(encrypted.includes(Buffer.from(remote.token)),false);assert.equal(encrypted.includes(Buffer.from(remote.url)),false);
  connections.select(null);assert.deepEqual(readFileSync(join(dir,'connection.enc')),encrypted);
  const nextLocal={...local,url:'http://127.0.0.1:10002'};
  connections=new LibraryConnections(dir,nextLocal,encryption);
  assert.deepEqual(connections.current(),nextLocal);assert.deepEqual(connections.savedRemote(),validConnection(remote));
  connections.select(connections.savedRemote());
  assert.deepEqual(new LibraryConnections(dir,nextLocal,encryption).current(),validConnection(remote));
}));

test('已有远程连接升级后保持当前选择，不要求再次填写地址和连接码',()=>fixture(dir=>{
  writeFileSync(join(dir,'connection.enc'),encryption.encryptString(JSON.stringify(remote)));
  const connections=new LibraryConnections(dir,local,encryption);
  assert.deepEqual(connections.current(),validConnection(remote));assert.deepEqual(connections.savedRemote(),validConnection(remote));
}));

test('过期的本机端口和损坏的连接文件不会妨碍本机资料库启动',()=>fixture(dir=>{
  writeFileSync(join(dir,'connection.enc'),encryption.encryptString(JSON.stringify({...local,url:'http://127.0.0.1:9'})));
  let connections=new LibraryConnections(dir,local,encryption);assert.deepEqual(connections.current(),local);assert.equal(connections.savedRemote(),null);
  writeFileSync(join(dir,'connection.enc'),'broken');
  connections=new LibraryConnections(dir,local,encryption);assert.deepEqual(connections.current(),local);assert.equal(connections.savedRemote(),null);
  assert.equal(readFileSync(join(dir,'connection.enc'),'utf8'),'broken');
}));

test('无法加密连接时本机仍可使用，远程保存失败不会切换当前资料库',()=>fixture(dir=>{
  const connections=new LibraryConnections(dir,local,{...encryption,isEncryptionAvailable:()=>false});
  assert.deepEqual(connections.current(),local);assert.throws(()=>connections.select(remote),/无法加密保存/);
  assert.deepEqual(connections.current(),local);assert.equal(connections.savedRemote(),null);
  assert.equal(existsSync(join(dir,'connection.enc')),false);
}));

test('无效连接不会覆盖已保存的远程凭证，读取连接返回独立副本',()=>fixture(dir=>{
  const connections=new LibraryConnections(dir,local,encryption);connections.select(remote);connections.select(null);
  const encrypted=readFileSync(join(dir,'connection.enc'));
  for(const invalid of [{...remote,url:'file:///tmp/library'},{...remote,url:'http://user:pass@example.org'},{...remote,token:'short'}])assert.throws(()=>connections.select(invalid));
  assert.deepEqual(connections.current(),local);assert.deepEqual(readFileSync(join(dir,'connection.enc')),encrypted);
  const copied=connections.savedRemote()!;copied.token='changed';assert.equal(connections.savedRemote()!.token,remote.token);
  assert.equal(validConnection({...remote,url:remote.url+'/path?x=1'}).url,remote.url);
}));

test('没有 NAS 的两份资料库可独立保存和一键切换，服务重启后原连接仍可使用',async()=>{
  const dir=mkdtempSync(resolve('tmp/local-remote-'));
  let localService:Awaited<ReturnType<typeof startService>>|undefined,remoteService:Awaited<ReturnType<typeof startService>>|undefined;
  try{
    localService=await startService({dataDir:join(dir,'local')});remoteService=await startService({dataDir:join(dir,'shared')});
    const localConnection={...local,url:`http://127.0.0.1:${localService.port}`,token:localService.createDevice('本机测试')};
    const remoteConnection={url:`http://127.0.0.1:${remoteService.port}`,token:remoteService.createDevice('普通电脑共享测试'),name:'普通电脑共享资料库'};
    let connections=new LibraryConnections(join(dir,'profile'),localConnection,encryption);
    const request=async(path:string,body?:unknown)=>{
      const c=connections.current();const response=await fetch(c.url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      assert.equal(response.status,200);return response.json();
    };
    const data=(id:string,text:string)=>({filename:'posts.json',source:'bookmark',content:JSON.stringify([{id,text,author:'test',authorName:'演示作者',publishedAt:null,url:`https://x.com/test/status/${id}`,media:[]}])});
    await request('/api/import',data('1001','本机独立资料 #本地'));
    connections.select(remoteConnection);await request('/api/import',data('2001','远程独立资料 #共享'));
    assert.deepEqual((await request('/api/posts')).items.map((p:{id:string})=>p.id),['2001']);
    connections.select(null);assert.equal((await request('/api/posts?q='+encodeURIComponent('本机'))).total,1);
    assert.equal((await request('/api/posts?q='+encodeURIComponent('远程'))).total,0);
    await localService.close();localService=undefined;await remoteService.close();remoteService=undefined;
    localService=await startService({dataDir:join(dir,'local')});
    connections=new LibraryConnections(join(dir,'profile'),{...localConnection,url:`http://127.0.0.1:${localService.port}`},encryption);
    assert.equal(connections.current().local,true);assert.equal((await request('/api/posts')).total,1);
    remoteService=await startService({dataDir:join(dir,'shared'),port:Number(new URL(remoteConnection.url).port)});
    connections.select(connections.savedRemote());assert.equal((await request('/api/posts?q='+encodeURIComponent('远程'))).total,1);
  }finally{await localService?.close();await remoteService?.close();rmSync(dir,{recursive:true,force:true});}
});
