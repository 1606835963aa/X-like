import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startService } from '../src/server/service';

mkdirSync('tmp', { recursive: true });

test('中文及空格路径下的桌面界面正确返回脚本、样式和图标，缺失页面回到入口', async () => {
  const directory = mkdtempSync(resolve('tmp/ui-serving-'));
  const uiDir = join(directory, '中文 界面');
  mkdirSync(join(uiDir, 'assets'), { recursive: true });
  const files = [
    ['index.html', '<html>桌面入口</html>', 'text/html'],
    ['assets/app.js', 'window.desktopLoaded = true;', 'application/javascript'],
    ['assets/app.css', 'body { color: blue; }', 'text/css'],
    ['icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
    ['assets/中文 图标.svg', '<svg>中文图标</svg>', 'image/svg+xml'],
  ];
  for (const [name, content] of files) writeFileSync(join(uiDir, name), content);
  const service = await startService({ dataDir: join(directory, '资料库'), uiDir });
  try {
    const base = `http://127.0.0.1:${service.port}`;
    for (const [name, content, type] of files) {
      const response = await fetch(base + '/' + name.split('/').map(encodeURIComponent).join('/'));
      assert.equal(response.status, 200, name);
      assert.ok(response.headers.get('content-type')?.startsWith(type), `${name} 的类型应为 ${type}`);
      assert.equal(await response.text(), content, name);
    }
    for (const route of ['/', '/library/missing']) {
      const response = await fetch(base + route);
      assert.equal(await response.text(), files[0][1]);
    }
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('界面资源请求不能越过界面目录或读取同名前缀的相邻目录', async () => {
  const directory = mkdtempSync(resolve('tmp/ui-boundary-'));
  const uiDir = join(directory, 'ui'), sibling = join(directory, 'ui-outside');
  mkdirSync(uiDir); mkdirSync(sibling);
  writeFileSync(join(uiDir, 'index.html'), '<html>桌面入口</html>');
  writeFileSync(join(sibling, 'secret.js'), 'outside-file');
  const service = await startService({ dataDir: join(directory, 'data'), uiDir });
  try {
    for (const separator of ['%2F', '%5C']) {
      const response = await fetch(`http://127.0.0.1:${service.port}/..${separator}ui-outside${separator}secret.js`);
      assert.equal(await response.text(), '<html>桌面入口</html>');
    }
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
