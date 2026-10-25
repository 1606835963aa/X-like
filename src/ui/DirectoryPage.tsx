/* §2.1、§2.4：名称和用户名为主，统计信息为辅；名称和视频数量分别进入资料与视频。
 * §3.3.2、§3.6：目录使用三列紧凑卡片，窄屏两列；间距 8/12/16/24，字号 12/14/30。
 * 检索覆盖完整目录，匹配项连续展示；沿用普通 CSS 与浅深色语义令牌。 */
import { useEffect, useState } from 'react';
import { Loader2, Search, Tag, UsersRound, Video, X } from 'lucide-react';
import type { Stats } from '../shared/types';
import { matchingOptions, type DirectoryOption } from '../shared/directory';
import { xMediaUrl } from '../shared/media';

export function DirectoryPage({kind,stats,loading,error,onRetry,onAuthor,onTag}: {kind:'authors'|'tags';stats:Stats;loading:boolean;error:string;onRetry:()=>void;onAuthor:(id:string,videos?:boolean)=>void;onTag:(tag:string)=>void}) {
  const [query,setQuery]=useState('');
  useEffect(()=>{document.querySelector('.main')?.scrollTo({top:0});},[]);
  const authors=stats.authors??[],isAuthors=kind==='authors';
  const options:DirectoryOption[]=isAuthors?authors.map(author=>({value:author.id,label:author.name,detail:author.handle?'@'+author.handle:'',count:author.count})):stats.tags.map(tag=>({value:tag.name,label:'#'+tag.name,count:tag.count}));
  const matches=matchingOptions(options,query);
  const authorMap=new Map(authors.map(author=>[author.id,author]));
  const count=(value:number)=>value.toLocaleString();
  return <div className="content directory-page">
    <section className="page-heading"><div><h1>{isAuthors?'作者':'标签'}</h1><p>{isAuthors?`${count(authors.length)} 位作者`:`${count(stats.tags.length)} 个标签`} · {count(stats.total)} 条资料</p></div><span className="directory-heading-icon">{isAuthors?<UsersRound size={24}/>:<Tag size={24}/>}</span></section>
    <label className="search directory-search"><Search size={18}/><input aria-label={isAuthors?'搜索作者目录':'搜索标签目录'} placeholder={isAuthors?'搜索作者名或 @用户名…':'搜索标签…'} value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<button aria-label="清除目录搜索" onClick={()=>setQuery('')}><X size={15}/></button>}</label>
    <div className="directory-summary"><span>{query?`找到 ${count(matches.length)} ${isAuthors?'位作者':'个标签'}`:'按资料数量排序'}</span>{loading&&<Loader2 size={15} className="spin" aria-label="正在更新目录"/>}</div>
    {error&&<div className="inline-error"><span>{error}</span><button onClick={onRetry}>重试</button></div>}
    {matches.length?<ul className={`directory-grid ${isAuthors?'directory-authors':'directory-tags'}`} aria-label={isAuthors?'作者目录':'标签目录'}>{matches.map(option=>{
      const author=authorMap.get(option.value);
      return <li key={option.value} className="directory-entry">{isAuthors&&author?<article className="directory-card">
        <button className="directory-person" onClick={()=>onAuthor(author.id)} aria-label={`查看 ${author.name} 的资料`} title={author.name+(author.handle?' · @'+author.handle:'')}><span className="avatar" aria-hidden="true">{Array.from(author.name)[0]}{xMediaUrl(author.avatar)&&<img src={xMediaUrl(author.avatar)} loading="lazy" alt="" onError={event=>{event.currentTarget.style.display='none';}}/>}</span><span><strong>{author.name}</strong><small>{author.handle?'@'+author.handle:'用户名未收录'}</small></span></button>
        <div className="directory-card-footer"><span className="directory-counts"><span>{count(author.count)} 条资料</span><span className="directory-extra-counts">{count(author.bookmarks)} 收藏 · {count(author.likes)} 点赞</span></span>{author.videos?<button className="directory-video" onClick={()=>onAuthor(author.id,true)} aria-label={`查看 ${author.name} 的视频`}><Video size={14}/>{count(author.videos)} 视频</button>:<span className="directory-zero">无视频</span>}</div>
      </article>:<button className="directory-tag" onClick={()=>onTag(option.value)} title={option.label} aria-label={`查看 ${option.label} 的资料`}><span className="directory-tag-icon" aria-hidden="true"><Tag size={16}/></span><strong>{option.label}</strong><span className="directory-tag-count">{count(option.count)} 条</span></button>}</li>;
    })}</ul>:!loading&&<div className="no-results"><Search size={28}/><h2>{query?'没有找到匹配结果':isAuthors?'还没有作者':'还没有标签'}</h2>{query&&<button className="button" onClick={()=>setQuery('')}>清除搜索</button>}</div>}
  </div>;
}
