import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { extractHashtags } from '../src/shared/hashtags';
import { parseImport, tweetToPost } from '../src/shared/x-parser';
import { Store } from '../src/server/store';
import { startService } from '../src/server/service';
import type { PostInput } from '../src/shared/types';

mkdirSync(resolve('tmp'), {recursive:true});
const post=(id:string,text:string,hashtags?:string[]):PostInput=>({id,text,hashtags,author:'test',authorName:'测试',url:`https://x.com/test/status/${id}`,publishedAt:'2026-10-20T00:00:00Z',media:[]});

test('提取中日英话题标签，合并大小写和全角形式，不把链接片段或纯数字识别为标签',()=>{
  assert.deepEqual(extractHashtags('看看 #AI #ai ＃猫咪 #イラスト #3DArt #2026 https://example.org/#不算 www.example.org/#也不算 ##忽略 &#1234;'),['AI','猫咪','イラスト','3DArt']);
  assert.deepEqual(extractHashtags('没有正文标签',[{text:'AI'},{tag:'猫咪'},'ai','invalid-tag',null]),['AI','猫咪']);
});

test('X 长正文与官方标签字段都可保留，按规范化名字去重',()=>{
  const p=tweetToPost({rest_id:'1001',legacy:{full_text:'短文',entities:{hashtags:[{text:'AI'}]}},note_tweet:{note_tweet_results:{result:{text:'完整正文 #猫咪',entity_set:{hashtags:[{text:'猫咪'},{text:'ai'}]}}}}});
  assert.deepEqual(p!.hashtags,['AI','猫咪']);assert.equal(p!.text,'完整正文 #猫咪');
});

test('搜索 #标签 精确匹配，支持大小写、全角、多个标签与其他关键词组合',()=>{
  const store=new Store(':memory:');
  try{
    store.ingest([post('1001','图片教程 #AI #猫咪'),post('1002','其他 #Airplane'),post('1003','正文里只有 AI')],'42','bookmark');
    assert.deepEqual(store.list({q:'#ai'}).items.map(p=>p.id),['1001']);
    assert.equal(store.list({q:'＃ＡＩ #猫咪 图片'}).total,1);
    assert.equal(store.list({q:'#AI #猫咪 不存在'}).total,0);
    assert.equal(store.list({tag:'#aI',source:'bookmark',media:'text',from:'2026-10-01'}).total,1);
    assert.equal(store.list({q:'#AI',source:'like'}).total,0);
  }finally{store.close();}
});

test('手动标签与帖子标签共同筛选，同一帖子同名标签只统计一次',()=>{
  const store=new Store(':memory:');
  try{
    store.ingest([post('1001','图片 #AI'),post('1002','照片 #ai')],'42','bookmark');
    store.edit(['1001'],{tags:['ai','我的研究']});
    assert.equal(store.stats().tags.find(tag=>tag.name.toLowerCase()==='ai')!.count,2);
    assert.equal(store.list({tag:'我的研究'}).total,1);
    assert.equal(store.list({q:'#ai #我的研究'}).total,1);
    store.edit(['1001'],{tags:[]});
    assert.deepEqual(store.getPost('1001')!.tags,[]);assert.deepEqual(store.getPost('1001')!.hashtags,['AI']);
    assert.equal(store.list({tag:'ai'}).total,2);
  }finally{store.close();}
});

test('旧版资料库启动后补齐话题标签，正文、整理信息、来源及收录时间保持一致',()=>{
  const dir=mkdtempSync(resolve('tmp/hashtag-migration-')),file=join(dir,'library.sqlite');let store=new Store(file);
  try{
    store.ingest([post('1001','已有资料 #AI #猫咪')],'42','bookmark');store.ingest([post('1001','已有资料 #AI #猫咪')],'42','like');
    store.edit(['1001'],{note:'保留备注',tags:['手动分类'],folder:'研究',read:true,pinned:true,archived:true});
    const before=store.getPost('1001')!;store.close();
    const legacy=new DatabaseSync(file);legacy.exec('ALTER TABLE posts DROP COLUMN hashtags; PRAGMA user_version=1');legacy.close();
    store=new Store(file);const after=store.getPost('1001')!;
    assert.deepEqual(after.hashtags,['AI','猫咪']);
    const {hashtags:_a,...original}=before,{hashtags:_b,...restored}=after;assert.deepEqual(restored,original);
    assert.equal(store.list({q:'#ai',archived:'true'}).total,1);
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,2);
    store.close();store=new Store(file);assert.deepEqual(store.getPost('1001')!.hashtags,['AI','猫咪']);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('正文更新时刷新帖子标签，保留手动标签和备注',()=>{
  const store=new Store(':memory:');
  try{
    store.ingest([post('1001','旧文 #旧标签')],'42','bookmark');store.edit(['1001'],{tags:['研究'],note:'保留'});
    store.ingest([post('1001','新文 #新标签')],'42','bookmark');
    assert.deepEqual(store.getPost('1001')!.hashtags,['新标签']);assert.deepEqual(store.getPost('1001')!.tags,['研究']);
    assert.equal(store.getPost('1001')!.note,'保留');assert.equal(store.list({tag:'旧标签'}).total,0);assert.equal(store.list({tag:'新标签'}).total,1);
  }finally{store.close();}
});

test('归档标签不影响普通资料计数，恢复后重新进入标签列表',()=>{
  const store=new Store(':memory:');
  try{
    store.ingest([post('1001','已有资料 #AI')],'42','bookmark');store.edit(['1001'],{archived:true});
    assert.equal(store.stats().tags.length,0);assert.equal(store.list({tag:'AI',archived:'true'}).total,1);
    store.edit(['1001'],{archived:false});assert.equal(store.stats().tags[0].count,1);
  }finally{store.close();}
});

test('JSON 备份和通用导入保留标签字段，旧备份可从正文补齐',()=>{
  const one=new Store(':memory:'),two=new Store(':memory:');
  try{
    one.ingest([post('1001','一条资料',['AI'])],'42','bookmark');one.edit(['1001'],{tags:['我的分类'],note:'备注'});
    two.importBackup(one.exportAll());assert.deepEqual(two.getPost('1001')!.hashtags,['AI']);assert.deepEqual(two.getPost('1001')!.tags,['我的分类']);
    const parsed=parseImport(JSON.stringify([{id:'1002',text:'英文 #AI',hashtags:['猫咪']}]),'posts.json');assert.ok(Array.isArray(parsed));assert.deepEqual(parsed[0].hashtags,['猫咪','AI']);
    two.importBackup({format:'shizang',version:1,posts:[{...post('1003','旧备份 #猫咪'),sources:['bookmark']}]});assert.equal(two.list({tag:'猫咪'}).total,1);
  }finally{one.close();two.close();}
});

test('API 标签筛选与 CSV 往返保留帖子标签，拒绝未连接设备查询',async()=>{
  const dir=mkdtempSync(resolve('tmp/hashtag-api-')),service=await startService({dataDir:dir}),base=`http://127.0.0.1:${service.port}`;
  try{
    service.store.ingest([post('1001','内容 #AI #猫咪',['额外字段'])],'42','bookmark');service.store.edit(['1001'],{tags:['我的分类']});
    const headers={Authorization:'Bearer '+service.createDevice('标签测试')};
    const result=await(await fetch(base+'/api/posts?tag='+encodeURIComponent('#ai'),{headers})).json();
    assert.equal(result.total,1);assert.deepEqual(result.items[0].hashtags,['额外字段','AI','猫咪']);
    assert.equal((await fetch(base+'/api/posts?tag=AI')).status,401);
    const csv=await(await fetch(base+'/api/export?format=csv',{headers})).text();assert.ok(csv.includes('帖子标签'));
    const parsed=parseImport(csv,'标签.csv');assert.ok(!Array.isArray(parsed));const restored=new Store(':memory:');
    try{restored.importBackup(parsed.backup);assert.deepEqual(restored.getPost('1001')!.hashtags,['额外字段','AI','猫咪']);assert.deepEqual(restored.getPost('1001')!.tags,['我的分类']);}finally{restored.close();}
  }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});
