import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createReadStream, createWriteStream, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join, extname, basename } from 'node:path';
import { randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { Store } from './store';
import { parseImport } from '../shared/x-parser';
import type { Post, Source } from '../shared/types';

type Options = { dataDir: string; uiDir?: string; host?: string; port?: number; name?: string; pairingKey?: string };
export async function startService(options: Options) {
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(options.dataDir, 0o700);
  const store = new Store(join(options.dataDir, 'library.sqlite'));
  const keyFile = join(options.dataDir, 'pairing-key');
  let pairingKey = options.pairingKey || (existsSync(keyFile) ? readFileSync(keyFile,'utf8').trim() : randomBytes(9).toString('hex').toUpperCase());
  if (!existsSync(keyFile)) writeFileSync(keyFile, pairingKey, { mode: 0o600 });
  const signKeyFile = join(options.dataDir, 'media-key');
  const signKey = existsSync(signKeyFile) ? readFileSync(signKeyFile,'utf8') : randomBytes(32).toString('hex');
  if(!existsSync(signKeyFile))writeFileSync(signKeyFile, signKey, { mode: 0o600 });
  const mediaDir = join(options.dataDir, 'media'); mkdirSync(mediaDir, { recursive: true });
  const failures = new Map<string,{count:number,until:number}>();
  let server: http.Server;
  const equal = (a: string,b: string) => { const aa=Buffer.from(a),bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb); };
  const sign = (path: string, expires: string) => createHmac('sha256',signKey).update(path+'|'+expires).digest('hex').slice(0,32);
  const signed = (path: string) => { const expires=String(Math.floor(Date.now()/1000)+86400); return `${path}?expires=${expires}&key=${sign(path,expires)}`; };
  const decorate = (p: Post) => ({ ...p, avatarPath: p.avatar ? signed(`/api/media/${p.id}/avatar`) : '', media: p.media.map((m,i)=>({...m,cachedOriginal:!!cached(m.url,mediaDir),cachedPreview:!!cached(m.thumbnail,mediaDir),thumbnailPath:signed(`/api/media/${p.id}/${i}/thumbnail`),filePath:signed(`/api/media/${p.id}/${i}/file`)})) });
  function send(res: ServerResponse, status: number, value: unknown) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
  async function body(req: IncomingMessage, limit = 50 * 1024 * 1024) { const chunks: Buffer[]=[];let n=0; for await (const c of req){ n+=c.length;if(n>limit)throw new Error('文件超过 50 MB，请分批导入');chunks.push(c); } return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'); }
  async function request(req: IncomingMessage,res: ServerResponse) {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    const origin = req.headers.origin;
    if(origin && /^(https?:\/\/[^/]+|capacitor:\/\/localhost|ionic:\/\/localhost|null)$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Max-Age','600');
    }
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const url = new URL(req.url??'/', 'http://localhost'); const path = url.pathname;
    try {
      if(path==='/api/health'){send(res,200,{ok:true,app:'shizang',version:'0.1.0',name:options.name??'拾藏资料库'});return;}
      if(path==='/api/pair' && req.method==='POST'){
        const ip=req.socket.remoteAddress??'unknown';const f=failures.get(ip);
        if(f && f.count>=6 && f.until>Date.now()){send(res,429,{error:'连接码尝试过多，请稍后再试'});return;}
        const b=await body(req,10000);
        if(!equal(String(b.key??'').replace(/\s/g,'').toUpperCase(),pairingKey.toUpperCase())){
          const old=f && f.until>Date.now()?f.count:0;failures.set(ip,{count:old+1,until:Date.now()+60000});send(res,401,{error:'连接码不正确'});return;
        }
        failures.delete(ip);const token=randomBytes(32).toString('base64url');const id=store.addDevice(b.name??'新设备',token);
        send(res,200,{token,deviceId:id,name:options.name??'拾藏资料库'});return;
      }
      if(path.startsWith('/api/media/')) {
        const expires=url.searchParams.get('expires')??'', key=url.searchParams.get('key')??'';
        if(Number(expires)<Date.now()/1000 || !equal(key,sign(path,expires))){send(res,401,{error:'图片链接已过期，请刷新资料库'});return;}
        const [, , ,id,index,kind]=path.split('/'); const p=store.getPost(id);
        if(!p){send(res,404,{error:'资料不存在'});return;}
        const remote = index==='avatar' ? p.avatar : kind==='thumbnail' ? p.media[Number(index)]?.thumbnail : p.media[Number(index)]?.url;
        if(!remote){send(res,404,{error:'媒体不存在'});return;}
        const alternative=index!=='avatar'&&p.media[Number(index)]?(kind==='thumbnail'?p.media[Number(index)].url:p.media[Number(index)].type==='photo'?p.media[Number(index)].thumbnail:''):'';
        const file=cached(remote,mediaDir)||cached(alternative??'',mediaDir)||await download(remote,mediaDir);
        const size=statSync(file.path).size;const range=req.headers.range;
        if(range && /^bytes=\d*-\d*$/.test(range)){
          const [,startText,endText]=/bytes=(\d*)-(\d*)/.exec(range)!;
          const start=startText?Number(startText):Math.max(0,size-Number(endText)); const end=endText && startText?Math.min(size-1,Number(endText)):size-1;
          if(start> end || start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
          res.writeHead(206,{'Content-Type':file.type,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Cache-Control':'private,max-age=86400'});
          createReadStream(file.path,{start,end}).pipe(res);
        }else{res.writeHead(200,{'Content-Type':file.type,'Content-Length':size,'Accept-Ranges':'bytes','Cache-Control':'private,max-age=86400'});createReadStream(file.path).pipe(res);}
        return;
      }
      if(path.startsWith('/api/')) {
        const token=String(req.headers.authorization??'').replace(/^Bearer /,'');const device=token?store.authorize(token):null;
        if(!device){send(res,401,{error:'请重新连接资料库'});return;}
        const q=Object.fromEntries(url.searchParams);
        if(path==='/api/media-cache/plan'&&req.method==='POST'){
          const b=await body(req,100000);const ids=Array.isArray(b.ids)?new Set(b.ids.slice(0,1000).map(String)):null;
          const assets=new Map<string,{id:string;index:string;kind:string;url:string}>();
          for(const row of store.db.prepare('SELECT id,media,avatar FROM posts').all() as any[]){
            if(ids&&!ids.has(row.id))continue;
            const add=(remote:string,index:string,kind:string)=>{if(!remote||cached(remote,mediaDir))return;try{safeRemote(remote);assets.set(remote,{id:row.id,index,kind,url:remote});}catch{}};
            const media=JSON.parse(row.media);
            for(let i=0;i<media.length;i++)add(b.originals?media[i].url:media[i].thumbnail||media[i].url,String(i),b.originals?'file':'thumbnail');
            if(!b.originals)add(row.avatar,'avatar','file');
          }
          send(res,200,{assets:[...assets.values()]});return;
        }
        const upload=/^\/api\/media-cache\/(\d+)\/(\d+|avatar)\/(thumbnail|file)$/.exec(path);
        if(upload&&req.method==='POST'){
          const p=store.getPost(upload[1]);if(!p)throw new Error('资料不存在');
          const remote=upload[2]==='avatar'?p.avatar:upload[3]==='thumbnail'?p.media[Number(upload[2])]?.thumbnail||p.media[Number(upload[2])]?.url:p.media[Number(upload[2])]?.url;
          if(!remote)throw new Error('媒体不存在');safeRemote(remote);
          const type=String(req.headers['content-type']??'').split(';')[0];
          if(!/^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm))$/.test(type))throw new Error('媒体文件格式不受支持');
          const target=mediaFile(remote,mediaDir),temporary=target+'.'+randomBytes(6).toString('hex')+'.part';let size=0;
          try{await pipeline(req,new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>250*1024*1024?new Error('单个媒体超过 250 MB'):null,chunk);}}),createWriteStream(temporary,{mode:0o600}));
            renameSync(temporary,target);writeFileSync(target+'.json',JSON.stringify({type,url:remote}),{mode:0o600});send(res,200,{ok:true,size});
          }catch(e){try{unlinkSync(temporary);}catch{}throw e;}return;
        }
        if(path==='/api/stats'){send(res,200,store.stats());return;}
        if(path==='/api/posts' && req.method==='GET'){const r=store.list(q);send(res,200,{...r,items:r.items.map(decorate)});return;}
        if(path==='/api/posts' && req.method==='PATCH'){const b=await body(req);if(!Array.isArray(b.ids)||typeof b.change!=='object')throw new Error('缺少要修改的资料');send(res,200,store.edit(b.ids,b.change));return;}
        if(path.match(/^\/api\/posts\/\d+$/) && req.method==='GET'){const p=store.getPost(path.split('/').at(-1)!);send(res,p?200:404,p?decorate(p):{error:'资料不存在'});return;}
        if(path==='/api/known' && req.method==='POST'){const b=await body(req);const ids=(b.ids??[]).slice(0,1000);send(res,200,{ids:ids.filter((id:string)=>b.accountId&&b.source?store.db.prepare('SELECT 1 FROM sources WHERE post_id=? AND account_id=? AND kind=? AND active=1').get(id,b.accountId,b.source):store.getPost(id))});return;}
        if(path==='/api/import' && req.method==='POST'){
          const b=await body(req);const parsed=parseImport(String(b.content??''),String(b.filename??''));
          if(!Array.isArray(parsed)){send(res,200,store.importBackup(parsed.backup));return;}
          const source:Source=b.source==='like'?'like':'bookmark';const account={id:'import',handle:'',name:'文件导入'};store.upsertAccount(account);
          let added=0;for(let i=0;i<parsed.length;i+=500)added+=store.ingest(parsed.slice(i,i+500),account.id,source).added;
          send(res,200,{added,saved:parsed.length});return;
        }
        if(path==='/api/export' && req.method==='GET'){
          if(q.format==='backup'){send(res,200,store.exportAll());return;}
          const items:Post[]=[];let page=1;while(true){const r=store.list({...q,page:String(page++),limit:'100'});items.push(...r.items);if(items.length>=r.total)break;}
          if(q.format==='csv'){
            const cell=(s:unknown)=>{const value=String(s??'');const text=/^[=+\-@\t\r']/.test(value)?"'"+value:value;return '"'+text.replace(/"/g,'""')+'"';};
            const csv='\uFEFF'+[['推文编号','作者','用户名','发布时间','首次收录时间','正文','收藏','点赞','标签','文件夹','备注','已读','原文链接'],...items.map(p=>[p.id,p.authorName,p.author,p.publishedAt,p.firstSeenAt,p.text,p.sources.includes('bookmark')?'是':'否',p.sources.includes('like')?'是':'否',p.tags.join('、'),p.folder,p.note,p.read?'是':'否',p.url])].map(r=>r.map(cell).join(',')).join('\r\n');
            res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="shizang.csv"'});res.end(csv);return;
          }
          send(res,200,{format:'shizang',version:1,exportedAt:new Date().toISOString(),posts:items});return;
        }
        if(path==='/api/jobs' && req.method==='POST'){
          const b=await body(req);if(!b.account?.id||!['bookmark','like'].includes(b.source))throw new Error('缺少同步账号或来源');
          send(res,200,{id:store.startJob(b.account,b.source,b.mode==='full'?'full':'recent')});return;
        }
        const match=/^\/api\/jobs\/([\w-]+)(?:\/(batch|finish))?$/.exec(path);
        if(match){
          const job=store.getJob(match[1]);if(!job){send(res,404,{error:'同步任务不存在'});return;}
          if(req.method==='GET'){send(res,200,job);return;}
          const b=await body(req);
          if(match[2]==='batch'){
            if(job.state!=='running')throw new Error('任务已结束');if(!Array.isArray(b.posts)||b.posts.length>500)throw new Error('每批最多 500 条');
            const r=store.ingest(b.posts,job.account_id,job.source,job.id);
            if(typeof b.cursor==='string')store.db.prepare('UPDATE jobs SET cursor=? WHERE id=?').run(b.cursor,job.id);
            send(res,200,r);return;
          }
          if(match[2]==='finish'){const state=['complete','stopped','error','partial'].includes(b.state)?b.state:'partial';send(res,200,store.finishJob(job.id,state,b.verifiedEnd===true,b.cursor,b.message));return;}
        }
        if(path==='/api/devices' && req.method==='GET'){send(res,200,{current:device.id,devices:store.db.prepare('SELECT id,name,created_at,last_seen_at FROM devices ORDER BY last_seen_at DESC').all()});return;}
        if(path.startsWith('/api/devices/') && req.method==='DELETE'){store.db.prepare('DELETE FROM devices WHERE id=?').run(path.split('/').at(-1)!);send(res,200,{ok:true});return;}
        if(path==='/api/connection' && req.method==='GET'){send(res,200,{name:options.name??'拾藏资料库',pairingKey});return;}
        send(res,404,{error:'没有这个接口'});return;
      }
      if(req.method!=='GET'){send(res,405,{error:'不支持此操作'});return;}
      if(options.uiDir){
        let filename=resolve(options.uiDir,decodeURIComponent(path).replace(/^\//,''));
        if(!filename.startsWith(resolve(options.uiDir)+'/'))filename=join(options.uiDir,'index.html');
        if(!existsSync(filename)||statSync(filename).isDirectory())filename=join(options.uiDir,'index.html');
        if(existsSync(filename)){
          const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
          res.writeHead(200,{'Content-Type':types[extname(filename)]??'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' blob: http: https:; connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});createReadStream(filename).pipe(res);return;
        }
      }
      send(res,404,{error:'界面文件尚未构建'});
    }catch(e){if(!res.headersSent)send(res,400,{error:e instanceof Error?e.message:'操作失败'});else res.end();}
  }
  server=http.createServer((req,res)=>{void request(req,res);});
  await new Promise<void>((r,j)=>{server.once('error',j);server.listen(options.port??0,options.host??'127.0.0.1',()=>r());});
  const address=server.address() as import('node:net').AddressInfo;
  return { server,store,port:address.port,pairingKey,createDevice(name:string){const token=randomBytes(32).toString('base64url');store.addDevice(name,token);return token;},close:()=>new Promise<void>((resolve)=>server.close(()=>{store.close();resolve();})) };
}

const downloads=new Map<string,Promise<{path:string;type:string}>>();
const mediaFile=(url:string,dir:string)=>join(dir,createHash('sha256').update(url).digest('hex'));
function safeRemote(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||!(u.hostname==='twimg.com'||u.hostname.endsWith('.twimg.com'))||u.username||u.password)throw new Error('媒体地址不受支持');return u;}
function cached(url:string,dir:string):{path:string;type:string}|null{if(!url)return null;const file=mediaFile(url,dir);if(!existsSync(file)||!existsSync(file+'.json'))return null;try{return{path:file,type:JSON.parse(readFileSync(file+'.json','utf8')).type};}catch{return null;}}
async function download(url:string,dir:string):Promise<{path:string;type:string}> {
  const safe=safeRemote;
  safe(url);const hash=createHash('sha256').update(url).digest('hex');const file=join(dir,hash);const meta=file+'.json';
  if(existsSync(file)&&existsSync(meta))return{path:file,type:JSON.parse(readFileSync(meta,'utf8')).type};
  const key=dir+'|'+hash;if(downloads.has(key))return downloads.get(key)!;
  const promise=(async()=>{
    let remote=url,response:Response|undefined;
    for(let attempt=0;attempt<4;attempt++){
      safe(remote);response=await fetch(remote,{redirect:'manual',signal:AbortSignal.timeout(45000)});
      if(response.status>=300&&response.status<400&&response.headers.get('location')){remote=new URL(response.headers.get('location')!,remote).href;continue;}break;
    }
    if(!response?.ok)throw new Error('X 暂时无法提供这个媒体文件');
    const type=(response.headers.get('content-type')??'application/octet-stream').split(';')[0];
    if(!/^(image|video)\//.test(type))throw new Error('媒体文件格式不受支持');
    const max=250*1024*1024;let size=0;
    if(Number(response.headers.get('content-length'))>max)throw new Error('单个媒体超过 250 MB');
    const temporary=file+'.part';
    try{
      await pipeline(Readable.fromWeb(response.body as any),new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>max?new Error('单个媒体超过 250 MB'):null,chunk);}}),createWriteStream(temporary,{mode:0o600}));
      renameSync(temporary,file);writeFileSync(meta,JSON.stringify({type,url}),{mode:0o600});return{path:file,type};
    }catch(e){try{unlinkSync(temporary);}catch{}throw e;}
  })();downloads.set(key,promise);try{return await promise;}finally{downloads.delete(key);}
}
