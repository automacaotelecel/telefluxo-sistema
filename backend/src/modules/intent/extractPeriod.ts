import { ClarkPeriodo } from '../clark/clark.types';
import { normalizarTextoClark } from './extractFilters';

function todayIsoSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function obterUltimoDiaMes(ano: number, mes: number) {
  return new Date(ano, mes, 0).getDate();
}

function parseDataBRParaIsoClark(value: string) {
  const m = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

  if (!m) return '';

  const diaRaw = m[1];
  const mesRaw = m[2];
  let anoRaw = m[3];

  if (!diaRaw || !mesRaw || !anoRaw) return '';

  const dia = diaRaw.padStart(2, '0');
  const mes = mesRaw.padStart(2, '0');

  if (anoRaw.length === 2) {
    anoRaw = `20${anoRaw}`;
  }

  return `${anoRaw}-${mes}-${dia}`;
}

const MESES: Record<string, number> = {
  JANEIRO: 1,
  FEVEREIRO: 2,
  MARCO: 3,
  MARÇO: 3,
  ABRIL: 4,
  MAIO: 5,
  JUNHO: 6,
  JULHO: 7,
  AGOSTO: 8,
  SETEMBRO: 9,
  OUTUBRO: 10,
  NOVEMBRO: 11,
  DEZEMBRO: 12,
};

function extrairAno(texto: string, anoPadrao: number) {
  const anoMatch = texto.match(/\b(20\d{2})\b/);
  return anoMatch?.[1] ? Number(anoMatch[1]) : anoPadrao;
}

function extrairPeriodoEntreMesesClark(pergunta: string): ClarkPeriodo | null {
  const texto = normalizarTextoClark(pergunta);
  const hoje = todayIsoSaoPaulo();
  const anoAtual = Number(hoje.slice(0, 4));

  const encontrados = Object.entries(MESES)
    .filter(([nome]) => texto.includes(nome))
    .map(([nome, numero]) => ({ nome, numero }));

  const unicos = encontrados.filter((item, index, arr) => {
    return arr.findIndex((x) => x.numero === item.numero) === index;
  });

  if (unicos.length < 2) return null;

  const primeiro = unicos[0];
  const ultimo = unicos[unicos.length - 1];

  if (!primeiro || !ultimo) return null;

  const ano = extrairAno(texto, anoAtual);
  const ultimoDia = obterUltimoDiaMes(ano, ultimo.numero);

  return {
    inicio: `${ano}-${String(primeiro.numero).padStart(2, '0')}-01`,
    fim: `${ano}-${String(ultimo.numero).padStart(2, '0')}-${String(
      ultimoDia
    ).padStart(2, '0')}`,
    descricao: `${primeiro.nome} até ${ultimo.nome} de ${ano}`,
  };
}

export function extrairPeriodoClark(pergunta: string): ClarkPeriodo {
  const hoje = todayIsoSaoPaulo();
  const anoAtual = Number(hoje.slice(0, 4));
  const inicioMesAtual = `${hoje.slice(0, 7)}-01`;

  const perguntaOriginal = String(pergunta || '');
  const texto = normalizarTextoClark(perguntaOriginal);

  const datasBR =
    perguntaOriginal.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || [];

  if (datasBR.length >= 2) {
    const dataInicioBR = datasBR[0];
    const dataFimBR = datasBR[1];

    if (dataInicioBR && dataFimBR) {
      const inicio = parseDataBRParaIsoClark(dataInicioBR);
      const fim = parseDataBRParaIsoClark(dataFimBR);

      if (inicio && fim) {
        return {
          inicio,
          fim,
          descricao: `${dataInicioBR} até ${dataFimBR}`,
        };
      }
    }
  }

  const datasIso = perguntaOriginal.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];

  if (datasIso.length >= 2) {
    const inicio = datasIso[0];
    const fim = datasIso[1];

    if (inicio && fim) {
      return {
        inicio,
        fim,
        descricao: `${inicio} até ${fim}`,
      };
    }
  }

  if (texto.includes('HOJE')) {
    return {
      inicio: hoje,
      fim: hoje,
      descricao: `Hoje (${hoje})`,
    };
  }

  if (texto.includes('ONTEM')) {
    const d = new Date(`${hoje}T00:00:00`);
    d.setDate(d.getDate() - 1);
    const ontem = d.toISOString().slice(0, 10);

    return {
      inicio: ontem,
      fim: ontem,
      descricao: `Ontem (${ontem})`,
    };
  }

  if (texto.includes('ULTIMOS 7 DIAS') || texto.includes('ÚLTIMOS 7 DIAS')) {
    const d = new Date(`${hoje}T00:00:00`);
    d.setDate(d.getDate() - 6);
    const inicio = d.toISOString().slice(0, 10);

    return {
      inicio,
      fim: hoje,
      descricao: `Últimos 7 dias (${inicio} até ${hoje})`,
    };
  }

  if (texto.includes('ULTIMOS 30 DIAS') || texto.includes('ÚLTIMOS 30 DIAS')) {
    const d = new Date(`${hoje}T00:00:00`);
    d.setDate(d.getDate() - 29);
    const inicio = d.toISOString().slice(0, 10);

    return {
      inicio,
      fim: hoje,
      descricao: `Últimos 30 dias (${inicio} até ${hoje})`,
    };
  }

  const periodoEntreMeses = extrairPeriodoEntreMesesClark(perguntaOriginal);

  if (periodoEntreMeses) {
    return periodoEntreMeses;
  }

  for (const [nomeMes, numeroMes] of Object.entries(MESES)) {
    if (texto.includes(nomeMes)) {
      const ano = extrairAno(texto, anoAtual);
      const ultimoDia = obterUltimoDiaMes(ano, numeroMes);

      return {
        inicio: `${ano}-${String(numeroMes).padStart(2, '0')}-01`,
        fim: `${ano}-${String(numeroMes).padStart(2, '0')}-${String(
          ultimoDia
        ).padStart(2, '0')}`,
        descricao: `${nomeMes} de ${ano}`,
      };
    }
  }

  if (
    texto.includes('ANO') ||
    texto.includes('ANUAL') ||
    /\b20\d{2}\b/.test(texto)
  ) {
    const ano = extrairAno(texto, anoAtual);
    const fimAno = ano === anoAtual ? hoje : `${ano}-12-31`;

    return {
      inicio: `${ano}-01-01`,
      fim: fimAno,
      descricao: `Ano ${ano} (${ano}-01-01 até ${fimAno})`,
    };
  }

  return {
    inicio: inicioMesAtual,
    fim: hoje,
    descricao: `Mês atual (${inicioMesAtual} até ${hoje})`,
  };
}