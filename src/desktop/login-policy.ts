export type LoginNavigation = 'allow' | 'google' | 'deny';

const appleHosts = new Set(['appleid.apple.com', 'account.apple.com', 'idmsa.apple.com']);

export function loginNavigation(raw: string): LoginNavigation {
  if (raw === 'about:blank') return 'allow';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return 'deny';
    const host = url.hostname;
    if (host === 'accounts.google.com') return 'google';
    if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com') || appleHosts.has(host)) return 'allow';
  } catch {}
  return 'deny';
}
