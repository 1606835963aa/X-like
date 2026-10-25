/* React 单页界面使用普通 CSS、现有浅深色令牌与原生控件。
 * §2.1、§2.8：正文为主，标签是辅助筛选入口，不增加主操作。
 * §3.6：标签内间距 8、分组间距 16；字号 12，颜色使用 muted、selection、accent-text。 */
import { mergeTags, tagKey } from '../shared/hashtags';

export function TagChips({tags,onSelect,limit}: {tags:string[];onSelect?:(tag:string)=>void;limit?:number}) {
  const all = mergeTags(tags), visible = typeof limit === 'number' ? all.slice(0,limit) : all;
  if (!all.length) return null;
  return <div className="tag-chips">{visible.map(tag=>onSelect
    ? <button type="button" className="post-tag" key={tagKey(tag)} title={`筛选 #${tag}`} aria-label={`筛选标签 #${tag}`} onClick={event=>{event.stopPropagation();onSelect(tag);}}>#{tag}</button>
    : <span className="post-tag" key={tagKey(tag)}>#{tag}</span>
  )}{visible.length<all.length&&<span className="tag-more" aria-label={`另外 ${all.length-visible.length} 个标签`}>+{all.length-visible.length}</span>}</div>;
}
