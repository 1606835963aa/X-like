import { app, BrowserWindow, session, type Session } from 'electron';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTimeline } from '../shared/x-parser';
import type { Account, Connection, Source, SyncState } from '../shared/types';
import { saveVideos } from './media-cache';
import { blockedXPage, checkXStatus, readXResponse, XSyncBlocked } from './sync-policy';
import { syncTimeline } from './sync-timeline';
import { SyncCooldown } from './sync-cooldown';
type Template = { url: string; method: string; headers: Record<string,string>; postData?: string };
type Packet = { template: Template; json: any };
type Pending = { resolve:(packet:Packet)=>void; reject:(error:Error)=>void };
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export class Collector {
  window:BrowserWindow|null=null;
  session:Session;
  stopped=false;
  running=false;
  private waiting = new Map<Source,Pending>();
  private failure:Error|null=null;
  private collecting=false;
  private cooldown:SyncCooldown;
  account:Account|null=null;
  constructor(private notify:(state:SyncState)=>void) {
    this.session=session.fromPartition('persist:shizang-x');
    this.cooldown=new SyncCooldown(join(app.getPath('userData'),'sync-cooldown.json'));
  }
  async status(){
    const cookies=await this.session.cookies.get({url:'https://x.com'});
    const connected=cookies.some(c=>c.name==='auth_token'&&!!c.value);
    const id=cookies.find(c=>c.name==='twid')?.value.replace(/^u%3D|^u=/,'');
    if(connected && id && /^\d+$/.test(id) && this.account?.id!==id)this.account={id,handle:'',name:'我的 X 账号'};
    if(!connected)this.account=null;
    return {connected,account:this.account};
  }
  private interrupt(error:Error){
    if(!this.collecting)return;
    this.failure??=error;
    for(const pending of this.waiting.values())pending.reject(error);
  }
  private check(){if(this.failure)throw this.failure;}
  private async ensureWindow(show=true){
    if(this.window&&!this.window.isDestroyed()){if(show){this.window.show();this.window.focus();}return;}
    const log=(message:string)=>{try{appendFileSync(join(app.getPath('userData'),'connection.log'),new Date().toISOString()+' '+message+'\n',{mode:0o600});}catch{}};
    await this.session.setProxy({mode:'system'});
    log('X connection: '+await this.session.resolveProxy('https://x.com'));
    const w=new BrowserWindow({width:1000,height:800,title:'连接 X · 拾藏',show,webPreferences:{session:this.session,nodeIntegration:false,contextIsolation:true,sandbox:true}});
    w.webContents.on('did-fail-load',(_event,code,description,_url,mainFrame)=>{if(mainFrame&&code!==-3){log(`Load failure: ${code} ${description}`);const error=new Error(`X 页面加载失败：${description}`);if(this.collecting)this.interrupt(error);else this.notify({running:false,state:'error',count:0,message:error.message});}});
    w.webContents.on('did-finish-load',()=>{if(w.webContents.getURL().startsWith('https://'))log('X page loaded');});
    this.window=w;w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    w.webContents.on('will-navigate',(event,url)=>{try{const host=new URL(url).hostname;if(!(host==='x.com'||host.endsWith('.x.com')||host==='twitter.com'||host.endsWith('.twitter.com')))event.preventDefault();}catch{event.preventDefault();}});
    const requests=new Map<string,Template>();const responses=new Map<string,{status:number;retryAfter?:string;reset?:string}>();
    const navigation=(_event:unknown,url:string)=>{const error=blockedXPage(url);if(error)this.interrupt(error);};
    w.webContents.on('did-navigate',navigation);w.webContents.on('did-redirect-navigation',navigation);
    await w.loadURL('about:blank');
    w.webContents.debugger.attach('1.3');log('Network listener attached');await w.webContents.debugger.sendCommand('Network.enable',{maxResourceBufferSize:20000000,maxTotalBufferSize:60000000});log('Network listener enabled');
    w.webContents.debugger.on('message',async(_,method,params)=>{
      const typeFor=(url:string):Source|null=>/\/graphql\/[^/?]+\/Bookmarks(?:\?|$)/.test(url)?'bookmark':/\/graphql\/[^/?]+\/Likes(?:\?|$)/.test(url)?'like':null;
      if(method==='Network.requestWillBeSent' && typeFor(params.request.url))requests.set(params.requestId,{url:params.request.url,method:params.request.method,headers:params.request.headers,postData:params.request.postData});
      if(method==='Network.requestWillBeSentExtraInfo' && requests.has(params.requestId)){const t=requests.get(params.requestId)!;t.headers={...t.headers,...params.headers};}
      if(method==='Network.responseReceived' && typeFor(params.response.url)){
        const {status,headers}=params.response;const header=(name:string)=>Object.entries(headers??{}).find(([key])=>key.toLowerCase()===name)?.[1] as string|undefined;
        const retryAfter=header('retry-after'),reset=header('x-rate-limit-reset');
        try{checkXStatus(status,retryAfter,reset);responses.set(params.requestId,{status,retryAfter,reset});}
        catch(error){requests.delete(params.requestId);this.interrupt(error as Error);}
      }
      if(method==='Network.loadingFailed' && requests.has(params.requestId)){
        requests.delete(params.requestId);responses.delete(params.requestId);this.interrupt(new Error('X 资料请求中断，同步已停止。'));
      }
      if(method==='Network.loadingFinished' && responses.has(params.requestId)){
        const template=requests.get(params.requestId),response=responses.get(params.requestId)!;responses.delete(params.requestId);requests.delete(params.requestId);
        if(!template)return;const source=typeFor(template.url)!;
        try{const b=await w.webContents.debugger.sendCommand('Network.getResponseBody',{requestId:params.requestId});const json=readXResponse(response.status,b.base64Encoded?Buffer.from(b.body,'base64').toString('utf8'):b.body,response.retryAfter,response.reset);
          if(!parseTimeline(json).recognized)throw new Error('X 未返回可识别的资料列表，同步已停止。');
          this.waiting.get(source)?.resolve({template,json});
        }catch(error){if(error instanceof XSyncBlocked)this.interrupt(error);else this.waiting.get(source)?.reject(error as Error);}
      }
    });
    w.on('closed',()=>{if(this.window===w)this.window=null;if(this.collecting)this.stop();});
  }
  async open(show=true){
    await this.ensureWindow(show);
    if(this.window?.webContents.getURL()==='about:blank')await this.window.loadURL('https://x.com/i/bookmarks');
  }
  async logout(){if(this.running)throw new Error('请先停止同步');this.window?.close();await this.session.clearStorageData();this.account=null;}
  stop(){this.stopped=true;for(const pending of this.waiting.values())pending.reject(new Error('同步已停止'));}
  async cacheVideos(connection:Connection,ids:string[]){
    if(this.running)throw new Error('请等待当前同步结束');this.running=true;this.stopped=false;
    try{
      this.notify({running:true,state:'running',count:0,message:'正在保存视频'});
      const result=await saveVideos(connection,{ids,stopped:()=>this.stopped,progress:(saved,total,failed)=>this.notify({running:true,state:'running',count:saved,message:`正在保存视频 ${saved+failed} / ${total}`})});
      this.notify({running:false,state:this.stopped?'stopped':'complete',count:result.saved,message:this.stopped?'已停止保存视频':`已保存 ${result.saved} 个视频${result.failed?`，${result.failed} 个暂未保存，可重新尝试`:''}`});return result;
    }catch(e){this.notify({running:false,state:'error',count:0,message:e instanceof Error?e.message:'媒体保存失败'});throw e;}
    finally{this.running=false;}
  }
  private async first(source:Source,background=false):Promise<Packet>{
    await this.ensureWindow(!background);const w=this.window!;
    this.check();if(this.stopped)throw new Error('同步已停止');
    const packet=new Promise<Packet>((resolve,reject)=>{
      const finish=()=>{clearTimeout(timeout);this.waiting.delete(source);};
      const pending:Pending={resolve:p=>{finish();resolve(p);},reject:e=>{finish();reject(e);}};
      const timeout=setTimeout(()=>pending.reject(new Error(`X 没有返回${source==='bookmark'?'收藏':'点赞'}列表，同步已停止。请打开 X 窗口检查登录或验证提示。`)),30000);
      this.waiting.set(source,pending);
      const url=source==='bookmark'?'https://x.com/i/bookmarks':'https://x.com/i/history/likes';
      void w.loadURL(url).catch(()=>pending.reject(new Error('X 页面无法加载，同步已停止。')));
    });
    return packet;
  }
  private async replay(t:Template,cursor:string){
    if(!this.window||this.window.isDestroyed())throw new Error('X 登录窗口已关闭');
    const url=new URL(t.url);const variables=JSON.parse(url.searchParams.get('variables')??'{}');variables.cursor=cursor;url.searchParams.set('variables',JSON.stringify(variables));
    const headers=Object.fromEntries(Object.entries(t.headers).filter(([k])=>/^(authorization|x-csrf-token|x-twitter-active-user|x-twitter-auth-type|content-type|x-client-transaction-id)$/i.test(k)));
    this.check();
    const script=`(async()=>{ const r=await fetch(${JSON.stringify(url.href)},{method:${JSON.stringify(t.method)},headers:${JSON.stringify(headers)},credentials:'include',signal:AbortSignal.timeout(30000)});return {status:r.status,retryAfter:r.headers.get('retry-after'),reset:r.headers.get('x-rate-limit-reset'),text:await r.text()};})()`;
    const r=await this.window.webContents.executeJavaScript(script);
    return readXResponse(r.status,r.text,r.retryAfter,r.reset);
  }
  async sync(options:{connection:Connection;sources:Source[];mode:'recent';background?:boolean}){
    if(this.running)throw new Error('已有同步任务');this.running=true;this.stopped=false;this.failure=null;this.collecting=true;let total=0;
    const api=async(path:string,body?:any)=>{
      const response=await fetch(options.connection.url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+options.connection.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
      const json=await response.json();if(!response.ok)throw new Error(json.error??'资料库连接失败');return json;
    };
    try{
      if(options.mode!=='recent')throw new Error('仅支持同步新增收藏和点赞');
      await this.status();if(!this.account)throw new Error('请先打开 X 窗口完成登录，再手动同步。');
      this.cooldown.check(this.account.id);
      for(const source of new Set(options.sources)){
        if(this.stopped)break;
        this.notify({running:true,state:'login',source,count:total,message:`正在打开 X ${source==='bookmark'?'收藏':'点赞'}列表`});
        const first=await this.first(source,options.background);await this.status();
        if(!this.account)throw new Error('无法识别当前 X 账号，请重新登录');
        if(this.window){try{const label=await this.window.webContents.executeJavaScript("document.querySelector('[data-testid=\"SideNav_AccountSwitcher_Button\"]')?.innerText || ''");const h=label.match(/@([\w]+)/)?.[1];if(h)this.account={...this.account,handle:h,name:label.split('\n')[0]||h};}catch{}}
        const job=await api('/api/jobs',{account:this.account,source,mode:'recent'});let cursor:string|null=null;
        try{
          const result=await syncTimeline({first:first.json,known:async ids=>(await api('/api/known',{ids,accountId:this.account!.id,source})).ids,
            save:async(posts,next)=>{await api(`/api/jobs/${job.id}/batch`,{posts,cursor:next??''});cursor=next;},
            next:next=>this.replay(first.template,next),pause:async()=>{for(let i=0;i<6&&!this.stopped;i++){this.check();await delay(500);}},
            stopped:()=>this.stopped,check:()=>this.check(),progress:added=>{total+=added;this.notify({running:true,state:'running',source,count:total,message:`已收录 ${total} 条新增资料`,jobId:job.id});}});
          await api(`/api/jobs/${job.id}/finish`,{state:this.stopped?'stopped':'complete',verifiedEnd:result.verifiedEnd,cursor:result.cursor,message:this.stopped?'同步已停止，已收录资料保留':'新增资料已同步'});
        }catch(e){await api(`/api/jobs/${job.id}/finish`,{state:this.stopped?'stopped':'error',verifiedEnd:false,cursor,message:e instanceof Error?e.message:'同步失败'}).catch(()=>{});throw e;}
      }
      this.collecting=false;this.window?.destroy();
      this.notify({running:false,state:this.stopped?'stopped':'complete',count:total,message:this.stopped?'已停止，已收录资料保留':`同步完成，收录 ${total} 条新增资料`});
    }catch(e){
      if(e instanceof XSyncBlocked&&e.reason==='rate-limit'&&e.retryAt&&this.account){try{this.cooldown.record(this.account.id,e.retryAt);}catch{}}
      this.notify({running:false,state:this.stopped?'stopped':'error',count:total,message:e instanceof Error?e.message:'同步失败'});
    }
    finally{this.collecting=false;this.window?.destroy();this.running=false;}
  }
}
