import { Capacitor, CapacitorHttp, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Connection } from '../shared/types';
import { xMediaUrl } from '../shared/media';
let current:Connection|null=null;
export function setNativeTheme(theme:string){if(Capacitor.getPlatform()==='android')void SystemBars.setStyle({style:theme==='dark'?SystemBarsStyle.Dark:SystemBarsStyle.Light}).catch(()=>{});}
export function savePreference(key:string,value:string){localStorage.setItem(key,value);void window.shizang?.savePreference?.(key,value).catch(()=>{});}
export function setConnection(c:Connection|null){current=c;}
export function getConnection(){return current;}
export async function loadConnection():Promise<Connection|null>{
  if(window.shizang)return window.shizang.connection();
  const result=await Preferences.get({key:'connection'});try{return result.value?JSON.parse(result.value):null;}catch{return null;}
}
export async function saveConnection(c:Connection|null){
  const saved=window.shizang?await window.shizang.saveConnection(c):c;
  if(!window.shizang){if(saved)await Preferences.set({key:'connection',value:JSON.stringify(saved)});else await Preferences.remove({key:'connection'});}
  current=saved;return saved;
}
export async function requestAt(connection:Connection|null,path:string,options:{method?:string;body?:any;text?:boolean}={}){
  if(!connection)throw new Error('请先连接资料库');
  const headers:Record<string,string>={'Content-Type':'application/json'};if(connection.token)headers.Authorization='Bearer '+connection.token;
  if(Capacitor.isNativePlatform()){
    const r=await CapacitorHttp.request({url:connection.url+path,method:options.method??(options.body?'POST':'GET'),headers,data:options.body,responseType:options.text?'text':'json',connectTimeout:15000,readTimeout:45000});
    if(r.status>=400)throw new Error(typeof r.data==='object'?r.data.error:'资料库暂时无法连接');return r.data;
  }
  const r=await fetch(connection.url+path,{method:options.method??(options.body?'POST':'GET'),headers,body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(45000)});
  if(!r.ok){const error=await r.json().catch(()=>({}));throw new Error(error.error??'资料库暂时无法连接');}
  return options.text?r.text():r.json();
}
export function api(path:string,options?:{method?:string;body?:any;text?:boolean}){return requestAt(current,path,options);}
export function mediaUrl(path:string|undefined){return path?.startsWith('/api/media/')?(current?current.url+path:''):xMediaUrl(path);}
export async function openExternal(url:string){if(window.shizang)return window.shizang.openExternal(url);window.open(url,'_blank','noopener,noreferrer');}
export async function downloadFile(name:string,data:string){
  if(window.shizang)return window.shizang.saveFile({name,data});
  if(Capacitor.isNativePlatform()){
    const file=await Filesystem.writeFile({path:'exports/'+name,data,encoding:Encoding.UTF8,directory:Directory.Cache,recursive:true});
    await Share.share({title:'拾藏资料导出',url:file.uri});return true;
  }
  const blob=new Blob([data],{type:name.endsWith('.csv')?'text/csv;charset=utf-8':'application/json'});
  const file=new File([blob],name,{type:blob.type});
  if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return true;}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);return true;
}
