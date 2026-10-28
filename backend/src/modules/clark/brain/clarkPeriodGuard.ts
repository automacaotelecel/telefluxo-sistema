import { ClarkPeriodo } from '../clark.types';

const MAX_DIAS_INTERVALO = 800; // ~26 meses
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type ClarkPeriodoValidado = { periodo: ClarkPeriodo; ajustado: boolean; motivo?: string };

export function hojeSaoPauloClark(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function ehDataIso(v: any): v is string {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function periodoPadraoClark(hoje = hojeSaoPauloClark()): ClarkPeriodo {
  const inicio = `${hoje.slice(0, 7)}-01`;
  return { inicio, fim: hoje, descricao: `Mês atual (${inicio} até ${hoje})` };
}

/** Valida um período decidido pelo LLM. Nunca lança: ajusta, registra em log e segue. */
export function validarPeriodoClark(candidato: any, hoje = hojeSaoPauloClark()): ClarkPeriodoValidado {
  const padrao = periodoPadraoClark(hoje);
  const log = (motivo: string) =>
    console.warn(`[clark][period-guard] ${motivo} | recebido=${JSON.stringify(candidato)} | hoje=${hoje}`);

  if (!candidato || (!candidato.inicio && !candidato.fim)) {
    return { periodo: padrao, ajustado: true, motivo: 'período não informado' };
  }

  let { inicio, fim } = candidato;

  if (!ehDataIso(inicio) || !ehDataIso(fim)) {
    log('datas inválidas');
    return { periodo: padrao, ajustado: true, motivo: 'datas inválidas' };
  }

  let ajustado = false;
  const motivos: string[] = [];

  if (inicio > fim) {
    // Intenção clara, só veio invertido: troca em vez de descartar.
    [inicio, fim] = [fim, inicio];
    ajustado = true;
    motivos.push('início maior que fim (datas trocadas)');
    log('início maior que fim; datas trocadas');
  }

  if (inicio < '2000-01-01' || inicio > hoje) {
    log('início fora do intervalo plausível');
    return { periodo: padrao, ajustado: true, motivo: 'início inválido' };
  }

  if (fim > hoje) {
    fim = hoje;
    ajustado = true;
    motivos.push('fim no futuro truncado em hoje');
    log('fim no futuro truncado em hoje');
  }

  if (diasEntre(inicio, fim) > MAX_DIAS_INTERVALO) {
    log('intervalo maior que o permitido');
    return { periodo: padrao, ajustado: true, motivo: 'intervalo absurdo' };
  }

  const descricao = String(candidato.descricao || '').trim().slice(0, 120) || `${inicio} até ${fim}`;

  return {
    periodo: { inicio, fim, descricao },
    ajustado,
    ...(motivos.length ? { motivo: motivos.join('; ') } : {}),
  };
}

/** Até 2 períodos (principal + comparação). */
export function validarPeriodosClark(lista: any, hoje = hojeSaoPauloClark()): ClarkPeriodoValidado[] {
  const itens = Array.isArray(lista) ? lista.slice(0, 2) : [];
  return itens.length ? itens.map((p) => validarPeriodoClark(p, hoje)) : [validarPeriodoClark(null, hoje)];
}
