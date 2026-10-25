/* React 单页目录，沿用普通 CSS 和浅深色令牌。§2.1：名称为主，数量为辅，用户名为辅助信息。
 * §2.8：检索是主要操作，名称和视频数量是查看入口。§3.6：间距 8/16/24，字号 12/14/30。 */
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Tag, UsersRound, X } from 'lucide-react';
import type { Stats } from '../shared/types';
import { matchingOptions, type DirectoryOption } from '../shared/directory';
import { xMediaUrl } from '../shared/media';

export function DirectoryPage({kind,stats,loading,error,onRetry,onAuthor,onTag}: {kind:'authors'|'tags';stats:Stats;loading:boolean;error:string;onRetry:()=>void;onAuthor:(id:string,videos?:boolean)=>void;onTag:(tag:string)=>void}) {
  const [query,setQuery]=useState(''),[page,setPage]=useState(1);
  const authors=stats.authors??[],isAuthors=kind==='authors';
  const options:DirectoryOption[]=isAuthors?authors.map(author=>({value:author.id,label:author.name,detail:author.handle?'@'+author.handle:'',count:author.count})):stats.tags.map(tag=>({value:tag.name,label:'#'+tag.name,count:tag.count}));
  const matches=matchingOptions(options,query),pages=Math.max(1,Math.ceil(matches.length/25)),current=Math.min(page,pages),rows=matches.slice((current-1)*25,current*25);
  const authorMap=new Map(authors.map(author=>[author.id,author]));
  const count=(value:number)=>value.toLocaleString();
  return <div className="content directory-page">
    <section className="page-heading"><div><h1>{isAuthors?'作者':'标签'}</h1><p>{isAuthors?`${count(authors.length)} 位作者`:`${count(stats.tags.length)} 个标签`} · {count(stats.total)} 条资料</p></div><span className="directory-heading-icon">{isAuthors?<UsersRound size={24}/>:<Tag size={24}/>}</span></section>
    <label className="search directory-search"><Search size={18}/><input aria-label={isAuthors?'搜索作者目录':'搜索标签目录'} placeholder={isAuthors?'搜索作者名或 @用户名…':'搜索标签…'} value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/>{query&&<button aria-label="清除目录搜索" onClick={()=>{setQuery('');setPage(1);}}><X size={15}/></button>}</label>
    <div className="directory-summary"><span>{query?`找到 ${count(matches.length)} ${isAuthors?'位作者':'个标签'}`:'按资料数量排序'}</span>{loading&&<Loader2 size={15} className="spin" aria-label="正在更新目录"/>}</div>
    {error&&<div className="inline-error"><span>{error}</span><button onClick={onRetry}>重试</button></div>}
    {rows.length?<div className="directory-table-wrap"><table className="directory-table"><thead><tr><th scope="col">{isAuthors?'作者':'标签'}</th><th scope="col">资料</th>{isAuthors&&<><th scope="col">视频</th><th scope="col" className="desktop-column">收藏</th><th scope="col" className="desktop-column">点赞</th></>}</tr></thead><tbody>{rows.map(option=>{
      const author=authorMap.get(option.value);
      return <tr key={option.value}><td>{isAuthors&&author?<button className="directory-person" onClick={()=>onAuthor(author.id)} aria-label={`查看 ${author.name} 的资料`}><span className="avatar">{Array.from(author.name)[0]}{xMediaUrl(author.avatar)&&<img src={xMediaUrl(author.avatar)} loading="lazy" alt="" onError={event=>{event.currentTarget.style.display='none';}}/>}</span><span><strong>{author.name}</strong><small>{author.handle?'@'+author.handle:'用户名未收录'}</small></span></button>:<button className="directory-tag" onClick={()=>onTag(option.value)}><Tag size={17}/><strong>{option.label}</strong></button>}</td><td>{count(option.count)}</td>{isAuthors&&author&&<><td>{author.videos?<button className="directory-number" onClick={()=>onAuthor(author.id,true)} aria-label={`查看 ${author.name} 的视频`}>{count(author.videos)}</button>:<span className="directory-zero">0</span>}</td><td className="desktop-column">{count(author.bookmarks)}</td><td className="desktop-column">{count(author.likes)}</td></>}</tr>;
    })}</tbody></table></div>:!loading&&<div className="no-results"><Search size={28}/><h2>{query?'没有找到匹配结果':isAuthors?'还没有作者':'还没有标签'}</h2>{query&&<button className="button" onClick={()=>{setQuery('');setPage(1);}}>清除搜索</button>}</div>}
    {pages>1&&<div className="pagination"><button className="button" disabled={current<=1} onClick={()=>{setPage(current-1);document.querySelector('.main')?.scrollTo({top:0});}}><ChevronLeft size={16}/>上一页</button><span>{current} / {pages}</span><button className="button" disabled={current>=pages} onClick={()=>{setPage(current+1);document.querySelector('.main')?.scrollTo({top:0});}}>下一页<ChevronRight size={16}/></button></div>}
  </div>;
}
