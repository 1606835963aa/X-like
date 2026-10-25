import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHmac } from 'node:crypto';
import { startService } from '../src/server/service';
import { saveVideos } from '../src/desktop/media-cache';
import { playbackSources, xMediaUrl } from '../src/shared/media';
import type { PostInput } from '../src/shared/types';

mkdirSync(resolve('tmp'),{recursive:true});
const video='https://video.twimg.com/manual-video.mp4';
const post:PostInput={id:'1001',author:'wind',authorName:'微风',avatar:'https://pbs.twimg.com/avatar.jpg',text:'媒体策略测试',publishedAt:null,url:'https://x.com/wind/status/1001',media:[{type:'photo',url:'https://pbs.twimg.com/photo.jpg',thumbnail:'https://pbs.twimg.com/preview.jpg'},{type:'video',url:video,thumbnail:'https://pbs.twimg.com/poster.jpg'}]};

test('未保存视频只使用 X 地址，已保存视频可读取资料库，非法地址不能作为播放来源',()=>{
  assert.deepEqual(playbackSources({url:video},'http://nas/api/media/file'),[video]);
  assert.deepEqual(playbackSources({url:video,cachedOriginal:false},'http://nas/api/media/file'),[video]);
  assert.deepEqual(playbackSources({url:video,cachedOriginal:true},'http://nas/api/media/file'),['http://nas/api/media/file',video]);
  assert.deepEqual(playbackSources({url:'https://evil.example/file.mp4'},'http://nas/api/media/file'),[]);
  assert.equal(xMediaUrl('https://video.twimg.com.evil.example/file.mp4'),'');
  assert.equal(xMediaUrl('http://video.twimg.com/file.mp4'),'');
  assert.equal(xMediaUrl('https://user:pass@video.twimg.com/file.mp4'),'');
});

test('NAS 浏览资料、访问缺失图片或视频及分段读取请求均不联网下载，不新增媒体文件',async()=>{
  const dir=mkdtempSync(resolve('tmp/media-policy-')),service=await startService({dataDir:dir}),base=`http://127.0.0.1:${service.port}`,originalFetch=globalThis.fetch;
  let upstream=0;
  globalThis.fetch=async(input,init)=>{const url=String(input instanceof Request?input.url:input);if(!url.startsWith(base+'/')){upstream++;throw new Error('NAS 不应访问上游');}return originalFetch(input,init);};
  try{
    service.store.ingest([post],'42','bookmark');const before=service.store.getPost(post.id);
    const headers={Authorization:'Bearer '+service.createDevice('媒体只读测试')};
    const result=await(await originalFetch(base+'/api/posts/1001',{headers})).json();
    assert.equal(result.avatarPath,post.avatar);assert.equal(result.media[0].filePath,post.media[0].url);assert.equal(result.media[1].thumbnailPath,post.media[1].thumbnail);
    const key=readFileSync(join(dir,'media-key'),'utf8'),expires=String(Math.floor(Date.now()/1000)+3600);
    for(const path of ['/api/media/1001/avatar','/api/media/1001/0/file','/api/media/1001/0/thumbnail','/api/media/1001/1/file','/api/media/1001/1/thumbnail']){
      const signature=createHmac('sha256',key).update(path+'|'+expires).digest('hex').slice(0,32);
      const response=await originalFetch(`${base}${path}?expires=${expires}&key=${signature}`,{headers:{Range:'bytes=0-1023'}});
      assert.equal(response.status,404);await response.json();
    }
    assert.equal(upstream,0);assert.deepEqual(readdirSync(join(dir,'media')),[]);assert.deepEqual(service.store.getPost(post.id),before);
  }finally{globalThis.fetch=originalFetch;await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('手动保存由电脑获取选定视频并上传资料库，图片和其他帖子不下载，重复保存不重复获取',async()=>{
  const dir=mkdtempSync(resolve('tmp/manual-video-')),service=await startService({dataDir:dir}),base=`http://127.0.0.1:${service.port}`,originalFetch=globalThis.fetch;
  const requests:string[]=[];const bytes=Buffer.from('test-video-range');
  globalThis.fetch=async(input,init)=>{const url=String(input instanceof Request?input.url:input);if(url.startsWith(base+'/'))return originalFetch(input,init);requests.push(url);assert.equal(url,video);return new Response(bytes,{headers:{'Content-Type':'video/mp4'}});};
  try{
    service.store.ingest([post,{...post,id:'1002',media:[{type:'video',url:'https://video.twimg.com/other.mp4',thumbnail:''}]}],'42','bookmark');
    const connection={url:base,token:service.createDevice('手动保存测试')},options={ids:['1001'],stopped:()=>false,progress:()=>{}};
    assert.deepEqual(await saveVideos(connection,options),{saved:1,failed:0,total:1});assert.deepEqual(requests,[video]);
    const headers={Authorization:'Bearer '+connection.token};
    const result=await(await originalFetch(base+'/api/posts/1001',{headers})).json();assert.equal(result.media[1].cachedOriginal,true);assert.equal(result.media[0].cachedOriginal,false);
    const range=await originalFetch(base+result.media[1].filePath,{headers:{Range:'bytes=5-9'}});assert.equal(range.status,206);assert.equal(await range.text(),'video');
    assert.deepEqual(await saveVideos(connection,options),{saved:0,failed:0,total:0});assert.deepEqual(requests,[video]);
    assert.equal(readdirSync(join(dir,'media')).length,2);
  }finally{globalThis.fetch=originalFetch;await service.close();rmSync(dir,{recursive:true,force:true});}
});
