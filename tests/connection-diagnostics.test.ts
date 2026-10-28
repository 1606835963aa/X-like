import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { redactDiagnostic } from '../src/shared/diagnostics';
import { writeConnectionDiagnostic } from '../src/shared/connection-diagnostics';

mkdirSync('tmp', { recursive: true });

test('诊断隐藏域名代理、IPv6 代理、JSON 凭证和媒体地址，保留错误码与连接模式',()=>{
  const raw = [
    'X connection: PROXY proxy.private.example:7890; SOCKS5 [fd00::12]:1080; HTTPS secure-proxy.example:443; DIRECT',
    'Library request: {"origin":"https://nas.private.example:8443","action":"检查资料库连接","status":503}',
    '{"auth_token":"private-cookie-value"}',
    'Authorization: Bearer private-bearer-value',
    '{"token":"private-device-value"}',
    'Media https://video.twimg.com/movie.mp4?signature=private-signature',
    'Load failure: ERR_CONNECTION_REFUSED; HTTP 503',
  ].join('\n');
  const result = redactDiagnostic(raw);
  for (const secret of ['proxy.private.example','fd00::12','secure-proxy.example','nas.private.example','private-cookie-value','private-bearer-value','private-device-value','private-signature']) assert.ok(!result.includes(secret),secret);
  for (const signal of ['PROXY','SOCKS5','HTTPS','DIRECT','ERR_CONNECTION_REFUSED','HTTP 503','检查资料库连接']) assert.ok(result.includes(signal),signal);
});

test('首次写连接日志时，已有日志和轮转日志也会脱敏，保留操作信息',()=>{
  const directory=mkdtempSync(resolve('tmp/private-connection-log-'));
  try {
    const filename=join(directory,'connection.log'),previous=join(directory,'connection.previous.log');
    writeFileSync(filename,'old X connection: PROXY home-proxy.example:7890; DIRECT\nold Library request: {"origin":"http://nas.private.example:5368","status":503}\n');
    writeFileSync(previous,'old Cookie: private-old-session\n');
    assert.equal(writeConnectionDiagnostic(directory,'Network listener enabled'),filename);
    const output=readFileSync(filename,'utf8'),old=readFileSync(previous,'utf8');
    assert.ok(!output.includes('home-proxy.example')&&!output.includes('nas.private.example'));
    assert.ok(!old.includes('private-old-session'));
    assert.ok(output.includes('Network listener enabled')&&output.includes('503')&&output.includes('DIRECT'));
    if(process.platform!=='win32')assert.equal(statSync(filename).mode&0o777,0o600);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('旧日志超出大小上限时只保留完整尾部记录，并轮转新日志',()=>{
  const directory=mkdtempSync(resolve('tmp/bounded-connection-log-'));
  try {
    const filename=join(directory,'connection.log');
    writeFileSync(filename,'partial-private-value'.repeat(70000)+'\nkept HTTP 429\n');
    writeConnectionDiagnostic(directory,'first');
    const output=readFileSync(filename,'utf8');
    assert.ok(!output.includes('partial-private-value'));
    assert.ok(output.includes('kept HTTP 429')&&output.includes('first'));
    writeFileSync(filename,('safe record\n').repeat(90000));
    writeConnectionDiagnostic(directory,'second');
    assert.ok(readFileSync(filename,'utf8').includes('second'));
    assert.ok(statSync(join(directory,'connection.previous.log')).size>1024*1024);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
