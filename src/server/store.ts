import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Account, Author, Post, PostInput, Query, Source } from '../shared/types';
import { extractHashtags, mergeTags, tagKey } from '../shared/hashtags';
import { authorId } from '../shared/directory';

const now = () => new Date().toISOString();
const clean = (v: unknown, max = 50000) => typeof v === 'string' ? v.slice(0, max) : '';
const norm = (v: string) => v.normalize('NFKC').toLocaleLowerCase();
export class Store {
  db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, text TEXT NOT NULL, author TEXT NOT NULL, author_name TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '', published_at TEXT, url TEXT NOT NULL, media TEXT NOT NULL DEFAULT '[]',
        quote TEXT, metrics TEXT NOT NULL DEFAULT '{}', first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', folder TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
        search_text TEXT NOT NULL DEFAULT '', hashtags TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, handle TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS sources (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, account_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('bookmark','like')), active INTEGER NOT NULL DEFAULT 1,
        seen_job TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
        PRIMARY KEY(post_id,account_id,kind)
      );
      CREATE INDEX IF NOT EXISTS sources_account_kind ON sources(account_id,kind,active);
      CREATE INDEX IF NOT EXISTS posts_published ON posts(published_at);
      CREATE INDEX IF NOT EXISTS posts_saved ON posts(first_seen_at);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, source TEXT NOT NULL, mode TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, ended_at TEXT,
        count INTEGER NOT NULL DEFAULT 0, cursor TEXT, message TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.db.function('tag_key', { deterministic: true }, value => tagKey(value));
    this.db.function('author_key', { deterministic: true }, (handle, name) => authorId(handle, name));
    if (Number(this.db.prepare('PRAGMA user_version').get()!.user_version) < 2) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (!this.db.prepare('PRAGMA table_info(posts)').all().some(column => column.name === 'hashtags')) this.db.exec("ALTER TABLE posts ADD COLUMN hashtags TEXT NOT NULL DEFAULT '[]'");
        for (const row of this.db.prepare('SELECT id,text,hashtags FROM posts').all() as {id:string;text:string;hashtags:string}[]) {
          this.db.prepare('UPDATE posts SET hashtags=? WHERE id=?').run(JSON.stringify(extractHashtags(row.text, JSON.parse(row.hashtags))), row.id);
          this.updateSearch(row.id);
        }
        this.db.exec('PRAGMA user_version=2; COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    this.db.prepare("UPDATE jobs SET state='interrupted',ended_at=?,message='服务已重新启动，已收录内容保留' WHERE state='running'").run(now());
  }
  close() { this.db.close(); }
  setting(key: string) { return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value as string | undefined; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  addDevice(name: string, token: string) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO devices VALUES (?,?,?,?,?)').run(id, clean(name, 80) || '新设备', createHash('sha256').update(token).digest('hex'), now(), now());
    return id;
  }
  authorize(token: string) {
    const hash = createHash('sha256').update(token).digest('hex');
    const d = this.db.prepare('SELECT id,name FROM devices WHERE token_hash=?').get(hash);
    if (d) this.db.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').run(now(), d.id!);
    return d;
  }
  upsertAccount(account: Account) {
    this.db.prepare('INSERT INTO accounts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET handle=excluded.handle,name=excluded.name,avatar=excluded.avatar')
      .run(clean(account.id, 100), clean(account.handle, 100), clean(account.name, 200), clean(account.avatar, 2000));
  }
  startJob(account: Account, source: Source, mode: string) {
    this.upsertAccount(account);
    const id = randomUUID();
    this.db.prepare('INSERT INTO jobs(id,account_id,source,mode,started_at) VALUES (?,?,?,?,?)').run(id, account.id, source, mode, now());
    return id;
  }
  ingest(inputs: PostInput[], accountId: string, source: Source, jobId = '') {
    let added = 0;
    const ids: string[] = [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const input of inputs) {
        if (!/^\d{1,25}$/.test(input.id)) throw new Error('推文编号格式不正确');
        if (!input.url?.match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//)) throw new Error('只支持 X 推文链接');
        const exists = this.db.prepare('SELECT * FROM posts WHERE id=?').get(input.id) as any;
        const text = clean(input.text);
        const author = clean(input.author, 100).replace(/^@/, '');
        const name = clean(input.authorName, 200) || author;
        const media = (Array.isArray(input.media) ? input.media : []).slice(0, 30).filter(m => ['photo','video','gif'].includes(m.type)).map(m => ({ type: m.type, url: clean(m.url, 4000), thumbnail: clean(m.thumbnail, 4000) }));
        const published = input.publishedAt && Number.isFinite(Date.parse(input.publishedAt)) ? new Date(input.publishedAt).toISOString() : null;
        const quote = input.quote ? JSON.stringify({ id: clean(input.quote.id, 25), text: clean(input.quote.text), author: clean(input.quote.author, 100), authorName: clean(input.quote.authorName, 200) }) : null;
        if (!exists) {
          this.db.prepare('INSERT INTO posts(id,text,author,author_name,avatar,published_at,url,media,quote,metrics,first_seen_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(input.id, text, author, name, clean(input.avatar, 4000), published, input.url, JSON.stringify(media), quote, JSON.stringify(input.metrics ?? {}), now(), now());
          added++;
        } else {
          this.db.prepare('UPDATE posts SET text=?,author=?,author_name=?,avatar=?,published_at=?,url=?,media=?,quote=?,metrics=?,updated_at=? WHERE id=?')
            .run(text || exists.text, author || exists.author, name || exists.author_name, clean(input.avatar, 4000) || exists.avatar, published || exists.published_at, input.url,
              media.length ? JSON.stringify(media) : exists.media, quote || exists.quote, JSON.stringify(input.metrics ?? JSON.parse(exists.metrics)), now(), input.id);
        }
        const hashtags = extractHashtags(text || exists?.text || '', input.hashtags ?? (text && text !== exists?.text ? [] : JSON.parse(exists?.hashtags ?? '[]')));
        this.db.prepare('UPDATE posts SET hashtags=? WHERE id=?').run(JSON.stringify(hashtags), input.id);
        this.db.prepare('INSERT INTO sources(post_id,account_id,kind,active,seen_job,updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(post_id,account_id,kind) DO UPDATE SET active=1,seen_job=excluded.seen_job,updated_at=excluded.updated_at')
          .run(input.id, accountId, source, jobId, now());
        this.updateSearch(input.id);
        ids.push(input.id);
      }
      if (jobId) this.db.prepare('UPDATE jobs SET count=(SELECT COUNT(*) FROM sources WHERE seen_job=?) WHERE id=? AND state=\'running\'').run(jobId, jobId);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return { added, saved: ids.length, ids };
  }
  private updateSearch(id: string) {
    const p = this.db.prepare('SELECT * FROM posts WHERE id=?').get(id) as any;
    this.db.prepare('UPDATE posts SET search_text=? WHERE id=?').run(norm([p.text, p.author, p.author_name, p.note, p.tags, p.hashtags, p.folder, p.quote].filter(Boolean).join(' ')), id);
  }
  finishJob(id: string, state: string, verifiedEnd: boolean, cursor?: string, message = '') {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as any;
    if (!job || job.state !== 'running') throw new Error('同步任务不存在或已结束');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (state === 'complete' && verifiedEnd && job.mode === 'full') {
        this.db.prepare('UPDATE sources SET active=0,updated_at=? WHERE account_id=? AND kind=? AND seen_job<>?').run(now(), job.account_id, job.source, id);
      }
      this.db.prepare('UPDATE jobs SET state=?,ended_at=?,cursor=?,message=? WHERE id=?').run(state, now(), cursor ?? null, clean(message, 1000), id);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  }
  getJob(id: string) { return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as any; }
  private row(row: any): Post {
    const edges = this.db.prepare('SELECT kind,account_id FROM sources WHERE post_id=? AND active=1').all(row.id) as any[];
    return { id: row.id, text: row.text, author: row.author, authorName: row.author_name, avatar: row.avatar,
      publishedAt: row.published_at, url: row.url, media: JSON.parse(row.media), quote: row.quote ? JSON.parse(row.quote) : undefined,
      metrics: JSON.parse(row.metrics), firstSeenAt: row.first_seen_at, updatedAt: row.updated_at, note: row.note,
      tags: JSON.parse(row.tags), hashtags: JSON.parse(row.hashtags), folder: row.folder, read: !!row.is_read, pinned: !!row.pinned, archived: !!row.archived,
      sources: [...new Set(edges.map(e => e.kind))] as Source[], accountIds: [...new Set(edges.map(e => e.account_id))] };
  }
  getPost(id: string) { const row = this.db.prepare('SELECT * FROM posts WHERE id=?').get(id); return row ? this.row(row) : null; }
  list(q: Query) {
    const where: string[] = ['p.archived=?'];
    const values: any[] = [q.archived === 'true' ? 1 : 0];
    const tagged = "EXISTS(SELECT 1 FROM json_each(p.tags) t WHERE tag_key(t.value)=? UNION ALL SELECT 1 FROM json_each(p.hashtags) h WHERE tag_key(h.value)=?)";
    for (const word of norm(clean(q.q, 500)).split(/\s+/).filter(Boolean)) {
      if (word.startsWith('#') && word.length > 1) { where.push(tagged); values.push(tagKey(word), tagKey(word)); }
      else { where.push('instr(p.search_text,?)>0'); values.push(word); }
    }
    if (q.source === 'both') where.push("EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.active=1 AND s.kind='bookmark') AND EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.active=1 AND s.kind='like')");
    else if (q.source === 'bookmark' || q.source === 'like') { where.push('EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.active=1 AND s.kind=?)'); values.push(q.source); }
    if (q.account) { where.push('EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.active=1 AND s.account_id=?)'); values.push(q.account); }
    if (q.media && q.media !== 'all') {
      if (q.media === 'text') where.push('json_array_length(p.media)=0');
      else if (q.media === 'video') where.push("EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,'$.type') IN ('video','gif'))");
      else if (['photo','gif'].includes(q.media)) { where.push('EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,\'$.type\')=?)'); values.push(q.media); }
    }
    if (q.tag) { where.push(tagged); values.push(tagKey(q.tag), tagKey(q.tag)); }
    if (q.folder) { where.push('p.folder=?'); values.push(q.folder); }
    if (q.author) { where.push("instr(lower(p.author || ' ' || p.author_name),?)>0"); values.push(q.author.toLowerCase()); }
    if (q.authorId) { where.push('author_key(p.author,p.author_name)=?'); values.push(clean(q.authorId, 1000)); }
    if (q.read === 'true' || q.read === 'false') { where.push('p.is_read=?'); values.push(q.read === 'true' ? 1 : 0); }
    if (q.pinned === 'true') where.push('p.pinned=1');
    const date = q.dateField === 'saved' ? 'p.first_seen_at' : 'p.published_at';
    if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) { where.push(`${date}>=?`); values.push(q.from + 'T00:00:00.000Z'); }
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) { where.push(`${date}<?`); values.push(new Date(Date.parse(q.to + 'T00:00:00Z') + 86400000).toISOString()); }
    const clause = where.join(' AND ');
    const total = Number(this.db.prepare(`SELECT COUNT(*) n FROM posts p WHERE ${clause}`).get(...values)!.n);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 48));
    const page = Math.max(1, Number(q.page) || 1);
    const order = ({ saved: 'p.first_seen_at DESC', newest: 'p.published_at DESC', oldest: 'p.published_at ASC', author: 'p.author ASC', likes: "json_extract(p.metrics,'$.likes') DESC" } as Record<string,string>)[q.sort ?? 'saved'] ?? 'p.first_seen_at DESC';
    const rows = this.db.prepare(`SELECT p.* FROM posts p WHERE ${clause} ORDER BY p.pinned DESC,${order},p.id DESC LIMIT ? OFFSET ?`).all(...values, limit, (page - 1) * limit);
    return { items: rows.map(r => this.row(r)), total, page, pages: Math.ceil(total / limit) };
  }
  edit(ids: string[], change: any) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of [...new Set(ids)].slice(0, 2000)) {
        if (!this.getPost(id)) continue;
        if (typeof change.note === 'string') this.db.prepare('UPDATE posts SET note=? WHERE id=?').run(clean(change.note, 30000), id);
        if (typeof change.folder === 'string') this.db.prepare('UPDATE posts SET folder=? WHERE id=?').run(clean(change.folder.trim(), 100), id);
        if (Array.isArray(change.tags)) this.db.prepare('UPDATE posts SET tags=? WHERE id=?').run(JSON.stringify([...new Set(change.tags.map((x: unknown) => clean(x, 80).trim()).filter(Boolean))].slice(0, 100)), id);
        for (const [key, col] of [['read','is_read'],['pinned','pinned'],['archived','archived']] as const) if (typeof change[key] === 'boolean') this.db.prepare(`UPDATE posts SET ${col}=? WHERE id=?`).run(change[key] ? 1 : 0, id);
        if (Array.isArray(change.addTags)) {
          const p = this.getPost(id)!;
          this.db.prepare('UPDATE posts SET tags=? WHERE id=?').run(JSON.stringify([...new Set([...p.tags, ...change.addTags.map((x: unknown) => clean(x, 80).trim()).filter(Boolean)])].slice(0, 100)), id);
        }
        this.updateSearch(id);
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return { updated: ids.length };
  }
  stats() {
    const count = (where: string) => Number(this.db.prepare(`SELECT COUNT(*) n FROM posts p WHERE ${where}`).get()!.n);
    const tagCounts = new Map<string, {name:string;count:number}>();
    for (const row of this.db.prepare('SELECT tags,hashtags FROM posts WHERE archived=0').all() as {tags:string;hashtags:string}[]) {
      for (const name of mergeTags(JSON.parse(row.tags), JSON.parse(row.hashtags))) {
        const key = tagKey(name), previous = tagCounts.get(key);
        if (previous) previous.count++; else tagCounts.set(key, {name,count:1});
      }
    }
    const tags = [...tagCounts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));
    const authorCounts = new Map<string,Author>();
    const rows = this.db.prepare(`SELECT p.author,p.author_name,p.avatar,p.media,
      EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.active=1 AND s.kind='bookmark') bookmarked,
      EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.active=1 AND s.kind='like') liked
      FROM posts p WHERE p.archived=0 ORDER BY p.updated_at DESC,p.id DESC`).all();
    for (const row of rows) {
      const id=authorId(row.author,row.author_name);
      let author=authorCounts.get(id);
      if(!author){author={id,handle:String(row.author),name:String(row.author_name||row.author||'未知作者'),avatar:String(row.avatar),count:0,videos:0,bookmarks:0,likes:0};authorCounts.set(id,author);}
      author.count++;author.bookmarks+=Number(row.bookmarked);author.likes+=Number(row.liked);
      if(JSON.parse(String(row.media)).some((media:any)=>media.type==='video'||media.type==='gif'))author.videos++;
    }
    const authors=[...authorCounts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));
    const folders = this.db.prepare("SELECT folder name,COUNT(*) count FROM posts WHERE archived=0 AND folder<>'' GROUP BY folder ORDER BY folder").all();
    return { total: count('p.archived=0'), bookmarks: count("p.archived=0 AND EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.kind='bookmark' AND s.active=1)"),
      likes: count("p.archived=0 AND EXISTS(SELECT 1 FROM sources s WHERE s.post_id=p.id AND s.kind='like' AND s.active=1)"), unread: count('p.archived=0 AND p.is_read=0'), pinned: count('p.archived=0 AND p.pinned=1'), archived: count('p.archived=1'),
      photos: count("p.archived=0 AND EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,'$.type')='photo')"),
      videos: count("p.archived=0 AND EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,'$.type') IN ('video','gif'))"),
      tags, authors, folders, accounts: this.db.prepare('SELECT * FROM accounts').all(), lastSync: this.db.prepare('SELECT * FROM jobs ORDER BY started_at DESC LIMIT 1').get() ?? null };
  }
  exportAll() {
    return { format: 'shizang', version: 1, exportedAt: now(), posts: this.db.prepare('SELECT * FROM posts ORDER BY first_seen_at DESC').all().map(r => this.row(r)),
      accounts: this.db.prepare('SELECT * FROM accounts').all(), sourceEdges: this.db.prepare('SELECT * FROM sources').all() };
  }
  importBackup(backup: any) {
    if (backup.format !== 'shizang' || backup.version !== 1 || !Array.isArray(backup.posts)) throw new Error('不支持这个备份格式');
    const account = { id: 'import', handle: '', name: '文件导入' };
    this.upsertAccount(account);
    let added = 0;
    for (const post of backup.posts) {
      const existing = this.getPost(post.id);
      const source = post.sources?.includes('bookmark') ? 'bookmark' : 'like';
      added += this.ingest([post], 'import', source).added;
      if(post.sources?.includes('bookmark')&&post.sources?.includes('like'))this.ingest([post],'import','like');
      if(Array.isArray(post.sources)&&post.sources.length===0)this.db.prepare('DELETE FROM sources WHERE post_id=? AND account_id=\'import\'').run(post.id);
      if (!existing) {
        this.edit([post.id], { note: post.note, tags: post.tags, folder: post.folder, read: post.read, pinned: post.pinned, archived: post.archived });
        if (Number.isFinite(Date.parse(post.firstSeenAt))) this.db.prepare('UPDATE posts SET first_seen_at=? WHERE id=?').run(post.firstSeenAt, post.id);
      }
    }
    for (const a of backup.accounts ?? []) if (a?.id) this.upsertAccount(a);
    const sourceEdges=(backup.sourceEdges??[]).filter((edge:any)=>this.getPost(edge.post_id)&&['bookmark','like'].includes(edge.kind));
    for(const id of new Set(sourceEdges.map((edge:any)=>edge.post_id)))this.db.prepare('DELETE FROM sources WHERE post_id=? AND account_id=\'import\'').run(id as string);
    for (const edge of sourceEdges) {
      this.db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,?) ON CONFLICT(post_id,account_id,kind) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at')
        .run(edge.post_id, clean(edge.account_id,100), edge.kind, edge.active ? 1 : 0, '', now());
    }
    return { added, saved: backup.posts.length };
  }
}
