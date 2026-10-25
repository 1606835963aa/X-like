export class XSyncBlocked extends Error {
  constructor(message: string, public reason: 'rate-limit' | 'login' | 'verification', public retryAt?: number) {
    super(message);
    this.name = 'XSyncBlocked';
  }
}

export function retryAt(value?: string | null, now = Date.now(), reset?: string | null) {
  const candidates: number[] = [];
  const seconds = value?.trim() ? Number(value) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) candidates.push(now + seconds * 1000);
  else { const date = value ? Date.parse(value) : NaN; if (Number.isFinite(date) && date > now) candidates.push(date); }
  const resetTime = reset?.trim() ? Number(reset) * 1000 : NaN;
  if (Number.isFinite(resetTime) && resetTime > now) candidates.push(resetTime);
  return candidates.length ? Math.max(...candidates) : now + 15 * 60 * 1000;
}

export function checkXStatus(status: number, retryAfter?: string | null, reset?: string | null) {
  if (status === 429) throw new XSyncBlocked('X 请求频率受限，同步已停止。请稍后手动同步。', 'rate-limit', retryAt(retryAfter, Date.now(), reset));
  if (status === 401) throw new XSyncBlocked('X 登录已失效，同步已停止。请打开 X 窗口完成登录后手动同步。', 'login');
  if (status === 403) throw new XSyncBlocked('X 拒绝了读取请求，同步已停止。请打开 X 窗口检查登录或验证提示。', 'verification');
  if (status !== 200) throw new Error(`X 暂时无法读取资料（${status}），同步已停止。`);
}

export function readXResponse(status: number, text: string, retryAfter?: string | null, reset?: string | null) {
  checkXStatus(status, retryAfter, reset);
  let json: any;
  try { json = JSON.parse(text); }
  catch { throw new Error('X 未返回资料列表，同步已停止。请打开 X 窗口检查登录或验证提示。'); }
  for (const error of Array.isArray(json?.errors) ? json.errors : []) {
    const code = Number(error.code), message = String(error.message ?? '');
    if (code === 88 || /rate.?limit|too many requests/i.test(message)) {
      throw new XSyncBlocked('X 请求频率受限，同步已停止。请稍后手动同步。', 'rate-limit', retryAt(retryAfter, Date.now(), reset));
    }
    if ([32, 89].includes(code) || /authenticate|expired token|invalid token|log.?in required/i.test(message)) {
      throw new XSyncBlocked('X 登录已失效，同步已停止。请打开 X 窗口完成登录后手动同步。', 'login');
    }
    if ([64, 326].includes(code) || /captcha|challenge|temporarily locked|account.{0,30}suspended|verify your|验证|验证码/i.test(message)) {
      throw new XSyncBlocked('X 要求账号验证或限制了账号，同步已停止。请打开 X 窗口处理。', 'verification');
    }
  }
  if (json?.errors?.length && !json.data) throw new Error('X 返回了错误，同步已停止。请稍后手动同步。');
  return json;
}

export function blockedXPage(url: string) {
  let path: string;
  try { const target = new URL(url); if (!['x.com', 'twitter.com'].includes(target.hostname)) return null; path = target.pathname; }
  catch { return null; }
  if (/^\/(?:i\/flow\/login|login|logout)(?:\/|$)/.test(path)) {
    return new XSyncBlocked('X 登录已失效，同步已停止。请完成登录后手动同步。', 'login');
  }
  if (/^\/(?:account\/access|i\/flow\/(?:challenge|verify|arkose|consent))(?:\/|$)/.test(path)) {
    return new XSyncBlocked('X 要求账号验证，同步已停止。请在 X 窗口完成验证后手动同步。', 'verification');
  }
  return null;
}
