import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../src/server/store';
import { startService } from '../src/server/service';
import { parseImport, parseTimeline } from '../src/shared/x-parser';
import type { PostInput } from '../src/shared/types';
mkdirSync(resolve('tmp'),{recursive:true});
const post=(id:string,text='NAS 图片工作流'):PostInput=>({id,text,author:'wind',authorName:'微风',publishedAt:'2025-03-01T12:00:00.000Z',url:`https://x.com/wind/status/${id}`,media:[]});
const account={id:'42',handle:'wind',name:'微风'};
test('同一推文同时收藏和点赞只收录一次，整理内容在再次同步后保留',()=>{
  const s=new Store(':memory:');s.ingest([post('1001')],account.id,'bookmark');s.edit(['1001'],{note:'以后搭 NAS 时参考',tags:['NAS','工具'],folder:'研究',read:true,pinned:true});s.ingest([post('1001','更新后的正文')],account.id,'like');s.ingest([post('1001','再次同步')],account.id,'bookmark');
  const p=s.getPost('1001')!;assert.deepEqual(p.sources.sort(),['bookmark','like']);assert.equal(p.note,'以后搭 NAS 时参考');assert.deepEqual(p.tags,['NAS','工具']);assert.equal(p.folder,'研究');assert.equal(p.read,true);assert.equal(p.pinned,true);assert.equal(s.stats().total,1);assert.equal(s.stats().bookmarks,1);assert.equal(s.stats().likes,1);s.close();
});
test('同步中断和格式错误保留已收录资料；完整读取只更新对应账号与来源',()=>{
  const s=new Store(':memory:');s.ingest([post('1001'),post('1002')],'42','bookmark');s.ingest([post('1002')],'42','like');s.ingest([post('1003')],'99','bookmark');
  const interrupted=s.startJob(account,'bookmark','full');s.ingest([post('1001')],'42','bookmark',interrupted);s.finishJob(interrupted,'stopped',false);assert.equal(s.stats().bookmarks,3);
  const bad=s.startJob(account,'bookmark','full');assert.throws(()=>s.ingest([post('1004'),post('invalid')],'42','bookmark',bad));assert.equal(s.getPost('1004'),null);s.finishJob(bad,'error',false);assert.equal(s.stats().bookmarks,3);
  const full=s.startJob(account,'bookmark','full');s.ingest([post('1001')],'42','bookmark',full);s.finishJob(full,'complete',true);assert.equal(s.stats().bookmarks,2);assert.deepEqual(s.getPost('1002')!.sources,['like']);assert.equal(s.stats().total,3);s.close();
});
test('中文片段、组合关键词、标签、来源、媒体和时间筛选可组合使用',()=>{
  const s=new Store(':memory:');s.ingest([post('1001','推荐一个图片工作流软件'),{...post('1002','NAS 教程'),media:[{type:'video',url:'https://video.twimg.com/a.mp4',thumbnail:'https://pbs.twimg.com/a.jpg'}]}],'42','bookmark');s.edit(['1001'],{tags:['稍后研究'],note:'适合苹果电脑'});s.ingest([post('1001')],'42','like');
  assert.equal(s.list({q:'工作流 苹果'}).total,1);assert.equal(s.list({q:'工作流',source:'both',tag:'稍后研究'}).total,1);assert.equal(s.list({media:'video',from:'2025-01-01',to:'2025-12-31'}).total,1);assert.equal(s.list({q:"' OR 1=1 --"}).total,0);assert.equal(s.list({from:'2026-01-01'}).total,0);s.close();
});
test('归档可以恢复；备份恢复包含原始来源、备注和首次收录时间',()=>{
  const s=new Store(':memory:');s.ingest([post('1001')],'42','bookmark');s.ingest([post('1001')],'42','like');s.edit(['1001'],{tags:['备份'],note:'重要资料',archived:true});assert.equal(s.list({}).total,0);assert.equal(s.list({archived:'true'}).total,1);
  const original=s.getPost('1001')!;const target=new Store(':memory:');target.importBackup(s.exportAll());const p=target.getPost('1001')!;assert.equal(p.note,original.note);assert.deepEqual(p.sources.sort(),original.sources.sort());assert.equal(p.firstSeenAt,original.firstSeenAt);target.edit(['1001'],{archived:false});assert.equal(target.list({}).total,1);assert.equal(target.importBackup(s.exportAll()).added,0);assert.equal(target.getPost('1001')!.archived,false);target.close();s.close();
});
test('X 列表解析忽略广告，正确提取长推文和引用内容',()=>{
  const raw={rest_id:'1001',legacy:{full_text:'短文',created_at:'Sat Mar 01 12:00:00 +0000 2025'},core:{user_results:{result:{legacy:{screen_name:'wind',name:'微风'}}}},note_tweet:{note_tweet_results:{result:{text:'完整的长推文'}}},quoted_status_result:{result:{rest_id:'1000',legacy:{full_text:'被引用的正文'},core:{user_results:{result:{legacy:{screen_name:'other',name:'其他作者'}}}}}}};
  const result=parseTimeline({data:{bookmark_timeline_v2:{timeline:{instructions:[{type:'TimelineAddEntries',entries:[{content:{itemContent:{tweet_results:{result:raw}}}},{content:{itemContent:{promotedMetadata:{},tweet_results:{result:{...raw,rest_id:'1002'}}}}},{entryId:'cursor-bottom-1',content:{cursorType:'Bottom',value:'next'}}]}]}}}});
  assert.equal(result.recognized,true);assert.equal(result.posts.length,1);assert.equal(result.posts[0].text,'完整的长推文');assert.equal(result.posts[0].quote?.text,'被引用的正文');assert.equal(result.cursor,'next');assert.equal(parseTimeline({errors:[{message:'login'}]}).recognized,false);
});
test('导入 X like.js、普通 JSON 和带换行、逗号的 CSV',()=>{
  const like=parseImport('window.YTD.like.part0 = [{"like":{"tweetId":"1001","fullText":"喜欢的内容","expandedUrl":"https://x.com/wind/status/1001"}}]','like.js');assert.ok(Array.isArray(like));assert.equal(like[0].text,'喜欢的内容');
  const csv=parseImport('id,text,author\n1002,"第一行,包含逗号\n第二行",wind','data.csv');assert.ok(Array.isArray(csv));assert.equal(csv[0].text,'第一行,包含逗号\n第二行');assert.throws(()=>parseImport('{"nothing":[]}','file.json'));
});
test('两台设备共享资料，撤销设备后凭证失效，未授权请求不能读取资料',async()=>{
  const dir=mkdtempSync(resolve('tmp/api-test-'));const s=await startService({dataDir:dir,pairingKey:'TEST-PAIR-KEY'});const base=`http://127.0.0.1:${s.port}`;
  const request=async(path:string,token='',data?:any,method?:string)=>{const r=await fetch(base+path,{method:method??(data?'POST':'GET'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json()};};
  try{
    assert.equal((await request('/api/posts')).status,401);assert.equal((await request('/api/pair','',{key:'bad'})).status,401);
    const one=(await request('/api/pair','',{key:'TEST-PAIR-KEY',name:'Mac'})).data;
    const two=(await request('/api/pair','',{key:'TEST-PAIR-KEY',name:'Phone'})).data;
    const imported=await request('/api/import',one.token,{filename:'posts.json',source:'bookmark',content:JSON.stringify([post('1001')])});assert.equal(imported.data.added,1);
    await request('/api/posts',two.token,{ids:['1001'],change:{tags:['手机整理'],note:'跨设备一致'}},'PATCH');
    const result=await request('/api/posts?q='+encodeURIComponent('跨设备'),one.token);assert.equal(result.data.total,1);assert.deepEqual(result.data.items[0].tags,['手机整理']);
    const backup=await request('/api/export?format=backup',one.token);assert.equal(backup.data.posts.length,1);assert.equal(JSON.stringify(backup.data).includes(one.token),false);
    await request('/api/devices/'+two.deviceId,one.token,undefined,'DELETE');assert.equal((await request('/api/stats',two.token)).status,401);
  }finally{await s.close();rmSync(dir,{recursive:true,force:true});}
});
test('服务重启后任务标为中断，已经收录的资料仍可查找',async()=>{
  const dir=mkdtempSync(resolve('tmp/restart-test-'));let s=new Store(join(dir,'library.sqlite'));const job=s.startJob(account,'bookmark','full');s.ingest([post('1001')],'42','bookmark',job);s.close();s=new Store(join(dir,'library.sqlite'));assert.equal(s.getJob(job).state,'interrupted');assert.equal(s.list({}).total,1);s.close();rmSync(dir,{recursive:true,force:true});
});
test('中文 CSV 可以重新导入，文件导入资料和双来源在备份恢复后保持一致',()=>{
  const csv='推文编号,作者,用户名,发布时间,首次收录时间,正文,收藏,点赞,标签,文件夹,备注,已读,原文链接\n1001,微风,wind,2025-03-01,2025-03-02,"第一行,第二行",是,是,工具、NAS,研究,跨设备,是,https://x.com/wind/status/1001';
  const parsed=parseImport(csv,'拾藏.csv');assert.ok(!Array.isArray(parsed));
  const one=new Store(':memory:');one.importBackup(parsed.backup);assert.equal(one.getPost('1001')!.note,'跨设备');assert.deepEqual(one.getPost('1001')!.sources.sort(),['bookmark','like']);
  const two=new Store(':memory:');two.importBackup(one.exportAll());assert.deepEqual(two.getPost('1001')!.sources.sort(),['bookmark','like']);assert.equal(two.stats().total,1);
  const three=new Store(':memory:');three.importBackup({format:'shizang',version:1,posts:[one.getPost('1001')]});assert.deepEqual(three.getPost('1001')!.sources.sort(),['bookmark','like']);
  one.close();two.close();three.close();
});
test('手动选择的视频保存后支持分段读取，图片和默认媒体保存任务被拒绝',async()=>{
  const dir=mkdtempSync(resolve('tmp/media-test-'));const s=await startService({dataDir:dir});const base=`http://127.0.0.1:${s.port}`;const token=s.createDevice('媒体测试');const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const request=async(path:string,body:any)=>{const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  try{
    s.store.ingest([{...post('1001'),media:[{type:'photo',url:'https://pbs.twimg.com/test-original.png',thumbnail:'https://pbs.twimg.com/test-preview.png'},{type:'video',url:'https://video.twimg.com/test.mp4',thumbnail:'https://pbs.twimg.com/test-poster.png'}]}],'42','bookmark');
    const plan=await request('/api/media-cache/plan',{ids:['1001'],originals:true});assert.equal(plan.assets.length,1);assert.equal(plan.assets[0].kind,'file');
    assert.equal((await fetch(base+'/api/media-cache/plan',{method:'POST',headers,body:'{}'})).status,400);
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a92kAAAAASUVORK5CYII=','base64');
    const upload=await fetch(base+'/api/media-cache/1001/0/thumbnail',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'image/png'},body:bytes});assert.equal(upload.status,400);
    const video=Buffer.from('test-video-range');assert.equal((await fetch(base+'/api/media-cache/1001/1/file',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'video/mp4'},body:video})).status,200);
    const result=await (await fetch(base+'/api/posts/1001',{headers})).json();assert.equal(result.media[0].cachedOriginal,false);assert.equal(result.media[0].cachedPreview,false);
    assert.equal(result.media[0].filePath,'https://pbs.twimg.com/test-original.png');
    const range=await fetch(base+result.media[1].filePath,{headers:{Range:'bytes=5-9'}});assert.equal(range.status,206);assert.equal(await range.text(),'video');
    assert.equal((await fetch(base+'/api/media-cache/1001/0/file',{method:'POST',headers:{'Content-Type':'image/png'},body:bytes})).status,401);
  }finally{await s.close();rmSync(dir,{recursive:true,force:true});}
});
test('CSV 中的推文和备注按文字导出，重新导入后保持原文',async()=>{
  const dir=mkdtempSync(resolve('tmp/csv-test-'));const s=await startService({dataDir:dir});
  try{const text='=HYPERLINK("https://example.org","文字")';s.store.ingest([post('1001',text)],'42','bookmark');s.store.edit(['1001'],{note:"'@原始备注",tags:['=标签']});const token=s.createDevice('CSV 测试');const r=await fetch(`http://127.0.0.1:${s.port}/api/export?format=csv`,{headers:{Authorization:'Bearer '+token}});const csv=await r.text();assert.ok(csv.includes("'=HYPERLINK"));const parsed=parseImport(csv,'export.csv');assert.ok(!Array.isArray(parsed));assert.equal(parsed.backup.posts[0].text,text);assert.equal(parsed.backup.posts[0].note,"'@原始备注");assert.deepEqual(parsed.backup.posts[0].tags,['=标签']);
  }finally{await s.close();rmSync(dir,{recursive:true,force:true});}
});
