import { app, BrowserWindow, session, type Session } from 'electron';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTimeline } from '../shared/x-parser';
import type { Account, Connection, Source, SyncState } from '../shared/types';
import { saveMedia } from './media-cache';
type Template = { url: string; method: string; headers: Record<string,string>; postData?: string };
type Packet = { template: Template; json: any };
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export class Collector {
  window:BrowserWindow|null=null;
  session:Session;
  stopped=false;
  running=false;
  packets = new Map<Source,Packet>();
  waiting = new Map<Source,(packet:Packet)=>void>();
  account:Account|null=null;
  constructor(private notify:(state:SyncState)=>void) { this.session=session.fromPartition('persist:shizang-x'); }
  async status(){
    const cookies=await this.session.cookies.get({url:'https://x.com'});
    const connected=cookies.some(c=>c.name==='auth_token'&&!!c.value);
    const id=cookies.find(c=>c.name==='twid')?.value.replace(/^u%3D|^u=/,'');
    if(connected && id && /^\d+$/.test(id) && this.account?.id!==id)this.account={id,handle:'',name:'我的 X 账号'};
    if(!connected)this.account=null;
    return {connected,account:this.account};
  }
  async open(show=true){
    if(this.window&&!this.window.isDestroyed()){if(show){this.window.show();this.window.focus();}return;}
    const log=(message:string)=>{try{appendFileSync(join(app.getPath('userData'),'connection.log'),new Date().toISOString()+' '+message+'\n',{mode:0o600});}catch{}};
    await this.session.setProxy({mode:'system'});
    log('X connection: '+await this.session.resolveProxy('https://x.com'));
    const w=new BrowserWindow({width:1000,height:800,title:'连接 X · 拾藏',show,webPreferences:{session:this.session,nodeIntegration:false,contextIsolation:true,sandbox:true}});
    w.webContents.on('did-fail-load',(_event,code,description,_url,mainFrame)=>{if(mainFrame){log(`Load failure: ${code} ${description}`);this.notify({running:false,state:'error',count:0,message:`X 页面加载失败：${description}`});}});
    w.webContents.on('did-finish-load',()=>{if(w.webContents.getURL().startsWith('https://'))log('X page loaded');});
    this.window=w;w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    w.webContents.on('will-navigate',(event,url)=>{try{const host=new URL(url).hostname;if(!(host==='x.com'||host.endsWith('.x.com')||host==='twitter.com'||host.endsWith('.twitter.com')))event.preventDefault();}catch{event.preventDefault();}});
    const requests=new Map<string,Template>();const responseIds=new Set<string>();
    await w.loadURL('about:blank');
    w.webContents.debugger.attach('1.3');log('Network listener attached');await w.webContents.debugger.sendCommand('Network.enable',{maxResourceBufferSize:20000000,maxTotalBufferSize:60000000});log('Network listener enabled');
    w.webContents.debugger.on('message',async(_,method,params)=>{
      const typeFor=(url:string):Source|null=>/\/graphql\/[^/?]+\/Bookmarks(?:\?|$)/.test(url)?'bookmark':/\/graphql\/[^/?]+\/Likes(?:\?|$)/.test(url)?'like':null;
      if(method==='Network.requestWillBeSent' && typeFor(params.request.url))requests.set(params.requestId,{url:params.request.url,method:params.request.method,headers:params.request.headers,postData:params.request.postData});
      if(method==='Network.requestWillBeSentExtraInfo' && requests.has(params.requestId)){const t=requests.get(params.requestId)!;t.headers={...t.headers,...params.headers};}
      if(method==='Network.responseReceived' && typeFor(params.response.url))responseIds.add(params.requestId);
      if(method==='Network.loadingFinished' && responseIds.has(params.requestId)){
        const template=requests.get(params.requestId);responseIds.delete(params.requestId);requests.delete(params.requestId);
        if(!template)return;const source=typeFor(template.url)!;
        try{const b=await w.webContents.debugger.sendCommand('Network.getResponseBody',{requestId:params.requestId});const json=JSON.parse(b.base64Encoded?Buffer.from(b.body,'base64').toString('utf8'):b.body);
          if(!parseTimeline(json).recognized)return;const packet={template,json};this.packets.set(source,packet);this.waiting.get(source)?.(packet);this.waiting.delete(source);
        }catch{}
      }
    });
    w.on('closed',()=>{this.window=null;this.stopped=true;});
    await w.loadURL('https://x.com/i/bookmarks').catch(e=>{log('Open failed: '+String(e?.code??e?.message));throw new Error('X 页面无法加载，请检查当前网络连接后重试');});
  }
  async logout(){if(this.running)throw new Error('请先停止同步');this.window?.close();await this.session.clearStorageData();this.account=null;this.packets.clear();}
  stop(){this.stopped=true;}
  async cache(connection:Connection,ids?:string[],originals=false){
    if(this.running)throw new Error('请等待当前同步结束');this.running=true;this.stopped=false;
    try{
      this.notify({running:true,state:'running',count:0,message:originals?'正在保存原始媒体':'正在保存预览图'});
      const result=await saveMedia(connection,{ids,originals,stopped:()=>this.stopped,progress:(saved,total,failed)=>this.notify({running:true,state:'running',count:saved,message:`正在保存${originals?'原始媒体':'预览图'} ${saved+failed} / ${total}`})});
      this.notify({running:false,state:this.stopped?'stopped':'complete',count:result.saved,message:this.stopped?'已停止保存媒体':`已保存 ${result.saved} 个媒体文件${result.failed?`，${result.failed} 个暂未保存，可重新尝试`:''}`});return result;
    }catch(e){this.notify({running:false,state:'error',count:0,message:e instanceof Error?e.message:'媒体保存失败'});throw e;}
    finally{this.running=false;}
  }
  private async first(source:Source,background=false):Promise<Packet>{
    await this.open(!background);const w=this.window!;
    this.packets.delete(source);
    const packet=new Promise<Packet>((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.waiting.delete(source);reject(new Error(`X 没有返回${source==='bookmark'?'收藏':'点赞'}列表，请在登录窗口完成登录后重新同步`));},180000);
      this.waiting.set(source,p=>{clearTimeout(timeout);resolve(p);});
      const check=setInterval(()=>{if(this.stopped){clearInterval(check);clearTimeout(timeout);this.waiting.delete(source);reject(new Error('同步已停止'));}},500);
      void Promise.resolve().then(async()=>{try{await packet;}catch{}finally{clearInterval(check);}});
    });
    const url=source==='bookmark'?'https://x.com/i/bookmarks':'https://x.com/i/history/likes';
    await w.loadURL(url).catch(()=>{});return packet;
  }
  private async replay(t:Template,cursor:string){
    if(!this.window||this.window.isDestroyed())throw new Error('X 登录窗口已关闭');
    const url=new URL(t.url);const variables=JSON.parse(url.searchParams.get('variables')??'{}');variables.cursor=cursor;url.searchParams.set('variables',JSON.stringify(variables));
    const headers=Object.fromEntries(Object.entries(t.headers).filter(([k])=>/^(authorization|x-csrf-token|x-twitter-active-user|x-twitter-auth-type|content-type|x-client-transaction-id)$/i.test(k)));
    const script=`(async()=>{ const r=await fetch(${JSON.stringify(url.href)},{method:${JSON.stringify(t.method)},headers:${JSON.stringify(headers)},credentials:'include'});return {status:r.status,retryAfter:r.headers.get('retry-after'),text:await r.text()};})()`;
    const r=await this.window.webContents.executeJavaScript(script);
    if(r.status===429)throw Object.assign(new Error('X 请求频率受限'),{rateLimited:true,retryAfter:r.retryAfter});
    if(r.status===401||r.status===403)throw new Error('X 登录已过期或要求验证，请在登录窗口处理后重新同步');
    if(r.status!==200)throw new Error(`X 暂时无法读取资料（${r.status}）`);
    const json=JSON.parse(r.text);if(json.errors?.length && !json.data)throw new Error(json.errors[0].message??'X 返回错误');return json;
  }
  async sync(options:{connection:Connection;sources:Source[];mode:'recent'|'full';background?:boolean}){
    if(this.running)throw new Error('已有同步任务');this.running=true;this.stopped=false;let total=0;
    const api=async(path:string,body?:any)=>{
      const response=await fetch(options.connection.url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+options.connection.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
      const json=await response.json();if(!response.ok)throw new Error(json.error??'资料库连接失败');return json;
    };
    try{
      for(const source of options.sources){
        if(this.stopped)break;
        this.notify({running:true,state:'login',source,count:total,message:`正在打开 X ${source==='bookmark'?'收藏':'点赞'}列表`});
        const first=await this.first(source,options.background);await this.status();
        if(!this.account)throw new Error('无法识别当前 X 账号，请重新登录');
        if(this.window){try{const label=await this.window.webContents.executeJavaScript("document.querySelector('[data-testid=\"SideNav_AccountSwitcher_Button\"]')?.innerText || ''");const h=label.match(/@([\w]+)/)?.[1];if(h)this.account={...this.account,handle:h,name:label.split('\n')[0]||h};}catch{}}
        const job=await api('/api/jobs',{account:this.account,source,mode:options.mode});let cursor:string|null=null;let json=first.json;let verifiedEnd=false;let state='complete';let emptyPages=0;
        try{
          while(!this.stopped){
            const parsed=parseTimeline(json);if(!parsed.recognized)throw new Error('X 返回的数据格式已变化，已保存的资料保留');
            const known=options.mode==='recent'&&parsed.posts.length?(await api('/api/known',{ids:parsed.posts.map(p=>p.id),accountId:this.account.id,source})).ids as string[]:[];
            await api(`/api/jobs/${job.id}/batch`,{posts:parsed.posts,cursor:parsed.cursor??''});total+=parsed.posts.length;
            cursor=parsed.cursor;
            this.notify({running:true,state:'running',source,count:total,message:`已读取 ${total} 条${source==='bookmark'?'收藏':'点赞'}资料`,jobId:job.id});
            if(parsed.terminal){verifiedEnd=true;break;}
            if(options.mode==='recent'&&parsed.posts.length>0&&known.length===parsed.posts.length)break;
            if(!parsed.posts.length)emptyPages++;else emptyPages=0;
            if(!cursor){verifiedEnd=true;break;}
            if(emptyPages>=2){verifiedEnd=true;break;}
            await delay(1300);
            let retries=0;
            while(true){
              if(this.stopped)break;
              try{json=await this.replay(first.template,cursor);break;}
              catch(e:any){if(!e.rateLimited||retries++>=3)throw e;
                const seconds=Math.min(180,Math.max(30,Number(e.retryAfter)||30*retries));this.notify({running:true,state:'waiting',source,count:total,message:`X 要求等待，${seconds} 秒后继续`});
                for(let i=0;i<seconds&&!this.stopped;i++)await delay(1000);
              }
            }
          }
          if(this.stopped)state='stopped';
          await api(`/api/jobs/${job.id}/finish`,{state,verifiedEnd,cursor,message:this.stopped?'同步已停止，已收录资料保留':verifiedEnd?'已读取 X 本次提供的列表':'新增资料已同步'});
        }catch(e){await api(`/api/jobs/${job.id}/finish`,{state:this.stopped?'stopped':'error',verifiedEnd:false,cursor,message:e instanceof Error?e.message:'同步失败'}).catch(()=>{});throw e;}
      }
      this.window?.hide();
      let mediaSaved=0,mediaFailed=0;
      if(!this.stopped){const media=await saveMedia(options.connection,{stopped:()=>this.stopped,progress:(saved,planned,failed)=>this.notify({running:true,state:'running',count:total,message:`资料已收录，正在保存预览图 ${saved+failed} / ${planned}`})});mediaSaved=media.saved;mediaFailed=media.failed;}
      this.notify({running:false,state:this.stopped?'stopped':'complete',count:total,message:this.stopped?'已停止，已收录资料保留':`同步完成，读取 ${total} 条资料，保存 ${mediaSaved} 个预览文件${mediaFailed?`，${mediaFailed} 个可在下次同步时重试`:''}`});
    }catch(e){this.notify({running:false,state:this.stopped?'stopped':'error',count:total,message:e instanceof Error?e.message:'同步失败'});}
    finally{this.running=false;}
  }
}
