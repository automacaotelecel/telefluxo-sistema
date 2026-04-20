import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, RefreshCw, Search, ShieldCheck } from 'lucide-react';

const formatMoney = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const formatNumber = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('pt-BR');

const getUserId = () => {
  for (const key of ['telefluxo_user', 'user']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.id) return String(parsed.id);
    } catch {
      // ignore
    }
  }
  return '';
};

const getApiCandidates = (path: string) => {
  const sameOrigin = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}${path}`
    : '';

  return [sameOrigin, `http://localhost:3000${path}`, `https://telefluxo-aplicacao.onrender.com${path}`].filter(Boolean);
};

const fetchJsonFromCandidates = async (path: string) => {
  const candidates = getApiCandidates(path);
  let lastError = `Não consegui acessar ${path}`;

  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = `Falha ao ler ${url} (${response.status})`;
        continue;
      }
      return { url, data: await response.json() };
    } catch (error: any) {
      lastError = error?.message || `Erro ao acessar ${url}`;
    }
  }

  throw new Error(lastError);
};

type CompraRow = {
  dataCompra: string;
  notaFiscalCompra: string;
  lojaCompra: string;
  vendedorCompra: string;
  codigoProduto: string;
  referencia: string;
  descricao: string;
  categoria: string;
  imei: string;
  quantidadeCompra: number;
  valorCompra: number;
  tipoTransacao: string;
  naturezaOperacao: string;
  status: string;
  lojaAtual: string;
  quantidadeEstoqueFamilia: number;
  quantidadeVendidaFamilia: number;
  dataVenda: string;
  notaFiscalVenda: string;
  lojaVenda: string;
  serialNoEstoque: boolean;
  serialVendido: boolean;
};

export default function ComprasXVendasModule() {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(today);
  const [rows, setRows] = useState<CompraRow[]>([]);
  const [summary, setSummary] = useState({ totalCompras: 0, emEstoque: 0, vendidos: 0, semLocalizacao: 0, valorComprado: 0 });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [apiInfo, setApiInfo] = useState('');

  const loadData = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const userId = getUserId();
      const { data } = await fetchJsonFromCandidates(
        `/api/compras-x-vendas?userId=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );

      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setSummary(data?.summary || { totalCompras: 0, emEstoque: 0, vendidos: 0, semLocalizacao: 0, valorComprado: 0 });
      setApiInfo(
        `Compras DB: ${data?.info?.comprasDb || '-'} · Vendas IMEI DB: ${data?.info?.localSalesDb || 'não localizado'} · Período: ${data?.info?.periodo?.startDate || '-'} até ${data?.info?.periodo?.endDate || '-'}`
      );
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao carregar Compras x Vendas.');
      setRows([]);
      setSummary({ totalCompras: 0, emEstoque: 0, vendidos: 0, semLocalizacao: 0, valorComprado: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'TODOS' && row.status !== statusFilter) return false;
      if (!term) return true;

      return [
        row.dataCompra,
        row.notaFiscalCompra,
        row.lojaCompra,
        row.vendedorCompra,
        row.codigoProduto,
        row.referencia,
        row.descricao,
        row.categoria,
        row.imei,
        row.status,
        row.lojaAtual,
        row.dataVenda,
        row.notaFiscalVenda,
        row.lojaVenda,
      ].join(' ').toLowerCase().includes(term);
    });
  }, [rows, searchTerm, statusFilter]);

  return (
    <div className="w-full bg-slate-50 min-h-screen">
      <div className="mx-auto max-w-[1800px] px-6 py-6 space-y-5">
        <div className="bg-white rounded-[28px] border border-slate-200 shadow-sm p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h1 className="text-[18px] font-black uppercase tracking-tight text-slate-900">Compras x Vendas</h1>
                  <p className="text-[12px] text-slate-500 mt-1">
                    Conferência por IMEI das compras do período contra estoque atual e base de vendas.
                  </p>
                </div>
              </div>
              {apiInfo && <p className="mt-3 text-[11px] font-black text-emerald-600">{apiInfo}</p>}
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Calendar size={16} className="text-slate-400" />
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm outline-none" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Calendar size={16} className="text-slate-400" />
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm outline-none" />
              </div>
              <button
                onClick={loadData}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 text-white px-5 py-3 text-sm font-black shadow-sm"
              >
                <RefreshCw size={16} />
                Atualizar
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm">{errorMsg}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
          <Card title="Compras IMEI" value={formatNumber(summary.totalCompras)} color="text-slate-900" />
          <Card title="Em estoque" value={formatNumber(summary.emEstoque)} color="text-emerald-600" />
          <Card title="Vendidos" value={formatNumber(summary.vendidos)} color="text-blue-600" />
          <Card title="Sem localização" value={formatNumber(summary.semLocalizacao)} color="text-red-600" />
          <Card title="Valor comprado" value={formatMoney(summary.valorComprado)} color="text-violet-600" />
        </div>

        <div className="bg-white rounded-[28px] border border-slate-200 shadow-sm p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-[16px] font-black uppercase tracking-tight text-slate-900">Conferência detalhada</h2>
              <p className="text-[12px] text-slate-500 mt-1">Uma linha por IMEI comprado no período.</p>
            </div>

            <div className="flex flex-col md:flex-row gap-3 w-full xl:w-auto">
              <div className="relative w-full md:w-[360px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por IMEI, nota, referência, descrição ou loja"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none"
              >
                <option value="TODOS">Todos os status</option>
                <option value="EM ESTOQUE">Em estoque</option>
                <option value="VENDIDO">Vendido</option>
                <option value="SEM LOCALIZAÇÃO">Sem localização</option>
              </select>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
            <div className="max-h-[72vh] overflow-auto overscroll-contain">
              <table className="min-w-[2200px] w-full border-separate border-spacing-0 bg-white table-fixed">
                <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <Th className="sticky left-0 z-30 bg-slate-50 min-w-[140px]">Data compra</Th>
                    <Th className="sticky left-[140px] z-30 bg-slate-50 min-w-[160px]">IMEI</Th>
                    <Th className="min-w-[150px]">NF compra</Th>
                    <Th className="min-w-[150px]">Loja compra</Th>
                    <Th className="min-w-[140px]">Referência</Th>
                    <Th className="min-w-[260px]">Descrição</Th>
                    <Th className="min-w-[120px]">Categoria</Th>
                    <Th className="min-w-[120px] text-right">Valor compra</Th>
                    <Th className="min-w-[120px]">Status</Th>
                    <Th className="min-w-[150px]">Loja atual</Th>
                    <Th className="min-w-[120px] text-right">Estoque ref.</Th>
                    <Th className="min-w-[120px] text-right">Vendas ref.</Th>
                    <Th className="min-w-[130px]">Data venda</Th>
                    <Th className="min-w-[150px]">NF venda</Th>
                    <Th className="min-w-[150px]">Loja venda</Th>
                    <Th className="min-w-[180px]">Natureza</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => (
                    <tr key={`${row.imei}-${idx}`} className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60'}>
                      <Td className="sticky left-0 z-10 bg-inherit whitespace-nowrap">{row.dataCompra || '-'}</Td>
                      <Td className="sticky left-[140px] z-10 bg-inherit font-black whitespace-nowrap">{row.imei || '-'}</Td>
                      <Td className="whitespace-nowrap">{row.notaFiscalCompra || '-'}</Td>
                      <Td className="truncate" title={row.lojaCompra}>{row.lojaCompra || '-'}</Td>
                      <Td className="whitespace-nowrap">{row.referencia || '-'}</Td>
                      <Td className="truncate" title={row.descricao}>{row.descricao || '-'}</Td>
                      <Td>{row.categoria || '-'}</Td>
                      <Td className="text-right whitespace-nowrap">{formatMoney(row.valorCompra)}</Td>
                      <Td>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${row.status === 'EM ESTOQUE' ? 'bg-emerald-100 text-emerald-700' : row.status === 'VENDIDO' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                          {row.status}
                        </span>
                      </Td>
                      <Td className="truncate" title={row.lojaAtual}>{row.lojaAtual || '-'}</Td>
                      <Td className="text-right font-black text-emerald-600">{formatNumber(row.quantidadeEstoqueFamilia)}</Td>
                      <Td className="text-right font-black text-blue-600">{formatNumber(row.quantidadeVendidaFamilia)}</Td>
                      <Td className="whitespace-nowrap">{row.dataVenda || '-'}</Td>
                      <Td className="whitespace-nowrap">{row.notaFiscalVenda || '-'}</Td>
                      <Td className="truncate" title={row.lojaVenda}>{row.lojaVenda || '-'}</Td>
                      <Td className="truncate" title={row.naturezaOperacao}>{row.naturezaOperacao || '-'}</Td>
                    </tr>
                  ))}

                  {!loading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={16} className="px-4 py-16 text-center text-slate-400">
                        Nenhuma compra encontrada no período informado.
                      </td>
                    </tr>
                  )}

                  {loading && (
                    <tr>
                      <td colSpan={16} className="px-4 py-16 text-center text-slate-500">
                        Carregando compras, estoque e vendas...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 bg-white shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</div>
      <div className={`mt-2 text-3xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 text-left border-b border-slate-200 whitespace-nowrap ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-sm text-slate-700 border-b border-slate-100 align-middle ${className}`}>{children}</td>;
}
