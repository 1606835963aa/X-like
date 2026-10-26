import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const dependencies = ['react', 'react-dom', 'scheduler', 'lucide-react', '@capacitor/core', '@capacitor/filesystem', '@capacitor/preferences', '@capacitor/share', 'electron'];

export function prepareLegal(destination) {
  const sections = ['拾藏 / Shizang — Third-party notices', 'Chromium notices accompany desktop distributions in LICENSES.chromium.html.'];
  for (const name of dependencies) {
    const directory = join('node_modules', name);
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].map(file => join(directory, file)).find(existsSync);
    if (!license) throw new Error(`找不到 ${name} 的许可文件`);
    sections.push(`${name} ${pkg.version} (${pkg.license})\n${readFileSync(license, 'utf8')}`);
  }
  mkdirSync(destination, { recursive: true });
  copyFileSync('LICENSE', join(destination, 'LICENSE.txt'));
  rmSync(join(destination, 'LICENSES.chromium.html'), { force: true });
  writeFileSync(join(destination, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
}

export function prepareDesktopLegal(destination) {
  const chromium = 'node_modules/electron/dist/LICENSES.chromium.html';
  if (!existsSync(chromium)) throw new Error('Electron 运行时尚未下载。请取消 ELECTRON_SKIP_BINARY_DOWNLOAD，运行 node node_modules/electron/install.js 后再打包桌面程序。');
  prepareLegal(destination);
  copyFileSync(chromium, join(destination, 'LICENSES.chromium.html'));
}
