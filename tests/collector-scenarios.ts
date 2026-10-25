import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Collector } from '../src/desktop/collector';
import { readXResponse } from '../src/desktop/sync-policy';
import { startService } from '../src/server/service';
import type { Source, SyncState } from '../src/shared/types';

const work = process.env.SHIZANG_TEST_DIR!;
assert.ok(work);
app.setPath('userData', work);
const page = (id: string, cursor?: string) => ({ data: { timeline: { instructions: [{ entries: [
  { content: { itemContent: { tweet_results: { result: { rest_id: id, legacy: { full_text: '同步测试资料' } } } } } },
  ...(cursor ? [{ content: { cursorType: 'Bottom', value: cursor } }] : [])
] }] } } });
let exitCode = 0;
void app.whenReady().then(async () => {
  mkdirSync(join(work, 'library'), { recursive: true });
  const service = await startService({ dataDir: join(work, 'library') });
  const connection = { url: `http://127.0.0.1:${service.port}`, token: service.createDevice('同步逻辑测试') };
  try {
    for (const [index, status] of [401, 403, 429].entries()) {
      const account = { id: String(100 + index), handle: 'test', name: '测试' };
      const states: SyncState[] = [], reads: Source[] = []; let nextReads = 0;
      const collector = new Collector(state => states.push(state));
      collector.status = async () => { collector.account = account; return { connected: true, account }; };
      (collector as any).first = async (source: Source) => { reads.push(source); return { template: {}, json: page(String(1000 + index), 'next') }; };
      (collector as any).replay = async () => { nextReads++; return readXResponse(status, '{}', '3600'); };
      await collector.sync({ connection, sources: ['bookmark', 'like'], mode: 'recent' });
      assert.equal(nextReads, 1); assert.deepEqual(reads, ['bookmark']); assert.equal(states.at(-1)?.state, 'error');
      assert.ok(service.store.getPost(String(1000 + index))); assert.equal(collector.running, false);
      if (status === 429) {
        const restored = new Collector(state => states.push(state));
        restored.status = async () => { restored.account = account; return { connected: true, account }; };
        (restored as any).first = async () => { throw new Error('暂停期间不应请求 X'); };
        await restored.sync({ connection, sources: ['bookmark', 'like'], mode: 'recent' });
        assert.match(states.at(-1)!.message, /已暂停同步至/);
      }
      console.log(`PASS ${status}：不重试、不继续点赞来源、保留已收录资料${status === 429 ? '，重启后暂停仍生效' : ''}`);
    }
    {
      const account = { id: '200', handle: 'test', name: '测试' }, reads: Source[] = [], states: SyncState[] = [];
      const collector = new Collector(state => states.push(state));
      collector.status = async () => { collector.account = account; return { connected: true, account }; };
      (collector as any).first = async (source: Source) => { reads.push(source); return { template: {}, json: readXResponse(200, JSON.stringify({ ...page('2000'), errors: [{ code: 326 }] })) }; };
      await collector.sync({ connection, sources: ['bookmark', 'like'], mode: 'recent' });
      assert.deepEqual(reads, ['bookmark']); assert.equal(states.at(-1)?.state, 'error'); assert.equal(service.store.getPost('2000'), null);
      console.log('PASS 验证码或锁定：立即结束整个同步，不继续其他来源');
    }
    {
      const account = { id: '201', handle: 'test', name: '测试' }, reads: Source[] = [], states: SyncState[] = [];
      const collector = new Collector(state => { states.push(state); if (state.state === 'running') collector.stop(); });
      collector.status = async () => { collector.account = account; return { connected: true, account }; };
      (collector as any).first = async (source: Source) => { reads.push(source); return { template: {}, json: page('2001', 'next') }; };
      (collector as any).replay = async () => { throw new Error('停止后不应翻页'); };
      await collector.sync({ connection, sources: ['bookmark', 'like'], mode: 'recent' });
      assert.deepEqual(reads, ['bookmark']); assert.equal(states.at(-1)?.state, 'stopped'); assert.ok(service.store.getPost('2001'));
      console.log('PASS 手动停止：不继续翻页或其他来源，已收录资料保留');
    }
    {
      const collector = new Collector(() => {}); let reads = 0;
      (collector as any).first = async () => { reads++; throw new Error('不应读取历史'); };
      await collector.sync({ connection, sources: ['bookmark'], mode: 'full' as any });
      assert.equal(reads, 0);
      console.log('PASS 历史读取请求：在访问 X 前拒绝');
    }
    console.log('6 项采集器场景检查通过；仅使用模拟 X 响应和本机测试资料库。');
  } finally { await service.close(); }
}).catch(error => { console.error(error); exitCode = 1; }).finally(() => app.exit(exitCode));
