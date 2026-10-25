import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../src/server/store';
import { startService } from '../src/server/service';
import type { PostInput } from '../src/shared/types';

const posts:PostInput[]=Array.from({length:125},(_,i)=>({
  id:String(1000+i),text:`资料 ${i} ${i%2?'阅读':'视频'} #工具`,
  author:i%3?'wind':'other',authorName:i%3?'微风':'另一位作者',
  publishedAt:new Date(Date.UTC(2025,0,i+1)).toISOString(),url:`https://x.com/wind/status/${1000+i}`,
  media:i%2?[]:[{type:'video',url:'https://video.twimg.com/test.mp4',thumbnail:''}],
}));
const ids=(items:{id:string}[])=>items.map(p=>p.id);

test('随机排序在翻页、返回和整理资料后保持稳定，重新打乱覆盖全部资料',()=>{
  const store=new Store(':memory:');
  try{
    store.ingest(posts,'42','bookmark');store.edit(['1000','1010'],{pinned:true});
    const query={sort:'random',seed:'first-round',limit:'48'};
    const first=store.list(query);
    const all=[...first.items,...store.list({...query,page:'2'}).items,...store.list({...query,page:'3'}).items];
    assert.equal(first.total,125);assert.equal(first.pages,3);
    assert.equal(all.length,125);assert.equal(new Set(ids(all)).size,125);
    assert.deepEqual(ids(all).sort(),ids(posts).sort());
    assert.deepEqual(ids(store.list(query).items),ids(first.items));
    store.edit([first.items[0].id],{read:true,note:'读过的资料'});
    assert.deepEqual(ids(store.list(query).items),ids(first.items));
    assert.notDeepEqual(ids(store.list({...query,seed:'second-round'}).items),ids(first.items));
    assert.notDeepEqual(ids(store.list({...query,seed:'first-round\' OR 1=1 --'}).items),ids(first.items));
    assert.deepEqual(ids(store.list({sort:'newest',seed:'ignored'}).items),ids(store.list({sort:'newest'}).items));
  }finally{store.close();}
});

test('随机排序可组合搜索、作者、标签和媒体筛选，并且与资料写入顺序无关',()=>{
  const one=new Store(':memory:'),two=new Store(':memory:');
  try{
    one.ingest(posts,'42','like');two.ingest([...posts].reverse(),'42','like');
    const query={sort:'random',seed:'filtered-round',q:'视频',author:'wind',tag:'工具',source:'like',media:'video',limit:'100'};
    const result=one.list(query);
    const expected=posts.filter(p=>p.author==='wind'&&p.media.length>0);
    assert.equal(result.total,expected.length);
    assert.deepEqual(ids(result.items).sort(),ids(expected).sort());
    assert.deepEqual(ids(one.list(query).items),ids(two.list(query).items));
    assert.equal(one.list({...query,tag:'不存在'}).total,0);
    assert.deepEqual(ids(one.list({sort:'random'}).items),ids(one.list({sort:'random'}).items));
  }finally{one.close();two.close();}
});

test('HTTP 随机分页与导出使用同一轮顺序，超过一百条也不重复或遗漏',async()=>{
  mkdirSync(resolve('tmp'),{recursive:true});
  const dir=mkdtempSync(resolve('tmp/random-sort-'));
  const service=await startService({dataDir:dir});
  try{
    service.store.ingest(posts,'42','bookmark');
    const headers={Authorization:'Bearer '+service.createDevice('随机排序测试')};
    const get=async(path:string)=>{
      const response=await fetch(`http://127.0.0.1:${service.port}${path}`,{headers});
      assert.equal(response.status,200);return response.json();
    };
    const query='sort=random&seed=http-round';
    const pages=await Promise.all([1,2,3].map(page=>get(`/api/posts?${query}&page=${page}&limit=48`)));
    const ordered=pages.flatMap(page=>ids(page.items));
    assert.equal(ordered.length,125);assert.equal(new Set(ordered).size,125);
    assert.deepEqual(ids((await get(`/api/posts?${query}&page=1&limit=48`)).items),ids(pages[0].items));
    const exported=await get(`/api/export?${query}`);
    assert.deepEqual(ids(exported.posts),ordered);
    assert.deepEqual(ids(exported.posts).sort(),ids(posts).sort());
  }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});
