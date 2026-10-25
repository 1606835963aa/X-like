import type { Connection } from '../shared/types';

export type FetchRequest = (url:string, options?:RequestInit) => Promise<Response>;
export type LibraryRequestEvent = { origin:string; action:string; status?:number; code?:string };
export class LibraryRequestError extends Error {}

export function networkErrorCode(error:unknown):string {
  const pending:unknown[]=[error],seen=new Set<unknown>();
  while(pending.length&&seen.size<12){
    const value=pending.shift() as any;
    if(!value||typeof value!=='object'||seen.has(value))continue;
    seen.add(value);
    if(typeof value.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code))return value.code;
    const nativeCode=typeof value.message==='string'?value.message.match(/\bnet::(ERR_[A-Z0-9_]+)\b/)?.[1]:undefined;
    if(nativeCode)return nativeCode;
    if(value.name==='TimeoutError'||value.name==='AbortError')return value.name==='TimeoutError'?'TIMEOUT':'ABORTED';
    if(value.cause)pending.push(value.cause);
    if(Array.isArray(value.errors))pending.push(...value.errors);
  }
  return 'NETWORK_ERROR';
}

function actionFor(path:string) {
  if(path==='/api/stats')return '检查资料库连接';
  if(path==='/api/jobs')return '创建同步任务';
  if(path==='/api/known')return '核对已收录资料';
  if(path.endsWith('/batch'))return '保存新增资料';
  if(path.endsWith('/finish'))return '保存同步状态';
  return '访问资料库';
}

export function createLibraryRequest(connection:Connection,options:{fetcher?:FetchRequest;log?:(event:LibraryRequestEvent)=>void;timeoutMs?:number}={}) {
  const fetcher=options.fetcher??((url,init)=>fetch(url,init)),origin=new URL(connection.url).origin;
  return async(path:string,body?:unknown)=>{
    const action=actionFor(path);let status:number|undefined;
    try{
      const response=await fetcher(origin+path,{method:body===undefined?'GET':'POST',credentials:'omit',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(options.timeoutMs??30000)});
      status=response.status;
      let json:any;
      try{json=await response.json();}catch{
        throw new LibraryRequestError(`资料库返回了无法识别的响应（HTTP ${status}），请检查资料库地址。`);
      }
      if(!response.ok){
        if(status===401)throw new LibraryRequestError('资料库连接凭证已失效，请重新连接资料库后同步。');
        throw new LibraryRequestError(`资料库${action}失败（HTTP ${status}），同步已停止。`);
      }
      options.log?.({origin,action,status});return json;
    }catch(error){
      const code=networkErrorCode(error);options.log?.({origin,action,status,code});
      if(error instanceof LibraryRequestError)throw error;
      throw new LibraryRequestError(code==='TIMEOUT'?'连接资料库超时，同步已停止。':`无法连接资料库（${code}），同步已停止。`,{cause:error});
    }
  };
}
