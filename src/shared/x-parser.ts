import type { Media, PostInput } from './types';
import { extractHashtags } from './hashtags';

export function tweetToPost(raw: any): PostInput | null {
  const t = raw?.tweet ?? raw;
  const l = t?.legacy;
  const id = String(t?.rest_id ?? l?.id_str ?? '');
  if (!/^\d{1,25}$/.test(id) || !l) return null;
  const user = t.core?.user_results?.result ?? {};
  const u = user.legacy ?? user.core ?? {};
  const author = user.core?.screen_name ?? u.screen_name ?? '';
  const text = t.note_tweet?.note_tweet_results?.result?.text ?? l.full_text ?? l.text ?? '';
  const media: Media[] = (l.extended_entities?.media ?? l.entities?.media ?? []).map((m: any) => {
    const variants = (m.video_info?.variants ?? []).filter((v: any) => v.content_type === 'video/mp4' && v.url).sort((a: any,b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    return { type: m.type === 'animated_gif' ? 'gif' : m.type === 'video' ? 'video' : 'photo',
      url: variants[0]?.url ?? (m.media_url_https ? m.media_url_https.replace(/\?.*$/, '') + '?name=orig' : ''), thumbnail: m.media_url_https ?? '' };
  });
  const quoteRaw = t.quoted_status_result?.result;
  const q = quoteRaw && !quoteRaw.tweet?.quoted_status_result ? tweetToPostWithoutQuote(quoteRaw) : null;
  return { id, text: unescapeText(text), hashtags: extractHashtags(unescapeText(text), [...(l.entities?.hashtags ?? []), ...(t.note_tweet?.note_tweet_results?.result?.entity_set?.hashtags ?? [])]), author, authorName: user.core?.name ?? u.name ?? author,
    avatar: user.avatar?.image_url ?? u.profile_image_url_https ?? '',
    publishedAt: Number.isFinite(Date.parse(l.created_at)) ? new Date(l.created_at).toISOString() : null,
    url: `https://x.com/${author || 'i'}/status/${id}`, media,
    quote: q ? { id: q.id, text: q.text, author: q.author, authorName: q.authorName } : undefined,
    metrics: { likes: l.favorite_count ?? 0, reposts: l.retweet_count ?? 0, replies: l.reply_count ?? 0 } };
}
function tweetToPostWithoutQuote(raw: any) { const t = raw?.tweet ?? raw; return tweetToPost({ ...t, quoted_status_result: undefined }); }
function unescapeText(s: string) { return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }

export function parseTimeline(json: any) {
  let instructions: any[] | null = null;
  const queue = [json?.data];
  while (queue.length) {
    const obj = queue.shift();
    if (!obj || typeof obj !== 'object') continue;
    if (Array.isArray(obj.instructions)) { instructions = obj.instructions; break; }
    queue.push(...Object.values(obj));
  }
  if (!instructions) return { recognized: false, posts: [] as PostInput[], cursor: null as string | null, terminal: false };
  const result = new Map<string, PostInput>();
  let cursor: string | null = null;
  let terminal = false;
  const inspect = (item: any) => {
    const raw = item?.tweet_results?.result;
    if (raw && !item.promotedMetadata) { const p = tweetToPost(raw); if (p) result.set(p.id, p); }
  };
  for (const instruction of instructions) {
    if (instruction.type === 'TimelineTerminateTimeline' && instruction.direction === 'Bottom') terminal = true;
    const entries = instruction.entries ?? (instruction.entry ? [instruction.entry] : []);
    for (const entry of entries) {
      const c = entry.content ?? {};
      inspect(c.itemContent);
      for (const module of c.items ?? []) inspect(module.item?.itemContent);
      if (c.cursorType === 'Bottom' || entry.entryId?.startsWith('cursor-bottom')) cursor = c.value ?? null;
    }
  }
  return { recognized: true, posts: [...result.values()], cursor, terminal };
}

function parseCsv(text: string): Record<string,string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i=0; i<text.length; i++) {
    const c=text[i];
    if (c==='"') { if (quoted && text[i+1]==='"') { cell+='"'; i++; } else quoted=!quoted; }
    else if (c===',' && !quoted) { row.push(cell); cell=''; }
    else if (c==='\n' && !quoted) { row.push(cell.replace(/\r$/,'')); if(row.some(Boolean))rows.push(row); row=[]; cell=''; }
    else cell+=c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/,'')); rows.push(row); }
  const headers=rows.shift()??[]; return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h.replace(/^\uFEFF/,''),r[i]??''])));
}
export function parseImport(content: string, filename = ''): PostInput[] | { backup: any } {
  const text = content.trim().replace(/^\uFEFF/,'');
  let data: any;
  if (filename.toLowerCase().endsWith('.csv')) data=parseCsv(text);
  else { const cleaned=text.replace(/^window\.YTD\.[\w.]+\s*=\s*/, '').replace(/;\s*$/,''); data=JSON.parse(cleaned); }
  if (data?.format==='shizang') return { backup: data };
  const rows=Array.isArray(data)?data:data?.bookmarks??data?.tweets??data?.likes??data?.data??[];
  if(!Array.isArray(rows))throw new Error('没有找到可导入的推文列表');
  if(rows.length&&Object.hasOwn(rows[0],'推文编号')){
    const decoded=rows.map((row:any)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'&&/^'[=+\-@\t\r']/.test(value)?value.slice(1):value])));
    const posts=decoded.filter((r:any)=>/^\d{1,25}$/.test(r['推文编号'])).map((r:any)=>({
      id:r['推文编号'],author:r['用户名']??'',authorName:r['作者']??'',text:r['正文']??'',
      publishedAt:Number.isFinite(Date.parse(r['发布时间']))?new Date(r['发布时间']).toISOString():null,
      firstSeenAt:r['首次收录时间'],url:r['原文链接']??`https://x.com/i/status/${r['推文编号']}`,media:[],
      sources:[...(r['收藏']==='是'?['bookmark']:[]),...(r['点赞']==='是'?['like']:[])],
      tags:(r['标签']??'').split('、').filter(Boolean),hashtags:extractHashtags(r['正文']??'',(r['帖子标签']??'').split('、')),folder:r['文件夹']??'',note:r['备注']??'',read:r['已读']==='是',pinned:false,archived:false
    }));
    if(!posts.length)throw new Error('CSV 中没有可识别的推文编号');
    return {backup:{format:'shizang',version:1,posts,sourceEdges:posts.flatMap((p:any)=>p.sources.map((kind:string)=>({post_id:p.id,account_id:'import',kind,active:1})))}};
  }
  const posts=new Map<string,PostInput>();
  for(const row of rows){
    const raw=row.tweet??row.like??row;
    const graphql=tweetToPost(raw);
    if(graphql){posts.set(graphql.id,graphql);continue;}
    const url=raw.url??raw.tweet_url??raw.expandedUrl??raw.expanded_url??'';
    const id=String(raw.id??raw.tweetId??raw.tweet_id??raw.id_str??String(url).match(/\/status\/(\d+)/)?.[1]??'');
    if(!/^\d{1,25}$/.test(id))continue;
    const author=(raw.author?.screen_name??raw.author?.username??raw.screen_name??raw.username??(typeof raw.author==='string'?raw.author:''))||String(url).match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\//)?.[1]||'';
    let media: Media[]=[];
    if(Array.isArray(raw.media))media=raw.media.filter((m:any)=>m && typeof m==='object' && m.url).map((m:any)=>({type:m.type==='video'?'video':m.type==='gif'?'gif':'photo',url:m.url,thumbnail:m.thumbnail??m.url}));
    const date=raw.publishedAt??raw.postedAt??raw.created_at??raw.createdAt;
    const postText=String(raw.text??raw.fullText??raw.full_text??'');
    posts.set(id,{id,text:postText,hashtags:extractHashtags(postText,raw.hashtags??raw.entities?.hashtags),author,authorName:raw.authorName??raw.name??author,
      avatar:raw.avatar??'',publishedAt:Number.isFinite(Date.parse(date))?new Date(date).toISOString():null,url:`https://x.com/${author||'i'}/status/${id}`,media});
  }
  if(!posts.size)throw new Error('文件里没有可识别的推文。支持拾藏备份、X 数据存档和推文 JSON / CSV。');
  return [...posts.values()];
}
