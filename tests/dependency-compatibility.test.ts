import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

test('Xcode 项目工具可使用修复后的 UUID 依赖解析、生成标识并重新读取项目',()=>{
  const xcode = require('xcode');
  const project = xcode.project('ios/App/App.xcodeproj/project.pbxproj');
  project.parseSync();
  const existing = new Set(project.allUuids());
  const generated = new Set<string>();
  for(let i=0;i<30;i++){
    const id=project.generateUuid();
    assert.match(id,/^[0-9A-F]{24}$/);
    assert.ok(!existing.has(id)&&!generated.has(id));
    generated.add(id);
  }
  const parser = require('xcode/lib/parser/pbxproj');
  const reparsed = parser.parse(project.writeSync());
  assert.deepEqual(reparsed.project.rootObject,project.hash.project.rootObject);
});

test('桌面打包工具能归档中文路径，并正确解包匹配的二进制文件',async()=>{
  mkdirSync('tmp',{recursive:true});
  const directory=mkdtempSync(resolve('tmp/asar-compatibility-'));
  try {
    const asar=require('@electron/asar');
    const source=join(directory,'input'),archive=join(directory,'app.asar');
    mkdirSync(join(source,'中文 空格'),{recursive:true});
    writeFileSync(join(source,'中文 空格','资料.txt'),'完整的中文资料');
    const binary=Buffer.from([0,1,255,2]);
    writeFileSync(join(source,'native.node'),binary);
    await asar.createPackageWithOptions(source,archive,{unpack:'**/*.node'});
    assert.equal(asar.extractFile(archive,'中文 空格/资料.txt').toString(),'完整的中文资料');
    assert.deepEqual(readFileSync(archive+'.unpacked/native.node'),binary);
    assert.deepEqual(asar.extractFile(archive,'native.node'),binary);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('构建文件列表和临时文件的回调、Promise 与同步清理保持可用',async()=>{
  mkdirSync('tmp',{recursive:true});
  const directory=mkdtempSync(resolve('tmp/build-matching-'));
  const temp=require('temp');
  try {
    mkdirSync(join(directory,'nested'));
    writeFileSync(join(directory,'保留.txt'),'included');
    writeFileSync(join(directory,'忽略.txt'),'excluded');
    writeFileSync(join(directory,'nested','深层.txt'),'nested');
    const {FileList}=require('filelist');
    const files=new FileList();
    files.include(join(directory,'*.txt')).exclude(join(directory,'忽略.txt'));
    assert.deepEqual(files.toArray(),[join(directory,'保留.txt')]);
    temp.track();
    const file=temp.openSync({dir:directory,prefix:'cleanup-'});
    closeSync(file.fd);
    const nested=temp.mkdirSync({dir:directory,prefix:'[cleanup-dir]-'});
    writeFileSync(join(nested,'资料.txt'),'temporary');
    const cleaned=await new Promise<any>((done,reject)=>temp.cleanup((error:Error|null,result:any)=>error?reject(error):done(result)));
    assert.equal(cleaned.files,1);
    assert.equal(cleaned.dirs,1);
    temp.mkdirSync({dir:directory});
    assert.equal((await temp.cleanup()).dirs,1);
    temp.mkdirSync({dir:directory});
    assert.equal(temp.cleanupSync().dirs,1);
  } finally {temp.track(false);rmSync(directory,{recursive:true,force:true});}
});
