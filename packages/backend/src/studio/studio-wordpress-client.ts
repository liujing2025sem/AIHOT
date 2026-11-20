import { requireStudioWordPressWrite } from './studio-delivery.ts';

export type WordPressSettings = { ready: true; base: URL; user: string; password: string };

export class WordPressError extends Error {
  readonly status?: number;
  constructor(status?: number) {
    super(status ? `WordPress 返回 HTTP ${status}，请让维护人检查站点、权限或访问限制。`
      : '无法确认 WordPress 返回的结果，请让维护人检查连接和 REST 设置。');
    this.status = status;
  }
}
export function wordpressClient(target: WordPressSettings, options?: { perRequestTimeout: true }) {
  const authorization = 'Basic ' + Buffer.from(`${target.user}:${target.password}`).toString('base64');
  const signal = AbortSignal.timeout(15_000);
  return async (path: string, query: Record<string, string>, payload?: object, method?: 'OPTIONS'): Promise<unknown> => {
    // Authenticated reads use POST with a GET override below. A payload is an actual write.
    if (payload !== undefined) requireStudioWordPressWrite();
    const url = new URL(`wp-json/wp/v2/${path}`, target.base);
    url.search = new URLSearchParams(query).toString();
    // Chipshow's CDN cached authenticated GETs and ignored query parameters (real post 9597).
    // WordPress's documented POST method override keeps reads uncached with the same permissions.
    const freshRead = !payload && !method;
    try {
      const res = await fetch(url, {
        method: method ?? 'POST', redirect: 'manual', cache: 'no-store',
        signal: options ? AbortSignal.timeout(15_000) : signal,
        headers: { Authorization: authorization, Accept: 'application/json', ...(freshRead ? { 'X-HTTP-Method-Override': 'GET', 'Cache-Control': 'no-cache, no-store' } : {}), ...(payload && !(payload instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
        body: payload instanceof FormData ? payload : payload ? JSON.stringify(payload) : undefined,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new WordPressError(res.status);
      }
      return await res.json();
    } catch (error) {
      // Do not attach the request, response body, underlying error or credentials to logs or receipts.
      throw error instanceof WordPressError ? error : new WordPressError();
    }
  };
}
