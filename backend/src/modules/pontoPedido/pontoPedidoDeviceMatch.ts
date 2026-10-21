/**
 * Identificação conservadora de notebooks Samsung para o Ponto de Pedido.
 * Não associa um notebook a outro com processador, armazenamento ou RAM
 * explicitamente incompatíveis; retorna ambiguidade em vez de inventar SKU.
 */
export type NotebookIdentity = {
  family: string;
  variant: string;
  cpu: string;
  ram: string;
  storage: string;
  gpu: string;
};

function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\bSAMSUNG\b/g, ' ')
    .replace(/(\d+)\s*(GB|TB)\b/g, '$1$2')
    .replace(/\b(\d{1,2})G\b/g, '$1GB')
    .replace(/\b(\d+)\s*SSD\b/g, '$1 SSD')
    .replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseNotebookIdentity(value: unknown): NotebookIdentity | null {
  const k = norm(value);
  const t = k.split(' ');
  const book = k.match(/\bBOOK\s*(\d{1,2}|GO|S)\b/);
  if (!book) return null;

  const family = `BOOK${book[1]}`;
  // A variante pertence à linha Book e vem após BOOK4/BOOK3.
  // 'CORE ULTRA' é processador, NÃO a variante Book Ultra.
  const afterBook = k.slice((book.index ?? 0) + book[0].length).trim().split(' ');
  const first = afterBook[0] ?? '';
  const second = afterBook[1] ?? '';
  const variant = first === 'ULTRA' ? 'ULTRA'
    : first === 'EDGE' ? 'EDGE'
    : first === 'PRO' && second === '360' ? 'PRO360'
    : first === 'PRO' ? 'PRO'
    : first === '360' ? '360'
    : '';

  const cpu = k.match(/\b(?:INTEL\s+)?(?:CORE\s+)?(I[3579])(?:\s|\b)/)?.[1]
    || k.match(/\bCORE\s+(ULTRA\s+)?([3579])\b/)?.slice(1).filter(Boolean).join('')
    || (t.includes('PENTIUM') ? 'PENTIUM' : '')
    || (t.includes('SNAPDRAGON') ? 'SNAPDRAGON' : '');
  const amounts = Array.from(k.matchAll(/\b(\d+(?:GB|TB))\b/g)).map((match) => match[1] ?? '');
  // No catálogo Samsung, RAM aparece antes do SSD; identifica explicitamente SSD/UFS.
  const storageWithTag = k.match(/\b(\d+(?:GB|TB))\s*(?:SSD|EUFS|UFS)\b/)?.[1] || '';
  const storage = storageWithTag || amounts[1] || '';
  // Sem RAM explícita, não transformar a capacidade do SSD em memória RAM.
  const ram = amounts.find(
    (amount) =>
      amount !== storage &&
      /^\d+GB$/.test(amount) &&
      Number.parseInt(amount, 10) <= 128
  ) || '';
  const gpu = k.includes('RTX4070') || k.includes('RTX 4070') ? 'RTX4070'
    : k.includes('RTX4050') || k.includes('RTX 4050') ? 'RTX4050'
    : k.includes('MX570') ? 'MX570' : '';
  return { family, variant, cpu, ram, storage, gpu };
}

export function notebookIdentityCompatible(expected: NotebookIdentity, actual: NotebookIdentity): boolean {
  if (expected.family !== actual.family || expected.variant !== actual.variant) return false;
  for (const field of ['cpu', 'ram', 'storage', 'gpu'] as const) {
    if (expected[field] && !actual[field]) return false;
    if (expected[field] && actual[field] && expected[field] !== actual[field]) return false;
    // RAM e SSD são obrigatórios quando informados na planilha.
    if ((field === 'ram' || field === 'storage') && expected[field] && !actual[field]) return false;
  }
  return true;
}

export type NotebookChoice<T> = {
  item: T | null;
  ambiguous: boolean;
  candidates: T[];
};

export function matchNotebook<T>(
  items: T[], expectedText: unknown,
  getText: (item: T) => unknown,
  aliases: readonly string[] = [],
  getIdentities: (item: T) => readonly string[] = () => [],
): NotebookChoice<T> {
  const expected = parseNotebookIdentity(expectedText);
  if (!expected) return { item: null, ambiguous: false, candidates: [] };

  const normalAliases = new Set(aliases.map(x => norm(x).replace(/ /g, '')).filter(Boolean));
  const candidates = items.filter((item) => {
    const actual = parseNotebookIdentity(getText(item));
    if (!actual || !notebookIdentityCompatible(expected, actual)) return false;
    if (!normalAliases.size) return true;
    return getIdentities(item).some((v) => normalAliases.has(norm(v).replace(/ /g, '')));
  });
  // Um alias informado mas sem candidato válido NÃO libera fallback genérico.
  return {
    item: candidates.length === 1 ? candidates[0] ?? null : null,
    ambiguous: candidates.length > 1,
    candidates,
  };
}
