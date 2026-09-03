import { OnlineStoreTarget } from './onlinePrices.types';
import { urlPertenceALoja } from './onlinePricesProductIdentity.service';

export type OnlineBrowserPage = {
  html: string | null;
  title: string | null;
  finalUrl: string;
  status: number;
  source: 'http' | 'playwright' | 'none';
  httpRequests: number;
  browserRequests: number;
  blocked: boolean;
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

let playwrightModulePromise: Promise<any | null> | null = null;
let browserPromise: Promise<any | null> | null = null;

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'sim', 's'].includes(value);
}

function pageLooksBlocked(html: string): boolean {
  const sample = String(html || '').slice(0, 160_000).toLowerCase();
  return [
    'access denied',
    'captcha',
    'verify you are human',
    'verifique se voce e humano',
    'verifique se você é humano',
    'robot or human',
    'cf-chl-',
    'cloudflare ray id',
    'enable javascript and cookies',
  ].some((signal) => sample.includes(signal));
}

function extractTitle(html: string): string | null {
  const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 360) : null;
}

async function fetchHttp(url: string, loja: OnlineStoreTarget): Promise<OnlineBrowserPage> {
  const controller = new AbortController();
  const timeoutMs = Math.max(2500, Math.min(20000, envNumber('ONLINE_PRICES_V10_HTTP_TIMEOUT_MS', 9000)));
  const maxChars = Math.max(150_000, Math.min(3_000_000, envNumber('ONLINE_PRICES_V10_MAX_HTML_CHARS', 1_800_000)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        'Cache-Control': 'no-cache',
      },
    });
    const finalUrl = urlPertenceALoja(response.url || url, loja) ? response.url || url : url;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || (contentType && !contentType.includes('html'))) {
      return {
        html: null,
        title: null,
        finalUrl,
        status: response.status,
        source: 'http',
        httpRequests: 1,
        browserRequests: 0,
        blocked: response.status === 403 || response.status === 429,
      };
    }
    const html = (await response.text()).slice(0, maxChars);
    return {
      html,
      title: extractTitle(html),
      finalUrl,
      status: response.status,
      source: 'http',
      httpRequests: 1,
      browserRequests: 0,
      blocked: pageLooksBlocked(html),
    };
  } catch (_) {
    return {
      html: null,
      title: null,
      finalUrl: url,
      status: 0,
      source: 'http',
      httpRequests: 1,
      browserRequests: 0,
      blocked: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadPlaywright(): Promise<any | null> {
  if (!playwrightModulePromise) {
    playwrightModulePromise = (async () => {
      const dynamicImport = new Function('moduleName', 'return import(moduleName)') as (moduleName: string) => Promise<any>;
      for (const moduleName of ['playwright', 'playwright-core']) {
        try {
          return await dynamicImport(moduleName);
        } catch (_) {
          // tenta a próxima opção
        }
      }
      return null;
    })();
  }
  return playwrightModulePromise;
}

async function getBrowser(): Promise<any | null> {
  if (!envBoolean('ONLINE_PRICES_V10_PLAYWRIGHT_ENABLED', true)) return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      const playwright = await loadPlaywright();
      if (!playwright?.chromium?.launch) return null;
      try {
        return await playwright.chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
        });
      } catch (error: any) {
        console.warn(`[Preços Online V10][Playwright] indisponível: ${String(error?.message || error)}`);
        return null;
      }
    })();
  }
  return browserPromise;
}

async function fetchPlaywright(url: string, loja: OnlineStoreTarget): Promise<OnlineBrowserPage | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  const timeoutMs = Math.max(4000, Math.min(30000, envNumber('ONLINE_PRICES_V10_PLAYWRIGHT_TIMEOUT_MS', 14000)));
  const settleMs = Math.max(0, Math.min(5000, envNumber('ONLINE_PRICES_V10_PLAYWRIGHT_SETTLE_MS', 1000)));
  const maxChars = Math.max(150_000, Math.min(3_000_000, envNumber('ONLINE_PRICES_V10_MAX_HTML_CHARS', 1_800_000)));
  const context = await browser.newContext({
    locale: 'pt-BR',
    userAgent: USER_AGENT,
    viewport: { width: 1365, height: 900 },
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    const finalUrlCandidate = page.url() || url;
    const finalUrl = urlPertenceALoja(finalUrlCandidate, loja) ? finalUrlCandidate : url;
    const html = String(await page.content()).slice(0, maxChars);
    const title = String(await page.title()).replace(/\s+/g, ' ').trim().slice(0, 360) || extractTitle(html);
    return {
      html,
      title,
      finalUrl,
      status: response?.status?.() || 200,
      source: 'playwright',
      httpRequests: 0,
      browserRequests: 1,
      blocked: pageLooksBlocked(html),
    };
  } catch (_) {
    return {
      html: null,
      title: null,
      finalUrl: url,
      status: 0,
      source: 'playwright',
      httpRequests: 0,
      browserRequests: 1,
      blocked: false,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function abrirPaginaProduto(params: {
  url: string;
  loja: OnlineStoreTarget;
  forcePlaywright?: boolean;
}): Promise<OnlineBrowserPage> {
  if (!urlPertenceALoja(params.url, params.loja)) {
    return {
      html: null,
      title: null,
      finalUrl: params.url,
      status: 0,
      source: 'none',
      httpRequests: 0,
      browserRequests: 0,
      blocked: false,
    };
  }

  const http = await fetchHttp(params.url, params.loja);
  const minHtmlChars = Math.max(20_000, envNumber('ONLINE_PRICES_V10_MIN_USEFUL_HTML_CHARS', 45_000));
  const shouldEscalate =
    params.forcePlaywright ||
    !http.html ||
    http.blocked ||
    http.html.length < minHtmlChars;

  if (!shouldEscalate) return http;

  const rendered = await fetchPlaywright(http.finalUrl || params.url, params.loja);
  if (rendered?.html && !rendered.blocked) {
    return {
      ...rendered,
      httpRequests: http.httpRequests + rendered.httpRequests,
      browserRequests: http.browserRequests + rendered.browserRequests,
    };
  }

  return {
    ...http,
    browserRequests: http.browserRequests + (rendered?.browserRequests || 0),
  };
}
