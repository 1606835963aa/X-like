import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loginNavigation } from '../src/desktop/login-policy';
import { APP_VERSION } from '../src/shared/version';
import { startService } from '../src/server/service';

mkdirSync('tmp',{recursive:true});

test('登录支持 X 与 Apple 页面和空白弹窗，拒绝伪装域名及非网页协议',()=>{
  for(const url of ['https://x.com/i/flow/login','https://api.x.com/a','https://twitter.com/a','https://appleid.apple.com/auth/authorize','https://idmsa.apple.com/a','about:blank'])assert.equal(loginNavigation(url),'allow');
  for(const url of ['https://x.com.evil.example/a','https://evilx.com','https://accounts.google.com.evil.example','https://appleid.apple.com.evil.example','http://x.com','https://x.com:444','https://user:password@x.com','file:///tmp/x','javascript:alert(1)','data:text/html,test'])assert.equal(loginNavigation(url),'deny');
  assert.equal(loginNavigation('https://accounts.google.com/o/oauth2/auth'),'google');
});

test('共享服务配置读取资料目录拥有者，保留现有设置并拒绝无效端口',async()=>{
  const {configureShared}=await import(new URL('../scripts/setup-shared.mjs',import.meta.url).href);
  const directory=mkdtempSync(resolve('tmp/shared-config-'));
  try {
    const data=join(directory,'中文 空格资料');mkdirSync(data);
    writeFileSync(join(directory,'.env'),'# 部署配置\nSHIZANG_DATA_PATH="./中文 空格资料"\nSHIZANG_PORT=5369\nCUSTOM_VALUE=keep\n');
    const result=configureShared(directory,{});
    if(process.platform!=='win32')assert.equal(result.uid,String(statSync(data).uid));
    assert.equal(result.dataDir,data);assert.equal(result.port,'5369');
    assert.match(readFileSync(join(directory,'.env'),'utf8'),/CUSTOM_VALUE=keep/);
    assert.equal(configureShared(directory,{}).dataDir,data);
    assert.throws(()=>configureShared(directory,{SHIZANG_PORT:'70000'}),/端口/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('发布检查识别凭证和个人部署信息，保留公开示例与模拟测试',async()=>{
  const {scanPublicText}=await import(new URL('../scripts/public-files.mjs',import.meta.url).href);
  assert.ok(scanPublicText('README.md','http://'+['192','168','21','10'].join('.')).length);
  assert.equal(scanPublicText('README.md','http://192.168.1.100:5368').length,0);
  assert.ok(scanPublicText('src/config.ts','token='+('ghp_'+'a'.repeat(40))).length);
  assert.ok(scanPublicText('src/library.sqlite','').length);
  assert.equal(scanPublicText('tests/example.test.ts','http://'+['10','2','3','4'].join('.')).length,0);
});

test('服务健康接口与桌面使用相同的应用版本',async()=>{
  const directory=mkdtempSync(resolve('tmp/release-version-'));
  const service=await startService({dataDir:directory});
  try {assert.equal((await(await fetch(`http://127.0.0.1:${service.port}/api/health`)).json()).version,APP_VERSION);}
  finally {await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('无 Git 历史的源码目录独立检查反馈文档，不借用上级仓库或遗漏敏感文件',async()=>{
  const {checkPublicFiles,hasProjectHistory}=await import(new URL('../scripts/public-files.mjs',import.meta.url).href);
  const directory=mkdtempSync(resolve('tmp/source-inventory-'));
  try {
    mkdirSync(join(directory,'src'));mkdirSync(join(directory,'node_modules'));
    writeFileSync(join(directory,'SECURITY.md'),'安全反馈');
    writeFileSync(join(directory,'CONTRIBUTING.md'),'贡献说明');
    writeFileSync(join(directory,'src','config.ts'),'const url="http://'+['10','2','3','4'].join('.')+'";');
    writeFileSync(join(directory,'src','.DS_Store'),'private Finder metadata');
    writeFileSync(join(directory,'src','._config.ts'),'private AppleDouble metadata');
    writeFileSync(join(directory,'node_modules','private.ts'),'token='+('ghp_'+'a'.repeat(40)));
    assert.equal(hasProjectHistory(directory),false);
    const result=checkPublicFiles(directory);
    assert.deepEqual(result.files,['CONTRIBUTING.md','SECURITY.md','src/config.ts']);
    assert.equal(result.issues.length,1);
    assert.equal(result.issues[0].file,'src/config.ts');
    writeFileSync(join(directory,'.git'),'invalid repository metadata');
    assert.throws(()=>checkPublicFiles(directory),/无法读取.*Git 历史/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
