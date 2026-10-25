export const lookupKey = (value: string) => value.normalize('NFKC').trim().replace(/^[@#]+/, '').toLowerCase();

export function authorId(handle: unknown, name: unknown) {
  const user = typeof handle === 'string' ? lookupKey(handle) : '';
  const display = typeof name === 'string' ? lookupKey(name) : '';
  return user ? 'user:' + user : 'name:' + (display || 'unknown');
}

export type DirectoryOption = { value: string; label: string; detail?: string; count: number };

export function matchingOptions(options: DirectoryOption[], query: string, limit = options.length) {
  const key = lookupKey(query);
  if (!key) return options.slice(0, limit);
  return options.map((option, index) => {
    const names = [option.label, option.detail ?? ''].map(lookupKey);
    const score = names.some(name => name.startsWith(key)) ? 0 : names.some(name => name.includes(key)) ? 1 : 2;
    return {option, index, score};
  }).filter(item => item.score < 2).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit).map(item => item.option);
}
