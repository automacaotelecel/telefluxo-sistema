const READ_ONLY = String(import.meta.env.VITE_READ_ONLY || '').toLowerCase() === 'true';

const SAFE_POST_PREFIXES = [
  '/login',
  '/api/clark',
  '/api/product-master/refresh',
];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return String(init.method).toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return String(input.method || 'GET').toUpperCase();
  }
  return 'GET';
}

function pathnameFromUrl(value: string): string {
  try {
    return new URL(value, window.location.origin).pathname;
  } catch {
    return value;
  }
}

function isSafeReadOnlyRequest(method: string, pathname: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

  if (method === 'POST') {
    return SAFE_POST_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }

  return false;
}

/**
 * Ambiente testers usando dados reais de produção.
 *
 * O VITE_API_URL aponta para o Render de produção, mas este guard bloqueia
 * mutações comuns no navegador. Login e consultas da Clark continuam liberados.
 * Para testar gravações de verdade, use backend/banco local ou uma cópia da base.
 */
export function installTesterReadOnlyGuard() {
  if (!READ_ONLY || typeof window === 'undefined') return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = requestMethod(input, init);
    const url = requestUrl(input);
    const pathname = pathnameFromUrl(url);

    if (!isSafeReadOnlyRequest(method, pathname)) {
      console.warn(`[TESTERS READ-ONLY] Bloqueado ${method} ${pathname}`);
      return new Response(
        JSON.stringify({
          error:
            'Ambiente testers está usando dados de produção em modo somente leitura. Esta alteração foi bloqueada.',
          readOnly: true,
        }),
        {
          status: 423,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return originalFetch(input, init);
  };
}

export function isTesterReadOnly() {
  return READ_ONLY;
}
