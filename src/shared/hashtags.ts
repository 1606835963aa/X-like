export function tagName(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/^#+/, '').trim() : '';
}

export function tagKey(value: unknown) { return tagName(value).toLowerCase(); }

export function mergeTags(...groups: unknown[]): string[] {
  const tags = new Map<string, string>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const value of group) { const name = tagName(value); if (name && !tags.has(tagKey(name))) tags.set(tagKey(name), name); }
  }
  return [...tags.values()];
}

export function extractHashtags(text: string, entities: unknown = []): string[] {
  const names: string[] = [];
  const add = (value: unknown) => {
    const name = tagName(value);
    if (name.length <= 200 && /^[\p{L}\p{M}\p{N}_\u200c\u200d]+$/u.test(name) && /[\p{L}_]/u.test(name)) names.push(name);
  };
  for (const entity of Array.isArray(entities) ? entities : []) add(typeof entity === 'string' ? entity : entity?.text ?? entity?.tag);
  const body = text.normalize('NFKC').replace(/(?:https?:\/\/|www\.)\S+/gi, ' ');
  for (const match of body.matchAll(/(^|[^\p{L}\p{M}\p{N}_&#])#([\p{L}\p{M}\p{N}_\u200c\u200d]+)/gu)) add(match[2]);
  return mergeTags(names).slice(0, 100);
}
