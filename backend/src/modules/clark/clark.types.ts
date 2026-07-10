export type ClarkModo = 'simples' | 'analitico';

export type ClarkIntent =
  | 'vendas_resumo'
  | 'ranking_lojas_vendas'
  | 'ranking_vendedores_vendas'
  | 'ranking_categorias_vendas'
  | 'ranking_vendedores_seguros'
  | 'ranking_lojas_seguros'
  | 'estoque_produto_lojas'
  | 'produto_maior_estoque'
  | 'ranking_estoque_produtos'
  | 'relatorio_analitico_vendas'
  | 'comparativo_lojas'
  | 'crescimento_mensal'
  | 'ajuda';

export type ClarkPeriodo = {
  inicio: string;
  fim: string;
  descricao: string;
};

export type ClarkProdutoPlanejado = {
  raw: string | null;
  family: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  category: string | null;
};

export type ClarkFiltros = {
  limite: number;

  categoriaOriginal: string | undefined;
  categoriaCanonica: string | undefined;
  aliasesCategoria: string[];

  termoProduto: string;
  tokensProduto: string[];

  produtoPlanejado: ClarkProdutoPlanejado | null;

  lojaOriginal: string | undefined;
  lojaCanonica: string | undefined;
  cnpjLoja: string | undefined;

  detalharPorLoja: boolean;
  detalharPorVendedor: boolean;
  detalharPorCategoria: boolean;
  detalharPorMes: boolean;
};

export type ClarkUserScope = {
  isSuperUser: boolean;
  allowedStoreNames: string[];
  allowedCnpjs: string[];
};

export type ClarkHistoricoMensagem = {
  role: 'user' | 'assistant' | 'system';
  text: string;
};

// Compatibilidade com versões anteriores do service.
export type ClarkHistoricoItem = ClarkHistoricoMensagem;

export type ClarkPerguntaInput = {
  userId: string;
  pergunta: string;
  historico?: ClarkHistoricoMensagem[];
};

export type ClarkAction = {
  type: 'download_excel' | string;
  label: string;
  payload?: unknown;
};

export type ClarkRespostaOrigem =
  | 'local_precisa'
  | 'gemini_analitico'
  | 'claude_analitico'
  | 'fallback';

export type ClarkResposta = {
  ok: boolean;
  clark: string;
  intencao: ClarkIntent;
  modo: ClarkModo;
  periodo: ClarkPeriodo;
  filtros: ClarkFiltros;
  dados: any;
  resposta_origem: ClarkRespostaOrigem; 
  sugestoes?: string[];
  debug?: any;
  actions?: ClarkAction[];
};

export type ClarkDbContext = {
  annualDb: any | null;
  globalDb: any | null;
};

export const LOJAS_MAP_GLOBAL: Record<string, string> = {
  '12309173001309': 'ARAGUAIA SHOPPING',
  '12309173000418': 'BOULEVARD SHOPPING',
  '12309173000175': 'BRASILIA SHOPPING',
  '12309173000680': 'CONJUNTO NACIONAL',
  '12309173001228': 'CONJUNTO NACIONAL QUIOSQUE',
  '12309173000507': 'GOIANIA SHOPPING',
  '12309173000256': 'IGUATEMI SHOPPING',
  '12309173000841': 'JK SHOPPING',
  '12309173000337': 'PARK SHOPPING',
  '12309173000922': 'PATIO BRASIL',
  '12309173000760': 'TAGUATINGA SHOPPING',
  '12309173001147': 'TERRAÇO SHOPPING',
  '12309173001651': 'TAGUATINGA SHOPPING QQ',
  '12309173001732': 'UBERLÂNDIA SHOPPING',
  '12309173001813': 'UBERABA SHOPPING',
  '12309173001570': 'FLAMBOYANT SHOPPING',
  '12309173002119': 'BURITI SHOPPING',
  '12309173002461': 'PASSEIO DAS AGUAS',
  '12309173002038': 'PORTAL SHOPPING',
  '12309173002208': 'SHOPPING SUL',
  '12309173001902': 'BURITI RIO VERDE',
  '12309173002380': 'PARK ANAPOLIS',
  '12309173002542': 'SHOPPING RECIFE',
  '12309173002895': 'MANAIRA SHOPPING',
  '12309173002976': 'IGUATEMI FORTALEZA',
  '12309173001066': 'CD TAGUATINGA',
};

export const CORRECAO_NOMES_SERVER: Record<string, string> = {
  UBERABA: 'UBERABA SHOPPING',
  'UBERLÂNDIA': 'UBERLÂNDIA SHOPPING',
  UBERLANDIA: 'UBERLÂNDIA SHOPPING',
  'CNB SHOPPING': 'CONJUNTO NACIONAL',
  'CNB QUIOSQUE': 'CONJUNTO NACIONAL QUIOSQUE',
  'QQ TAGUATINGA SHOPPING': 'TAGUATINGA SHOPPING QQ',
  'ESTOQUE CD': 'CD TAGUATINGA',
  CD: 'CD TAGUATINGA',
  'PASSEIO DAS ÁGUAS': 'PASSEIO DAS AGUAS',
  'PASSEIO DAS AGUAS': 'PASSEIO DAS AGUAS',
  'TERRACO SHOPPING': 'TERRAÇO SHOPPING',
  'TERRAÇO SHOPPING': 'TERRAÇO SHOPPING',
  PARK: 'PARK SHOPPING',
  PARKSHOPPING: 'PARK SHOPPING',
  'PARK SHOPPING': 'PARK SHOPPING',
  TAGUATINGA: 'TAGUATINGA SHOPPING',
  JK: 'JK SHOPPING',
  IGUATEMI: 'IGUATEMI SHOPPING',
};
