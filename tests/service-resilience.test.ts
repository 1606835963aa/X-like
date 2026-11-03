import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function isolatedService(t: TestContext) {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(resolve('tmp/request-resilience-'));
  const child = fork(fileURLToPath(new URL('./fixtures/service-process.ts', import.meta.url)), [directory], {
    execArgv: ['--import', 'tsx'], silent: true,
  });
  let diagnostic = '';
  child.stderr?.on('data', chunk => { diagnostic += String(chunk).slice(0, 4000); });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  const port = await new Promise<number>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试服务启动超时')), 15000);
    child.once('message', (message: any) => { clearTimeout(timeout); done(message.port); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('测试服务提前退出：' + diagnostic)); });
  });
  return {
    port,
    async healthy() {
      assert.equal(child.exitCode, null, diagnostic);
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    },
  };
}

function exchange(port: number, request: string, endEarly = false) {
  return new Promise<string>((done, reject) => {
    let response = '';
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      if (endEarly) socket.end(request); else socket.write(request);
    });
    socket.setTimeout(5000, () => socket.destroy(new Error('测试请求响应超时')));
    socket.on('data', chunk => { response += chunk.toString(); });
    socket.once('error', reject);
    socket.once('close', () => done(response));
  });
}

test('畸形网址只拒绝当前请求，不让独立资料库进程退出', async t => {
  const service = await isolatedService(t);
  for (const target of ['http://[', 'http://%zz', '//[']) {
    const response = await exchange(service.port, `GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    assert.match(response, /^HTTP\/1\.1 400 /, target);
    assert.ok(response.includes('请求地址格式不正确'), target);
    await service.healthy();
  }
});

test('非法请求头和超长请求头被拒绝后，资料库继续提供服务', async t => {
  const service = await isolatedService(t);
  for (const [header, status] of [['Bad Header: value', 400], ['X-Oversized: ' + 'a'.repeat(20000), 431]] as const) {
    const response = await exchange(service.port, `GET /api/health HTTP/1.1\r\nHost: localhost\r\n${header}\r\nConnection: close\r\n\r\n`);
    assert.match(response, new RegExp(`^HTTP/1\\.1 ${status} `));
    await service.healthy();
  }
});

test('无效 JSON 和发送一半后断开的请求不会中止资料库', async t => {
  const service = await isolatedService(t);
  const response = await fetch(`http://127.0.0.1:${service.port}/api/pair`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{', signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 400);
  await response.arrayBuffer();
  await service.healthy();
  await exchange(service.port, 'POST /api/pair HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{', true);
  await service.healthy();
});
