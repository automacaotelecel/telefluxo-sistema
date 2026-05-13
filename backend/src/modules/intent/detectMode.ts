import { ClarkModo } from '../clark/clark.types';
import { normalizarTextoClark } from './extractFilters';

export function detectarModoClark(pergunta: string): ClarkModo {
  const texto = normalizarTextoClark(pergunta);

  const termosAnaliticos = [
    'RELATORIO',
    'RELATÓRIO',
    'ANALISE',
    'ANÁLISE',
    'ANALITICO',
    'ANALÍTICO',
    'COMPLETO',
    'COMPLETA',
    'CRESCIMENTO',
    'EVOLUCAO',
    'EVOLUÇÃO',
    'MES A MES',
    'MÊS A MÊS',
    'COMPARATIVO',
    'COMPARAR',
    'COMPARACAO',
    'COMPARAÇÃO',
    'INSIGHT',
    'INSIGHTS',
    'SUGESTAO',
    'SUGESTÃO',
    'SUGESTOES',
    'SUGESTÕES',
    'ESTRATEGICO',
    'ESTRATÉGICO',
    'DESEMPENHO',
    'PERFORMANCE',
  ];

  return termosAnaliticos.some((termo) => texto.includes(termo))
    ? 'analitico'
    : 'simples';
}