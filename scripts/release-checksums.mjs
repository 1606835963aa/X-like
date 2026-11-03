import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const directory = pkg.build.directories.output;
const names = [
  `Shizang-${pkg.version}-macOS-arm64.zip`,
  `Shizang-${pkg.version}-Windows-x64.exe`,
  `Shizang-${pkg.version}-source.tar.gz`,
];
for (const name of names) {
  if (!existsSync(join(directory, name))) throw new Error(`缺少同版本发行文件：${name}`);
}
const lines = [];
for (const name of names) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
const destination = join(directory, `SHA256SUMS-${pkg.version}.txt`);
writeFileSync(destination, lines.join('\n') + '\n');
console.log(`已生成 Mac、Windows 和源码包的统一校验文件：${destination}`);
