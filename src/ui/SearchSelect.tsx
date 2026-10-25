/* React 与普通 CSS；沿用浅深色令牌。§2.1、§2.8：输入为主，建议为辅，清除为次要操作。
 * §3.6：分组间距 8，选项内间距 4；字号 12/14，使用既有边框、圆角和阴影。 */
import { useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { lookupKey, matchingOptions, type DirectoryOption } from '../shared/directory';

export function SearchSelect({label,placeholder,options,value,onChange}: {label:string;placeholder:string;options:DirectoryOption[];value:string;onChange:(value:string)=>void}) {
  const id=useId(),input=useRef<HTMLInputElement>(null);
  const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[editing,setEditing]=useState(false),[active,setActive]=useState(0);
  const selected=options.find(option=>option.value===value);
  const matches=matchingOptions(options,query,8),expanded=open&&!!lookupKey(query);
  function choose(option:DirectoryOption){onChange(option.value);setOpen(false);setEditing(false);setQuery('');setActive(0);}
  return <div className="search-select" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setOpen(false);setEditing(false);setQuery('');}}}>
    <div className="search-select-field"><Search size={15}/><input ref={input} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded?id:undefined} aria-activedescendant={expanded&&matches[active]?`${id}-${active}`:undefined} autoComplete="off" placeholder={placeholder}
      value={editing?query:selected?.label??value} onFocus={()=>{setEditing(true);setOpen(true);setQuery('');setActive(0);}} onChange={event=>{setQuery(event.target.value);setEditing(true);setOpen(true);setActive(0);}}
      onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'){event.stopPropagation();setOpen(false);setEditing(false);setQuery('');}else if(expanded&&matches.length&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();setActive(index=>(index+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length);}else if(expanded&&matches[active]&&event.key==='Enter'){event.preventDefault();choose(matches[active]);}}}/>
      {(value||query)&&<button type="button" className="search-select-clear" aria-label={`清除${label}`} onClick={()=>{onChange('');setQuery('');setEditing(true);input.current?.focus();}}><X size={14}/></button>}
    </div>
    {expanded&&<div id={id} className="search-select-options" role="listbox" aria-label={`${label}建议`}>{matches.length?matches.map((option,index)=><button type="button" id={`${id}-${index}`} key={option.value} role="option" aria-selected={active===index} tabIndex={-1} className={active===index?'active':''} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(option)}><span><strong>{option.label}</strong>{option.detail&&<small>{option.detail}</small>}</span><span className="suggestion-count">{option.count.toLocaleString()} 条</span></button>):<p role="status">没有匹配结果</p>}</div>}
  </div>;
}
