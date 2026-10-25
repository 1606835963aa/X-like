import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryRequest,networkErrorCode,type LibraryRequestEvent} from '../src/desktop/library-client';

const connection={url:'http://192.168.1.100:5368',token:'test-private-device-token'};

test('资料库网络错误保留连接阶段和底层错误码，不重试、不记录凭证或资料正文',async()=>{
  const events:LibraryRequestEvent[]=[];let requests=0;
  const cause=Object.assign(new Error('unreachable'),{code:'EHOSTUNREACH'});
  const request=createLibraryRequest(connection,{fetcher:async()=>{requests++;throw new TypeError('fetch failed',{cause:new AggregateError([cause])});},log:event=>events.push(event)});
  await assert.rejects(request('/api/jobs/123/batch',{posts:[{text:'private-post-body'}]}),/无法连接资料库.*EHOSTUNREACH/);
  assert.equal(requests,1);assert.deepEqual(events,[{origin:connection.url,action:'保存新增资料',status:undefined,code:'EHOSTUNREACH'}]);
  assert.equal(JSON.stringify(events).includes(connection.token),false);assert.equal(JSON.stringify(events).includes('private-post-body'),false);
});

test('资料库认证与服务错误明确归属资料库，不要求重新登录 X',async()=>{
  const unauthorized=createLibraryRequest(connection,{fetcher:async()=>Response.json({error:'invalid device'},{status:401})});
  await assert.rejects(unauthorized('/api/stats'),/资料库连接凭证已失效/);
  const unavailable=createLibraryRequest(connection,{fetcher:async()=>Response.json({error:'unavailable'},{status:503})});
  await assert.rejects(unavailable('/api/jobs',{}),/资料库创建同步任务失败.*503/);
});

test('资料库请求保留请求方法和鉴权，非 JSON 响应不误报成 X 网络故障',async()=>{
  const requests:{url:string;options?:RequestInit}[]=[];
  const request=createLibraryRequest(connection,{fetcher:async(url,options)=>{requests.push({url,options});return Response.json({id:'job-1'},{status:201});}});
  assert.deepEqual(await request('/api/stats'),{id:'job-1'});assert.equal(requests[0].options!.method,'GET');
  await request('/api/jobs',{source:'bookmark'});assert.equal(requests[1].options!.method,'POST');
  assert.equal(requests[1].options!.body,'{"source":"bookmark"}');assert.equal((requests[1].options!.headers as Record<string,string>).Authorization,'Bearer '+connection.token);
  const invalid=createLibraryRequest(connection,{fetcher:async()=>new Response('<html>not a library</html>')});
  await assert.rejects(invalid('/api/stats'),/资料库返回了无法识别的响应/);
});

test('资料库超时与手动取消具有明确错误码，不进行自动重试',async()=>{
  let requests=0;
  const request=createLibraryRequest(connection,{fetcher:async()=>{requests++;throw new DOMException('timeout','TimeoutError');}});
  await assert.rejects(request('/api/stats'),/资料库.*超时/);assert.equal(requests,1);
  assert.equal(networkErrorCode(new DOMException('cancelled','AbortError')),'ABORTED');
  assert.equal(networkErrorCode(new Error('net::ERR_CONNECTION_REFUSED')),'ERR_CONNECTION_REFUSED');
});
