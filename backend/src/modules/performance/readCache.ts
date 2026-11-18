/** Cache de respostas JSON no processo, limitado por TTL, número de entradas e tamanho.
 * Não guarda credenciais. A identidade/escopo deve ser verificada ANTES de chamar load(). */
export class ReadCache {
  private entries = new Map<string, { value: unknown; expires: number; bytes: number }>();
  private pending = new Map<string, Promise<unknown>>();
  private generation = 0;
  private activeWrites = 0;
  private bytes = 0;
  constructor(private readonly ttlMs = 45000, private readonly maxEntries = 80, private readonly maxBytes = 24 * 1024 * 1024) {}
  invalidate() { this.generation++; this.entries.clear(); this.pending.clear(); this.bytes = 0; }
  beginWrite() {
    this.activeWrites++; this.invalidate();
    let ended = false;
    return () => { if (!ended) { ended = true; this.activeWrites--; this.invalidate(); } };
  }
  private remove(key: string) { const old = this.entries.get(key); if (old) { this.entries.delete(key); this.bytes -= old.bytes; } }
  async load<T>(key: string | null, compute: () => Promise<T>): Promise<T> {
    if (!key || this.activeWrites > 0) return compute();
    const old = this.entries.get(key);
    if (old && old.expires > Date.now()) { this.entries.delete(key); this.entries.set(key, old); return old.value as T; }
    this.remove(key);
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const generation = this.generation;
    const task: Promise<T> = Promise.resolve().then(compute).then(value => {
      if (generation === this.generation && this.activeWrites === 0) {
        // Valores muito grandes não entram no cache. Erros/rejeições nunca entram.
        const bytes = (JSON.stringify(value)?.length || 0) * 2;
        if (bytes <= Math.min(this.maxBytes, 2 * 1024 * 1024)) {
          this.remove(key);
          while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
            const first = this.entries.keys().next().value;
            if (first === undefined) break;
            this.remove(first);
          }
          this.entries.set(key, { value, expires: Date.now() + this.ttlMs, bytes }); this.bytes += bytes;
        }
      }
      return value;
    }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    // Evita uma fila ilimitada de chaves distintas em caso de muitos filtros simultâneos.
    if (this.pending.size < this.maxEntries) this.pending.set(key, task);
    return task;
  }
}

export const samsungReadCache = new ReadCache(45000);
export const timReadCache = new ReadCache(45000);

/** Middleware instalado antes das rotas. Cargas e alterações de permissões invalidam o cache.
 * Invalida inclusive em falhas, pois uma rota legada pode ter gravado parte da carga. */
export function cacheWriteBarrier(req: { method: string; path: string }, res: { once: (event: string, cb: () => void) => unknown }, next: () => void) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const p = req.path.replace(/\/$/, '').toLowerCase();
  const users = /^\/users(?:\/|$)/.test(p);
  const samsung = users || /^\/api\/sync(?:\/|$)/.test(p) || /^\/stock(?:\/|$)/.test(p) || p === '/sales/refresh' || /^\/api\/product-master(?:\/|$)/.test(p);
  const tim = users || p === '/api/tim/sync';
  const ends = [samsung ? samsungReadCache.beginWrite() : null, tim ? timReadCache.beginWrite() : null].filter(Boolean);
  if (ends.length) {
    const finish = () => { for (const end of ends) end?.(); };
    res.once('finish', finish); res.once('close', finish);
  }
  next();
}