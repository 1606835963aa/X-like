import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
