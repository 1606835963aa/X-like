import { app, session } from 'electron';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(work,'connection.log'),'legacy service http://legacy-nas.example:5368\n');
  writeFileSync(join(work,'connection.previous.log'),'legacy PROXY legacy-proxy.example:7890\n');
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
    {
      const collector=new Collector(()=>{}),account={id:'300',handle:'test',name:'测试'};const mediaCalls:string[]=[];
      collector.status=async()=>{collector.account=account;return{connected:true,account};};
      (collector as any).first=async()=>({template:{},json:page('3000')});
      const observe=(request:http.IncomingMessage)=>{if(request.url?.includes('/media'))mediaCalls.push(request.url);};service.server.on('request',observe);
      try{await collector.sync({connection,sources:['bookmark'],mode:'recent'});assert.ok(service.store.getPost('3000'));assert.deepEqual(mediaCalls,[]);assert.deepEqual(readdirSync(join(work,'library/media')),[]);}
      finally{service.server.off('request',observe);}
      console.log('PASS 新增资料同步：只写清单，不请求或上传预览图、头像和视频');
    }
    {
      const account={id:'301',handle:'test',name:'测试'},states:SyncState[]=[];let reads=0,requests=0;
      const collector=new Collector(state=>states.push(state),{fetcher:async()=>{requests++;throw new TypeError('fetch failed',{cause:Object.assign(new Error('unreachable'),{code:'EHOSTUNREACH'})});}});
      collector.status=async()=>{collector.account=account;return{connected:true,account};};
      (collector as any).first=async()=>{reads++;throw new Error('资料库不可达时不应访问 X');};
      await collector.sync({connection,sources:['bookmark','like'],mode:'recent'});
      assert.equal(reads,0);assert.equal(requests,1);assert.match(states.at(-1)!.message,/资料库.*EHOSTUNREACH/);assert.equal(states.at(-1)!.state,'error');
      console.log('PASS 资料库连接失败：在访问 X 前停止、不重试、明确提示资料库错误');
    }
    {
      const requests:string[]=[],states:SyncState[]=[];
      const proxy=http.createServer((request,response)=>{
        const url=new URL(request.url!);requests.push(url.pathname);
        assert.equal(url.hostname,'nas.invalid');
        const forwarded=http.request({host:'127.0.0.1',port:service.port,path:url.pathname+url.search,method:request.method,headers:request.headers},upstream=>{response.writeHead(upstream.statusCode!,upstream.headers);upstream.pipe(response);});
        forwarded.on('error',()=>{response.writeHead(502);response.end();});request.pipe(forwarded);
      });
      await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
      const port=(proxy.address() as import('node:net').AddressInfo).port;
      try{
        await session.defaultSession.setProxy({mode:'fixed_servers',proxyRules:`127.0.0.1:${port}`});
        const account={id:'302',handle:'test',name:'测试'},collector=new Collector(state=>states.push(state));
        collector.status=async()=>{collector.account=account;return{connected:true,account};};
        (collector as any).first=async()=>({template:{},json:page('3020')});
        await collector.sync({connection:{...connection,url:'http://nas.invalid:5368'},sources:['bookmark'],mode:'recent'});
        assert.equal(states.at(-1)!.state,'complete');assert.ok(service.store.getPost('3020'));
        assert.equal(requests[0],'/api/stats');assert.ok(requests.includes('/api/jobs'));assert.ok(requests.some(path=>path.endsWith('/batch')));assert.equal(requests.some(path=>path.includes('/media')),false);
        console.log('PASS 系统代理通路：资料库域名无法直连时，原生网络通道仍可完成同步');
      }finally{await session.defaultSession.setProxy({mode:'system'});await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
    }
    {
      let reads=0;const account={id:'303',handle:'test',name:'测试'};
      service.store.ingest([{id:'3030',author:'test',authorName:'测试',text:'手动保存测试',publishedAt:null,url:'https://x.com/test/status/3030',media:[{type:'photo',url:'https://pbs.twimg.com/test.jpg',thumbnail:'https://pbs.twimg.com/test.jpg'},{type:'video',url:'https://video.twimg.com/native-test.mp4',thumbnail:'https://pbs.twimg.com/poster.jpg'}]}],account.id,'bookmark');
      await session.defaultSession.protocol.handle('https',async request=>{assert.equal(new URL(request.url).hostname,'video.twimg.com');reads++;return new Response('native-video-stream',{headers:{'Content-Type':'video/mp4'}});});
      try{
        const collector=new Collector(()=>{});const result=await collector.cacheVideos(connection,['3030']);
        assert.deepEqual(result,{saved:1,failed:0,total:1});assert.equal(reads,1);assert.equal(readdirSync(join(work,'library/media')).length,2);
        console.log('PASS 原生网络手动保存：只下载所选视频，流式上传成功，不保存图片');
      }finally{session.defaultSession.protocol.unhandle('https');}
    }
    {
      const log=readFileSync(join(work,'connection.log'),'utf8');
      const previous=readFileSync(join(work,'connection.previous.log'),'utf8');
      for(const secret of [connection.url,connection.token,'nas.invalid','legacy-nas.example','legacy-proxy.example'])assert.ok(!(log+previous).includes(secret));
      assert.ok(!log.includes('"origin"'));
      assert.ok(log.includes('EHOSTUNREACH')&&log.includes('检查资料库连接')&&log.includes('"status":200'));
      console.log('PASS 连接诊断：真实采集器日志保留阶段和状态，不记录资料库地址或设备凭证');
    }
    console.log('11 项采集器场景检查通过；仅使用模拟 X 响应和本机测试资料库。');
  } finally { await service.close(); }
}).catch(error => { console.error(error); exitCode = 1; }).finally(() => app.exit(exitCode));
