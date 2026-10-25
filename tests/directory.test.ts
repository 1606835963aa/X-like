import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { authorId, matchingOptions } from '../src/shared/directory';
import type { PostInput } from '../src/shared/types';

const post=(id:string,author='wind',name='微风',video=false):PostInput=>({id,author,authorName:name,text:'测试内容 #AI',publishedAt:'2026-10-20T00:00:00Z',url:`https://x.com/${author}/status/${id}`,media:video?[{type:'video',url:'https://video.twimg.com/a.mp4',thumbnail:''}]:[]});

test('作者按用户名聚合，收藏点赞重叠帖子只计一次，同名作者仍分开，归档不计入目录',()=>{
  const store=new Store(':memory:');
  try{
    store.ingest([post('1001'),post('1002','WIND','微风',true),post('1003','other','微风'),post('1004','archive','已归档')],'42','bookmark');
    store.ingest([post('1001')],'42','like');store.edit(['1004'],{archived:true});
    const authors=store.stats().authors;assert.equal(authors.length,2);
    const wind=authors.find(author=>author.id===authorId('@ｗｉｎｄ',''))!;assert.equal(wind.count,2);assert.equal(wind.bookmarks,2);assert.equal(wind.likes,1);assert.equal(wind.videos,1);
    assert.equal(authors.find(author=>author.id==='user:other')!.count,1);
  }finally{store.close();}
});

test('精确作者筛选可与视频、标签和来源组合，动图计入视频，缺少用户名的作者可选择',()=>{
  const store=new Store(':memory:');
  try{
    store.ingest([post('1001'),post('1002','wind','微风',true),post('1003','windy','微风',true),post('1004','','离线作者')],'42','bookmark');
    store.ingest([{...post('1005'),media:[{type:'gif',url:'https://video.twimg.com/gif.mp4',thumbnail:''}]}],'42','like');
    assert.equal(store.list({authorId:'user:wind'}).total,3);assert.equal(store.list({authorId:'user:wind',media:'video',tag:'AI'}).total,2);
    assert.equal(store.list({authorId:'user:wind',media:'video',source:'bookmark'}).total,1);
    assert.equal(store.list({authorId:authorId('','离线作者')}).total,1);
    assert.equal(store.stats().authors.find(author=>author.id==='user:wind')!.videos,2);
    store.edit(['1002'],{archived:true});assert.equal(store.stats().authors.find(author=>author.id==='user:wind')!.count,2);
  }finally{store.close();}
});

test('联想按名称或用户名匹配，前缀优先，兼容大小写全角并限制建议数量',()=>{
  const authors=[{value:'1',label:'微风',detail:'@wind',count:10},{value:'2',label:'Wind 工具',detail:'@other',count:3},{value:'3',label:'逆风',detail:'@tailwind',count:2}];
  assert.deepEqual(matchingOptions(authors,'＠ＷＩＮＤ').map(item=>item.value),['1','2','3']);
  assert.deepEqual(matchingOptions(authors,'微').map(item=>item.value),['1']);assert.equal(matchingOptions(authors,'不存在').length,0);
  const tags=Array.from({length:20},(_,index)=>({value:String(index),label:'#AI'+index,count:1}));
  assert.equal(matchingOptions(tags,'#ai',8).length,8);assert.equal(matchingOptions(tags,'#ai').length,20);
});
