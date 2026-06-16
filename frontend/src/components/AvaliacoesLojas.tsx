import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Clock,
  Download,
  Percent,
  RefreshCw,
  Search,
  Star,
  Store,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';

type AvaliacaoLoja = {
  loja: string;
  vendas: number;
  avaliacoes: number;
  conversao: number;
  nota: string | number;
};

// --- CONFIGURAÇÕES DE INTEGRAÇÃO ---
const SHEET_ID = '1t4eM7Zy3P7ADAqJpm7-K95lbnysMlnQ9CSMZOXX9mDY';
const SHEET_GID = '0';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const LOJAS_MAP_GLOBAL: Record<string, string> = {
  "12309173001309": "ARAGUAIA SHOPPING",
  "12309173000418": "BOULEVARD SHOPPING",
  "12309173000175": "BRASILIA SHOPPING",
  "12309173000680": "CONJUNTO NACIONAL",
  "12309173001228": "CONJUNTO NACIONAL QUIOSQUE",
  "12309173000507": "GOIANIA SHOPPING",
  "12309173000256": "IGUATEMI SHOPPING",
  "12309173000841": "JK SHOPPING",
  "12309173000337": "PARK SHOPPING",
  "12309173000922": "PATIO BRASIL",
  "12309173000760": "TAGUATINGA SHOPPING",
  "12309173001147": "TERRAÇO SHOPPING",
  "12309173001651": "TAGUATINGA SHOPPING QQ",
  "12309173001732": "UBERLÂNDIA SHOPPING",
  "12309173001813": "UBERABA SHOPPING",
  "12309173001570": "FLAMBOYANT SHOPPING",
  "12309173002119": "BURITI SHOPPING",
  "12309173002461": "PASSEIO DAS AGUAS",
  "12309173002038": "PORTAL SHOPPING",
  "12309173002208": "SHOPPING SUL",
  "12309173001902": "BURITI RIO VERDE",
  "12309173002380": "PARK ANAPOLIS",
  "12309173002542": "SHOPPING RECIFE",
  "12309173002895": "MANAIRA SHOPPING",
  "12309173002976": "IGUATEMI FORTALEZA",
  "12309173001066": "CD TAGUATINGA"
};

const NOME_ALIASES: Record<string, string> = {
  "UBERLANDIA": "UBERLÂNDIA SHOPPING",
  "UBERABA": "UBERABA SHOPPING",
  "CNB QUIOSQUE": "CONJUNTO NACIONAL QUIOSQUE",
  "CNB SHOPPING": "CONJUNTO NACIONAL",
  "PARK": "PARK SHOPPING",
  "TERRACO SHOPPING": "TERRAÇO SHOPPING",
};

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"' && insideQuotes && nextChar === '"') { current += '"'; index += 1; continue; }
    if (char === '"') { insideQuotes = !insideQuotes; continue; }
    if (char === ',' && !insideQuotes) { values.push(current.trim()); current = ''; continue; }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let currentLine = '';
  let insideQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"' && insideQuotes && nextChar === '"') { currentLine += char + nextChar; index += 1; continue; }
    if (char === '"') { insideQuotes = !insideQuotes; currentLine += char; continue; }
    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (currentLine.trim()) rows.push(parseCsvLine(currentLine));
      currentLine = '';
      if (char === '\r' && nextChar === '\n') index += 1;
      continue;
    }
    currentLine += char;
  }
  if (currentLine.trim()) rows.push(parseCsvLine(currentLine));
  return rows;
}

function onlyNumber(value: string | number) {
  if (typeof value === 'number') return value;
  const strValue = String(value || '');
  if (/^-?\d+\.\d+$/.test(strValue)) return Number(strValue);
  const normalized = strValue.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatNota(value: string | number) {
  const number = onlyNumber(value);
  if (!number && number !== 0) return '-';
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatInteger(value: string | number) {
  const number = onlyNumber(value);
  if (!Number.isFinite(number)) return '0';
  return Math.round(number).toLocaleString('pt-BR');
}

function formatPercent(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

function getNotaBadgeClass(nota: string | number) {
  const value = onlyNumber(nota);
  if (value >= 4.7) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (value >= 4.3) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (value >= 4.0) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (value > 0) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-500 border-slate-200';
}

function getConversaoBadgeClass(conversao: number) {
  if (conversao >= 15) return 'text-emerald-600 bg-emerald-50';
  if (conversao >= 8) return 'text-blue-600 bg-blue-50';
  if (conversao >= 3) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

export default function AvaliacoesLojas() {
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoLoja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const { dataExibicao, dataQueryBackend, dtFormat1, dtFormat2 } = useMemo(() => {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    
    const yyyy = ontem.getFullYear();
    const mm = String(ontem.getMonth() + 1).padStart(2, '0');
    const dd = String(ontem.getDate()).padStart(2, '0');

    return {
      dataExibicao: `${dd}/${mm}`,
      dataQueryBackend: `${yyyy}-${mm}-${dd}`,
      dtFormat1: `${dd}/${mm}`, 
      dtFormat2: `${parseInt(dd, 10)}/${parseInt(mm, 10)}` 
    };
  }, []);

  const carregarDados = async () => {
    setLoading(true);
    setError('');

    try {
      const sheetsResponse = await fetch(`${SHEET_CSV_URL}&cacheBust=${Date.now()}`, { cache: 'no-store' });
      if (!sheetsResponse.ok) throw new Error('Não foi possível acessar a planilha.');
      
      const csvText = await sheetsResponse.text();
      const parsedRows = parseCsv(csvText);

      if (parsedRows.length < 2) {
        throw new Error('Formato da planilha não reconhecido (menos de 2 linhas).');
      }

      // 1. SCANNER COM TRAVA LATERAL (FALLBACK)
      const row1 = parsedRows[0].map(normalizeText); 
      const row2 = parsedRows[1].map(normalizeText); 
      
      let avaliacoesIndex = -1;
      let notaIndex = -1;
      let memoryDate = '';

      for (let c = 0; c < row1.length; c++) {
        if (row1[c]) memoryDate = row1[c]; 

        if (memoryDate.includes(dtFormat1) || memoryDate.includes(dtFormat2)) {
          const rotulo = row2[c] || '';
          if (rotulo.includes('AVAL') || rotulo.includes('QUANT') || rotulo.includes('QTD')) {
            avaliacoesIndex = c;
          }
          if (rotulo.includes('NOTA')) {
            notaIndex = c;
          }
        }
      }

      // 🚨 TRAVA SÊNIOR: Garante puxar a coluna do lado, independente do que esteja escrito no cabeçalho
      if (notaIndex !== -1 && avaliacoesIndex === -1) {
        avaliacoesIndex = notaIndex - 1; // Força a coluna colada na esquerda (G)
      } else if (avaliacoesIndex !== -1 && notaIndex === -1) {
        notaIndex = avaliacoesIndex + 1; // Força a coluna colada na direita (H)
      }

      // 2. Busca Vendas do Backend
      let userIdLogado = '';
      try {
        const userObj = localStorage.getItem('user');
        if (userObj) userIdLogado = JSON.parse(userObj).id;
      } catch {}
      if (!userIdLogado) userIdLogado = localStorage.getItem('userId') || localStorage.getItem('telefluxo_user_id') || 'ID_DO_ADMIN_AQUI';

      let vendasData = { sales: [] };
      try {
        const backendResp = await fetch(`${API_URL}/sales?startDate=${dataQueryBackend}&endDate=${dataQueryBackend}&userId=${userIdLogado}`);
        if (backendResp.ok) vendasData = await backendResp.json();
      } catch (err) {
        console.warn('⚠️ Não foi possível carregar as vendas do backend:', err);
      }

      // 3. Agrupa Vendas por Loja
      const vendasAgrupadas: Record<string, number> = {};
      if (vendasData?.sales) {
        vendasData.sales.forEach((venda: any) => {
          const cnpj = String(venda.cnpj_empresa || venda.CNPJ_EMPRESA || '').replace(/\D/g, '');
          const nomeBanco = LOJAS_MAP_GLOBAL[cnpj] || venda.loja || venda.LOJA || 'OUTROS';
          const lojaNorm = normalizeText(nomeBanco);
          const qtd = Number(venda.quantidade || venda.QUANTIDADE || 0);
          
          if (!vendasAgrupadas[lojaNorm]) vendasAgrupadas[lojaNorm] = 0;
          vendasAgrupadas[lojaNorm] += qtd;
        });
      }

      // 4. Merge de Dados
      const dadosFinais: AvaliacaoLoja[] = parsedRows.slice(1).map(row => {
        const lojaPlanilha = row[0] || ''; 
        let nomeNorm = normalizeText(lojaPlanilha);
        
        const nomeAlvoBanco = NOME_ALIASES[nomeNorm] || nomeNorm;
        
        // Agora ele usa os índices travados pelas posições relativas
        const qtdAvaliacoes = avaliacoesIndex !== -1 ? onlyNumber(row[avaliacoesIndex]) : 0;
        const notaStr = notaIndex !== -1 ? row[notaIndex] : '';

        let vendasLoja = vendasAgrupadas[nomeAlvoBanco] || 0;
        if (vendasLoja === 0) {
          const keyAproximada = Object.keys(vendasAgrupadas).find(k => k.includes(nomeNorm) || nomeNorm.includes(k));
          if (keyAproximada) vendasLoja = vendasAgrupadas[keyAproximada];
        }

        const conversao = vendasLoja > 0 ? (qtdAvaliacoes / vendasLoja) * 100 : 0;

        return {
          loja: lojaPlanilha,
          nota: notaStr,
          avaliacoes: qtdAvaliacoes,
          vendas: vendasLoja,
          conversao: conversao
        };
      }).filter(item => {
        const l = item.loja.toUpperCase();
        return l && !l.includes('LOJA SISTEMA') && !l.includes('LOJA A PROCURAR') && l !== '--00' && l !== 'LOJA';
      });

      setAvaliacoes(dadosFinais);
      setLastUpdate(new Date());

    } catch (err: any) {
      setError(err?.message || 'Erro ao processar os dados das Lojas.');
      setAvaliacoes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const filteredAvaliacoes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return avaliacoes;

    return avaliacoes.filter((item) => {
      return [item.loja, item.vendas, item.avaliacoes, item.nota]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [avaliacoes, search]);

  const resumo = useMemo(() => {
    const totalLojas = avaliacoes.length;
    const totalVendas = avaliacoes.reduce((acc, item) => acc + item.vendas, 0);
    const totalAvaliacoes = avaliacoes.reduce((acc, item) => acc + item.avaliacoes, 0);
    const conversaoGeral = totalVendas > 0 ? (totalAvaliacoes / totalVendas) * 100 : 0;

    return { totalLojas, totalVendas, totalAvaliacoes, conversaoGeral };
  }, [avaliacoes]);

  const exportarParaExcel = () => {
    if (!filteredAvaliacoes.length) return;
    const cabecalho = ['Loja', `Vendas (${dataExibicao})`, `Avaliacoes (${dataExibicao})`, 'Conversao (%)', 'Nota'];
    
    const linhas = filteredAvaliacoes.map(item => [
      `"${item.loja}"`,
      `"${item.vendas}"`,
      `"${item.avaliacoes}"`,
      `"${formatPercent(item.conversao)}"`,
      `"${formatNota(item.nota)}"`
    ]);

    const csvContent = '\uFEFF' + [cabecalho.join(';'), ...linhas.map(row => row.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Avaliacoes_Vendas_${dataQueryBackend}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* CABEÇALHO */}
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black text-orange-600 uppercase tracking-[0.22em] mb-2">
              <Percent size={15} className="stroke-[3px]" />
              Performance Operacional
            </div>
            <h1 className="text-2xl md:text-4xl font-black text-slate-900 uppercase tracking-tight italic">
              Conversão de Avaliações
            </h1>
            <p className="text-slate-500 text-sm font-bold mt-1">
              Referente a ontem: <span className="text-slate-800 bg-slate-200 px-2 py-0.5 rounded">{dataExibicao}</span>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar loja..."
                className="w-full sm:w-64 pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none focus:ring-4 focus:ring-orange-100 focus:border-orange-400 transition-all"
              />
            </div>
            <button
              onClick={exportarParaExcel}
              disabled={loading || filteredAvaliacoes.length === 0}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-md transition-all active:scale-95"
            >
              <Download size={16} /> Exportar
            </button>
            <button
              onClick={carregarDados}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed shadow-md transition-all active:scale-95"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
            </button>
          </div>
        </div>

        {/* CARDS DE KPI */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-slate-100 border-b-4 border-b-slate-200 p-5 flex items-start justify-between group">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lojas Avaliadas</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{resumo.totalLojas}</p>
            </div>
            <Store className="text-slate-300 group-hover:text-slate-500 transition-colors" size={24} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 border-b-4 border-b-slate-200 p-5 flex items-start justify-between group">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vendas (Ontem)</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{formatInteger(resumo.totalVendas)}</p>
            </div>
            <ShoppingCart className="text-slate-300 group-hover:text-slate-500 transition-colors" size={24} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 border-b-4 border-b-slate-200 p-5 flex items-start justify-between group">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Avaliações Recebidas</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{formatInteger(resumo.totalAvaliacoes)}</p>
            </div>
            <Star className="text-slate-300 group-hover:text-orange-400 transition-colors" size={24} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 border-b-4 border-b-slate-200 p-5 flex items-start justify-between group">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Conversão Média</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{formatPercent(resumo.conversaoGeral)}</p>
            </div>
            <TrendingUp className="text-slate-300 group-hover:text-emerald-500 transition-colors" size={24} />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black uppercase">Aviso de Leitura</p>
              <p className="text-sm font-medium mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* TABELA DADOS */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500">Loja</th>
                  <th className="px-5 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 text-center border-l border-slate-200">
                    Vendas <br/><span className="text-[9px] opacity-70">({dataExibicao})</span>
                  </th>
                  <th className="px-5 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 text-center">
                    Avaliações <br/><span className="text-[9px] opacity-70">({dataExibicao})</span>
                  </th>
                  <th className="px-5 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 text-center">
                    Conversão
                  </th>
                  <th className="px-5 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 text-center border-l border-slate-200">Nota</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center">
                      <div className="inline-flex items-center gap-3 text-slate-500 text-sm font-bold uppercase">
                        <RefreshCw size={18} className="animate-spin" />
                        Sincronizando Sheets e Banco...
                      </div>
                    </td>
                  </tr>
                ) : filteredAvaliacoes.length ? (
                  filteredAvaliacoes.map((item, index) => (
                    <tr key={`${item.loja}-${index}`} className="hover:bg-slate-50/80 transition-colors group">
                      
                      <td className="px-5 py-2.5">
                        <div className="text-[13px] font-bold text-slate-800 uppercase">{item.loja}</div>
                      </td>

                      <td className="px-5 py-2.5 text-center border-l border-slate-100">
                        <span className="text-[13px] font-bold text-slate-700">
                          {formatInteger(item.vendas)}
                        </span>
                      </td>

                      <td className="px-5 py-2.5 text-center">
                        <span className="text-[13px] font-black text-slate-900">
                          {formatInteger(item.avaliacoes)}
                        </span>
                      </td>

                      <td className="px-5 py-2.5 text-center">
                        <div className="flex justify-center">
                           <span className={`px-2.5 py-1 rounded-md text-[12px] font-black ${getConversaoBadgeClass(item.conversao)}`}>
                             {formatPercent(item.conversao)}
                           </span>
                        </div>
                      </td>

                      <td className="px-5 py-2.5 text-center border-l border-slate-100">
                        <div className="flex justify-center">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-black ${getNotaBadgeClass(item.nota)}`}>
                            <Star size={11} fill="currentColor" />
                            {formatNota(item.nota)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center text-[13px] font-medium text-slate-400">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {filteredAvaliacoes.length} registro(s) processados
             </p>
             {lastUpdate && (
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Clock size={12} />
                Sincronizado às {lastUpdate.toLocaleTimeString('pt-BR')}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}