import { formatBRL } from '../intent/extractFilters';

export function calcularCrescimentoMensalClark(meses: any[]) {
  return meses.map((mesAtual, index) => {
    const mesAnterior = meses[index - 1];

    if (!mesAnterior || !mesAnterior.total_vendas) {
      return {
        ...mesAtual,
        vendas_mes_anterior: null,
        vendas_mes_anterior_formatado: null,
        crescimento_percentual: null,
        crescimento_descricao: 'Sem mês anterior para comparação',
      };
    }

    const crescimento =
      ((mesAtual.total_vendas - mesAnterior.total_vendas) /
        mesAnterior.total_vendas) *
      100;

    return {
      ...mesAtual,
      vendas_mes_anterior: mesAnterior.total_vendas,
      vendas_mes_anterior_formatado: formatBRL(mesAnterior.total_vendas),
      crescimento_percentual: Number(crescimento.toFixed(2)),
      crescimento_descricao:
        crescimento >= 0
          ? `Crescimento de ${crescimento.toFixed(2)}%`
          : `Queda de ${Math.abs(crescimento).toFixed(2)}%`,
    };
  });
}