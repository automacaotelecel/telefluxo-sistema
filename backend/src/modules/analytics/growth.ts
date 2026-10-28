import { formatBRL } from '../intent/extractFilters';

type PeriodoSimples = { inicio: string; fim: string; descricao: string };

export type ClarkComparacaoMensal = {
  /** Período a consultar no banco (inclui o mês anterior quando o período pedido cobre só um mês). */
  periodoConsulta: PeriodoSimples;
  /** Dia do mês usado para comparar períodos equivalentes. Null quando o último mês está completo. */
  diaCorte: number | null;
  /** Mês (YYYY-MM) que está parcial no período pedido. */
  mesParcial: string | null;
};

function diasNoMes(ano: number, mes: number) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function mesAnteriorChave(chave: string) {
  const ano = Number(chave.slice(0, 4));
  const mes = Number(chave.slice(5, 7));
  return mes === 1
    ? `${ano - 1}-12`
    : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

/**
 * Define como comparar o último mês do período:
 * - se o período termina antes do último dia do mês (ex.: mês atual até hoje), o mês é
 *   parcial e deve ser comparado com os mesmos dias do mês anterior (MTD vs MTD);
 * - se o período cobre só um mês, amplia a consulta para incluir o mês anterior.
 */
export function prepararComparacaoMensalClark(periodo: PeriodoSimples): ClarkComparacaoMensal {
  const fimMes = String(periodo.fim || '').slice(0, 7);
  const ano = Number(fimMes.slice(0, 4));
  const mes = Number(fimMes.slice(5, 7));
  const diaFim = Number(String(periodo.fim || '').slice(8, 10));

  if (!ano || !mes || !diaFim) {
    return { periodoConsulta: periodo, diaCorte: null, mesParcial: null };
  }

  const parcial = diaFim < diasNoMes(ano, mes);
  const umSoMes = String(periodo.inicio || '').slice(0, 7) === fimMes;
  const inicio = umSoMes ? `${mesAnteriorChave(fimMes)}-01` : periodo.inicio;

  return {
    periodoConsulta: { ...periodo, inicio },
    diaCorte: parcial ? diaFim : null,
    mesParcial: parcial ? fimMes : null,
  };
}

export function calcularCrescimentoMensalClark(
  meses: any[],
  opcoes: { diaCorte?: number | null; mesParcial?: string | null } = {},
) {
  const porMes = new Map<string, any>(meses.map((m) => [String(m.mes), m]));

  return meses.map((mesAtual) => {
    const mesAnterior = porMes.get(mesAnteriorChave(String(mesAtual.mes)));
    const usaMtd = Boolean(opcoes.diaCorte && opcoes.mesParcial === mesAtual.mes);

    if (!mesAnterior) {
      return {
        ...mesAtual,
        vendas_mes_anterior: null,
        vendas_mes_anterior_formatado: null,
        crescimento_percentual: null,
        base_comparacao: null,
        crescimento_descricao: 'Sem mês anterior para comparação',
      };
    }

    // Comparação equivalente: mês parcial usa só os dias já decorridos nos dois meses.
    const valorAtual = Number(mesAtual.total_vendas) || 0;
    const valorAnterior = usaMtd
      ? Number(mesAnterior.total_vendas_ate_dia) || 0
      : Number(mesAnterior.total_vendas) || 0;

    if (!valorAnterior) {
      return {
        ...mesAtual,
        vendas_mes_anterior: valorAnterior,
        vendas_mes_anterior_formatado: formatBRL(valorAnterior),
        crescimento_percentual: null,
        base_comparacao: usaMtd ? 'mtd' : 'mes_completo',
        crescimento_descricao:
          'Mês anterior sem vendas no período comparado; não há base para calcular percentual',
      };
    }

    const diferenca = valorAtual - valorAnterior;
    const crescimento = (diferenca / valorAnterior) * 100;
    const textoVar =
      crescimento >= 0
        ? `Crescimento de ${crescimento.toFixed(2)}%`
        : `Queda de ${Math.abs(crescimento).toFixed(2)}%`;

    return {
      ...mesAtual,
      vendas_mes_anterior: valorAnterior,
      vendas_mes_anterior_formatado: formatBRL(valorAnterior),
      ...(usaMtd
        ? {
            vendas_mes_anterior_total: Number(mesAnterior.total_vendas) || 0,
            vendas_mes_anterior_total_formatado: formatBRL(Number(mesAnterior.total_vendas) || 0),
          }
        : {}),
      diferenca_absoluta: Number(diferenca.toFixed(2)),
      diferenca_absoluta_formatado: formatBRL(diferenca),
      crescimento_percentual: Number(crescimento.toFixed(2)),
      base_comparacao: usaMtd ? 'mtd' : 'mes_completo',
      ...(usaMtd ? { dias_comparados: opcoes.diaCorte } : {}),
      crescimento_descricao: usaMtd
        ? `${textoVar} (comparação parcial: dias 1 a ${opcoes.diaCorte} dos dois meses)`
        : textoVar,
    };
  });
}
