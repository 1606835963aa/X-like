export function xMediaUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? '');
    if (url.protocol === 'https:' && url.hostname.endsWith('.twimg.com') && !url.username && !url.password) return url.href;
  } catch {}
  return '';
}

export function playbackSources(media: {url:string;cachedOriginal?:boolean}, savedUrl = '') {
  const remote = xMediaUrl(media.url);
  const video = remote && new URL(remote).hostname === 'video.twimg.com' ? remote : '';
  return [...new Set([media.cachedOriginal ? savedUrl : '', video].filter(Boolean))];
}
