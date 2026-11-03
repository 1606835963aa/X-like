import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const directory = 'node_modules/temp';
if (existsSync(directory)) {
  const pkg = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'));
  if (pkg.version !== '0.9.4') throw new Error('临时文件工具版本变化，请先核对构建兼容性');
  const file = `${directory}/lib/temp.js`;
  const original = "let rimraf     = require('rimraf');";
  const compatible = `const rimrafApi = require('rimraf');
const rimraf = Object.assign((target, options, callback) => {
  rimrafApi.rimraf(target, { maxRetries: options.maxBusyTries, glob: false }).then(() => callback(null), callback);
}, { sync: (target, options) => rimrafApi.rimrafSync(target, { maxRetries: options.maxBusyTries, glob: false }) });`;
  const source = readFileSync(file, 'utf8');
  if (!source.includes(compatible)) {
    if (!source.includes(original)) throw new Error('临时文件工具内容变化，请先核对构建兼容性');
    writeFileSync(file, source.replace(original, compatible));
  }
}
