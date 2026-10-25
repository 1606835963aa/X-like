import { parseTimeline } from '../shared/x-parser';
import type { PostInput } from '../shared/types';

export async function syncTimeline(options: {
  first: unknown;
  known: (ids: string[]) => Promise<string[]>;
  save: (posts: PostInput[], cursor: string | null) => Promise<void>;
  next: (cursor: string) => Promise<unknown>;
  pause: () => Promise<void>;
  stopped: () => boolean;
  check: () => void;
  progress: (added: number) => void;
}) {
  let json = options.first, cursor: string | null = null, emptyPages = 0, verifiedEnd = false;
  const added = new Set<string>(), cursors = new Set<string>();
  while (!options.stopped()) {
    options.check();
    const parsed = parseTimeline(json);
    if (!parsed.recognized) throw new Error('X 返回的数据格式已变化，同步已停止，已收录资料保留。');
    cursor = parsed.cursor;
    const known = new Set(parsed.posts.length ? await options.known(parsed.posts.map(p => p.id)) : []);
    const fresh = parsed.posts.filter(p => !known.has(p.id) && !added.has(p.id));
    options.check();
    if (options.stopped()) break;
    if (fresh.length) {
      await options.save(fresh, cursor);
      fresh.forEach(p => added.add(p.id));
      options.progress(fresh.length);
    }
    if (parsed.terminal || !cursor) { verifiedEnd = true; break; }
    if (parsed.posts.length && parsed.posts.every(p => known.has(p.id))) break;
    emptyPages = parsed.posts.length ? 0 : emptyPages + 1;
    if (emptyPages >= 2 || cursors.has(cursor)) break;
    cursors.add(cursor);
    await options.pause();
    options.check();
    if (options.stopped()) break;
    json = await options.next(cursor);
  }
  return { ids: [...added], cursor, verifiedEnd };
}
