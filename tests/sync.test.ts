import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadPreferences, validPreference } from '../src/desktop/preferences';
import { blockedXPage, readXResponse, retryAt, XSyncBlocked } from '../src/desktop/sync-policy';
import { SyncCooldown } from '../src/desktop/sync-cooldown';
import { syncTimeline } from '../src/desktop/sync-timeline';
import { Store } from '../src/server/store';
import type { PostInput } from '../src/shared/types';

mkdirSync(resolve('tmp'), { recursive: true });
const post = (id: string, text = '新增资料'): PostInput => ({ id, text, author: 'test', authorName: '测试', publishedAt: null, url: `https://x.com/test/status/${id}`, media: [] });
const page = (ids: string[], cursor: string | null = null) => ({ data: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
  ...ids.map(id => ({ content: { itemContent: { tweet_results: { result: { rest_id: id, legacy: { full_text: `内容 ${id}` } } } } } })),
  ...(cursor ? [{ content: { cursorType: 'Bottom', value: cursor } }] : [])
] }] } } });
const defaults = { pause: async () => {}, stopped: () => false, check: () => {}, progress: () => {} };

test('新装与旧版升级都关闭自动同步，保留主题和布局', () => {
  assert.equal(loadPreferences(undefined).autoSync, 'false');
  const saved = loadPreferences({ autoSync: 'true', theme: 'dark', layout: 'list', other: 'ignored' });
  assert.equal(saved.autoSync, 'false'); assert.equal(saved.theme, 'dark'); assert.equal(saved.layout, 'list');
  assert.equal(saved.other, undefined);
});

test('用户之后主动开启自动同步的选择可保存，内部迁移标记不可从界面修改', () => {
  const saved = { ...loadPreferences({}), autoSync: 'true' };
  assert.equal(loadPreferences(saved).autoSync, 'true');
  assert.equal(validPreference('autoSync', 'true'), true);
  assert.equal(validPreference('syncPolicy', 'manual-incremental'), false);
});

test('限流等待时间支持秒数和日期，不截短 X 要求的一小时等待', () => {
  const now = Date.UTC(2026, 9, 26);
  assert.equal(retryAt('3600', now), now + 3600000);
  assert.equal(retryAt(new Date(now + 3600000).toUTCString(), now), now + 3600000);
  assert.equal(retryAt(null, now, String((now + 3600000) / 1000)), now + 3600000);
  assert.equal(retryAt('30', now, String((now + 3600000) / 1000)), now + 3600000);
  assert.equal(retryAt(null, now), now + 900000);
  assert.equal(retryAt('invalid', now), now + 900000);
});

test('限流暂停时间按账号保存，重启后仍生效，过期后由用户手动同步', () => {
  const dir = mkdtempSync(resolve('tmp/cooldown-test-'));
  try {
    const file = join(dir, 'cooldown.json'), now = Date.now();
    new SyncCooldown(file).record('42', now + 3600000);
    const restored = new SyncCooldown(file);
    assert.throws(() => restored.check('42', now), XSyncBlocked);
    assert.doesNotThrow(() => restored.check('99', now));
    assert.doesNotThrow(() => restored.check('42', now + 3600001));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('登录、验证跳转会中止同步，普通收藏与点赞地址可正常读取', () => {
  assert.equal(blockedXPage('https://x.com/i/flow/login')?.reason, 'login');
  assert.equal(blockedXPage('https://x.com/account/access')?.reason, 'verification');
  assert.equal(blockedXPage('https://x.com/i/flow/challenge')?.reason, 'verification');
  assert.equal(blockedXPage('https://x.com/i/bookmarks'), null);
  assert.equal(blockedXPage('https://x.com/i/history/likes'), null);
});

test('HTTP 200 中的限流、失效登录与锁定错误也会停止，即使附带部分资料', () => {
  for (const [code, reason] of [[88, 'rate-limit'], [89, 'login'], [326, 'verification'], [64, 'verification']] as const) {
    assert.throws(() => readXResponse(200, JSON.stringify({ ...page(['1001']), errors: [{ code }] })), (error: unknown) => error instanceof XSyncBlocked && error.reason === reason);
  }
  assert.throws(() => readXResponse(200, JSON.stringify({ errors: [{ message: 'Complete the CAPTCHA challenge' }] })), XSyncBlocked);
  assert.doesNotThrow(() => readXResponse(200, JSON.stringify({ ...page(['1001']), errors: [{ code: 63, message: 'User has been suspended.' }] })));
});

test('增量同步只写入新增来源，遇到整页已收录内容不再请求下一页', async () => {
  const store = new Store(':memory:');
  try {
    store.ingest([post('1001', '保留的正文'), post('1002')], '42', 'bookmark');
    store.edit(['1001'], { note: '保留备注', tags: ['保留标签'], read: true });
    let reads = 0, added = 0;
    const result = await syncTimeline({ ...defaults, first: page(['1003', '1001'], 'a'),
      known: async ids => ids.filter(id => !!store.db.prepare('SELECT 1 FROM sources WHERE post_id=? AND account_id=? AND kind=?').get(id, '42', 'bookmark')),
      save: async posts => { store.ingest(posts, '42', 'bookmark'); },
      next: async () => { reads++; return page(['1001', '1002'], 'b'); }, progress: count => { added += count; }
    });
    assert.equal(reads, 1); assert.equal(added, 1); assert.deepEqual(result.ids, ['1003']);
    assert.equal(store.getPost('1001')!.text, '保留的正文'); assert.equal(store.getPost('1001')!.note, '保留备注');
    assert.deepEqual(store.getPost('1001')!.tags, ['保留标签']); assert.equal(store.getPost('1001')!.read, true);
    assert.equal(store.stats().total, 3);
  } finally { store.close(); }
});

test('收藏中已存在的帖子仍可作为新的点赞来源收录', async () => {
  const store = new Store(':memory:');
  try {
    store.ingest([post('1001')], '42', 'bookmark'); store.edit(['1001'], { note: '保留' });
    await syncTimeline({ ...defaults, first: page(['1001']), known: async ids => ids.filter(id => !!store.db.prepare('SELECT 1 FROM sources WHERE post_id=? AND account_id=? AND kind=?').get(id, '42', 'like')),
      save: async posts => { store.ingest(posts, '42', 'like'); }, next: async () => { throw new Error('不应翻页'); }
    });
    assert.deepEqual(store.getPost('1001')!.sources.sort(), ['bookmark', 'like']);
    assert.equal(store.getPost('1001')!.note, '保留'); assert.equal(store.stats().total, 1);
  } finally { store.close(); }
});

for (const status of [401, 403, 429]) test(`${status} 响应不重试，已保存的第一页资料保留`, async () => {
  const store = new Store(':memory:'); let requests = 0;
  try {
    await assert.rejects(syncTimeline({ ...defaults, first: page(['1001'], 'a'), known: async () => [],
      save: async posts => { store.ingest(posts, '42', 'bookmark'); },
      next: async () => { requests++; return readXResponse(status, '{}'); }
    }), XSyncBlocked);
    assert.equal(requests, 1); assert.equal(store.stats().total, 1); assert.ok(store.getPost('1001'));
  } finally { store.close(); }
});

test('等待下一页时手动停止，不再读取下一页', async () => {
  let stopped = false, requests = 0;
  const result = await syncTimeline({ ...defaults, first: page(['1001'], 'a'), known: async () => [], save: async () => {},
    pause: async () => { stopped = true; }, stopped: () => stopped, next: async () => { requests++; return page([]); }
  });
  assert.equal(requests, 0); assert.deepEqual(result.ids, ['1001']); assert.equal(result.verifiedEnd, false);
});

test('X 重复返回同一翻页位置时停止，不形成重复请求循环', async () => {
  let requests = 0;
  const result = await syncTimeline({ ...defaults, first: page(['1001'], 'a'), known: async () => [], save: async () => {},
    next: async () => { requests++; return page(['1002'], 'a'); }
  });
  assert.equal(requests, 1); assert.deepEqual(result.ids, ['1001', '1002']); assert.equal(result.verifiedEnd, false);
});

test('连续空页停止读取，不将其误报为已确认读取完整历史', async () => {
  let requests = 0;
  const result = await syncTimeline({ ...defaults, first: page([], 'a'), known: async () => [], save: async () => {},
    next: async () => { requests++; return page([], 'b'); }
  });
  assert.equal(requests, 1); assert.equal(result.verifiedEnd, false);
});
