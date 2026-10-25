import type { Connection } from '../shared/types';
import { createLibraryRequest, type FetchRequest } from './library-client';

export async function saveVideos(connection:Connection,options:{ids:string[];fetcher?:FetchRequest;stopped:()=>boolean;progress:(saved:number,total:number,failed:number)=>void}){
  const request=options.fetcher??((url,init)=>fetch(url,init));
  const authorization='Bearer '+connection.token;
  const json=await createLibraryRequest(connection,{fetcher:request})('/api/media-cache/plan',{ids:options.ids,originals:true});
  const assets=json.assets as {id:string;index:string;kind:string;url:string}[];let next=0,saved=0,failed=0;
  async function worker(){
    while(next<assets.length&&!options.stopped()){
      const asset=assets[next++];
      try{
        const remote=new URL(asset.url);if(remote.protocol!=='https:'||!remote.hostname.endsWith('.twimg.com'))throw new Error('媒体地址不受支持');
        const response=await request(remote.href,{credentials:'omit',signal:AbortSignal.timeout(180000)});
        if(!response.ok||!response.body)throw new Error('媒体暂时不可用');
        const type=(response.headers.get('content-type')??'').split(';')[0];
        if(!/^video\/(mp4|webm)$/.test(type)||Number(response.headers.get('content-length'))>250*1024*1024){await response.body.cancel();throw new Error('视频格式或大小不受支持');}
        if(options.stopped()){await response.body.cancel();break;}
        const upload=await request(`${connection.url}/api/media-cache/${asset.id}/${asset.index}/${asset.kind}`,{method:'POST',credentials:'omit',headers:{Authorization:authorization,'Content-Type':type},body:response.body,duplex:'half',signal:AbortSignal.timeout(300000)} as any);
        if(!upload.ok)throw new Error('媒体保存失败');await upload.body?.cancel();saved++;
      }catch{failed++;}
      options.progress(saved,assets.length,failed);
    }
  }
  await Promise.all(Array.from({length:4},worker));return {saved,failed,total:assets.length};
}
