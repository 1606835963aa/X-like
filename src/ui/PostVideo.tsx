import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { mediaUrl } from './api';

type PlaybackMedia = { url:string; thumbnailPath?:string; filePath?:string; cachedOriginal?:boolean };

function sourcesFor(media:PlaybackMedia){
  let remote='';
  try{const url=new URL(media.url);if(url.protocol==='https:'&&url.hostname==='video.twimg.com'&&!url.username&&!url.password)remote=url.href;}catch{}
  const saved=mediaUrl(media.filePath);
  return [...new Set((media.cachedOriginal?[saved,remote]:[remote,saved]).filter(Boolean))];
}

export function PostVideo({media,index}:{media:PlaybackMedia;index:number}){
  const [sources,setSources]=useState(()=>sourcesFor(media));
  const [attempt,setAttempt]=useState(0);const [reload,setReload]=useState(0);const [failed,setFailed]=useState(false);
  const resume=useRef(false);
  function retry(){setSources(sourcesFor(media));setAttempt(0);setFailed(false);setReload(value=>value+1);}
  return <div className="post-video"><video key={`${attempt}:${reload}`} aria-label={`视频 ${index+1}`} controls playsInline preload="metadata" poster={mediaUrl(media.thumbnailPath)} src={sources[attempt]||undefined}
    onPlay={()=>{resume.current=true;}} onPause={()=>{resume.current=false;}}
    onLoadedMetadata={event=>{if(resume.current)void event.currentTarget.play().catch(()=>{});}}
    onError={()=>{if(attempt+1<sources.length)setAttempt(value=>value+1);else setFailed(true);}}/>
    {(failed||!sources.length)&&<div className="video-error" role="status"><span>视频加载失败</span><button className="button" onClick={retry}><RefreshCw size={16}/>重新加载</button></div>}
  </div>;
}
