/**
 * Classificação de lojas consideráveis compartilhada com o Comparativo Anual.
 * A Home utiliza a mesma chave de localStorage do cadastro do Comparativo.
 * NÃO OK e PENDENTE não entram nos cálculos líquidos.
 */
export type StatusLojaLiquida = 'OK' | 'NAO_OK' | 'PENDENTE';

export const CLASSIFICACAO_LOJAS_STORAGE_KEY = 'telefluxo.classificacao.lojas.liquidas.v1';

export const CLASSIFICACAO_LOJAS_PADRAO: Record<string, StatusLojaLiquida> = {
  'UBERLÂNDIA SHOPPING': 'OK',
  'JK SHOPPING': 'OK',
  'UBERABA SHOPPING': 'OK',
  'GOIANIA SHOPPING': 'OK',
  'BRASILIA SHOPPING': 'OK',
  'PARK SHOPPING': 'OK',
  'PATIO BRASIL': 'OK',
  'IGUATEMI SHOPPING': 'OK',
  'TAGUATINGA SHOPPING': 'OK',
  'ARAGUAIA SHOPPING': 'OK',
  'TERRAÇO SHOPPING': 'OK',
  'CONJUNTO NACIONAL': 'OK',
  'PASSEIO DAS AGUAS': 'OK',
  'SHOPPING SUL': 'OK',
  'FLAMBOYANT SHOPPING': 'OK',
  'BURITI RIO VERDE': 'OK',
  'BURITI SHOPPING': 'OK',
  'PORTAL SHOPPING': 'OK',
  'PARK ANAPOLIS': 'OK',
  'SHOPPING RECIFE': 'NAO_OK',
  'MANAIRA SHOPPING': 'NAO_OK',
  'IGUATEMI FORTALEZA': 'NAO_OK',
  'BOULEVARD SHOPPING': 'OK',
  'CONJUNTO NACIONAL QUIOSQUE': 'OK',
  'CD TAGUATINGA': 'PENDENTE',
  'TAGUATINGA SHOPPING QQ': 'PENDENTE',
};

const ALIASES: Record<string, string> = {
  'UBERLANDIA': 'UBERLÂNDIA SHOPPING',
  'UBERLANDIA SHOPPING': 'UBERLÂNDIA SHOPPING',
  'UBERABA': 'UBERABA SHOPPING',
  'CNB SHOPPING': 'CONJUNTO NACIONAL',
  'CONJUNTO NACIONAL SHOPPING': 'CONJUNTO NACIONAL',
  'CNB QUIOSQUE': 'CONJUNTO NACIONAL QUIOSQUE',
  'CONJUNTO NACIONAL QQ': 'CONJUNTO NACIONAL QUIOSQUE',
  'SD CONJUNTO NACIONAL': 'CONJUNTO NACIONAL',
  'PASSEIO DAS AGUAS SHOPPING': 'PASSEIO DAS AGUAS',
};
const CNPJ_LOJAS: Record<string, string> = {
  '12309173001309':'ARAGUAIA SHOPPING','12309173000418':'BOULEVARD SHOPPING',
  '12309173000175':'BRASILIA SHOPPING','12309173000680':'CONJUNTO NACIONAL',
  '12309173001228':'CONJUNTO NACIONAL QUIOSQUE','12309173000507':'GOIANIA SHOPPING',
  '12309173000256':'IGUATEMI SHOPPING','12309173000841':'JK SHOPPING',
  '12309173000337':'PARK SHOPPING','12309173000922':'PATIO BRASIL',
  '12309173000760':'TAGUATINGA SHOPPING','12309173001147':'TERRAÇO SHOPPING',
  '12309173001651':'TAGUATINGA SHOPPING QQ','12309173001732':'UBERLÂNDIA SHOPPING',
  '12309173001813':'UBERABA SHOPPING','12309173001570':'FLAMBOYANT SHOPPING',
  '12309173002119':'BURITI SHOPPING','12309173002461':'PASSEIO DAS AGUAS',
  '12309173002038':'PORTAL SHOPPING','12309173002208':'SHOPPING SUL',
  '12309173001902':'BURITI RIO VERDE','12309173002380':'PARK ANAPOLIS',
  '12309173002542':'SHOPPING RECIFE','12309173002895':'MANAIRA SHOPPING',
  '12309173002976':'IGUATEMI FORTALEZA','12309173001066':'CD TAGUATINGA',
};

function semAcento(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

const canonicalByNormalized = Object.keys(CLASSIFICACAO_LOJAS_PADRAO).reduce<Record<string, string>>((result, nome) => {
  result[semAcento(nome)] = nome;
  return result;
}, {});

export function normalizarLojaLiquida(value: string): string {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 14 && CNPJ_LOJAS[digits]) return CNPJ_LOJAS[digits];
  let clean = semAcento(raw).replace(/^SSG\s+/, '').replace(/^SAMSUNG\s*-\s*MRF\s*-\s*/, '');
  const alias = ALIASES[clean];
  if (alias) return alias;
  clean = canonicalByNormalized[clean] || clean;
  return clean;
}

export function lerClassificacaoPersonalizada(): Record<string, StatusLojaLiquida> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLASSIFICACAO_LOJAS_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, StatusLojaLiquida> = {};
    for (const [nome, status] of Object.entries(parsed)) {
      if (status === 'OK' || status === 'NAO_OK' || status === 'PENDENTE') {
        result[normalizarLojaLiquida(nome)] = status;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function statusLojaLiquida(nome: string, personalizadas: Record<string, StatusLojaLiquida>): StatusLojaLiquida {
  const chave = normalizarLojaLiquida(nome);
  return personalizadas[chave] || CLASSIFICACAO_LOJAS_PADRAO[chave] || 'PENDENTE';
}

export function lojaEhLiquida(nome: string, personalizadas: Record<string, StatusLojaLiquida>): boolean {
  return statusLojaLiquida(nome, personalizadas) === 'OK';
}
