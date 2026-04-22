import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  Calendar,
  RefreshCw,
  Search,
  ShieldCheck,
  Download,
  ChevronDown,
  ChevronRight,
  PackageCheck,
  PackageX,
  ShoppingCart,
} from 'lucide-react';

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

type StatusFilter = 'TODOS' | 'EM ESTOQUE' | 'VENDIDO' | 'SEM LOCALIZAÇÃO';

const statusStyleMap: Record<string, string> = {
  'EM ESTOQUE': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'VENDIDO': 'bg-blue-100 text-blue-700 border border-blue-200',
  'SEM LOCALIZAÇÃO': 'bg-red-100 text-red-700 border border-red-200',
};

export default function ComprasXVendasModule() {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(today);
  const [rows, setRows] = useState<CompraRow[]>([]);
  const [summary, setSummary] = useState({
    totalCompras: 0,
    emEstoque: 0,
    vendidos: 0,
    semLocalizacao: 0,
    valorComprado: 0,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [apiInfo, setApiInfo] = useState('');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const userId = getUserId();
      const { data } = await fetchJsonFromCandidates(
        `/api/compras-x-vendas?userId=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );

      const nextRows = Array.isArray(data?.rows) ? data.rows : [];
      setRows(nextRows);
      setSummary(
        data?.summary || {
          totalCompras: 0,
          emEstoque: 0,
          vendidos: 0,
          semLocalizacao: 0,
          valorComprado: 0,
        }
      );
      setExpandedRows({});
      setApiInfo(
        `Compras DB: ${data?.info?.comprasDb || '-'} · ` +
          `Vendas anual RAW: ${data?.info?.annualSalesRawUsed ? data?.info?.annualSalesDb || '-' : 'não usada'} · ` +
          `Fallback local: ${data?.info?.localSalesDb || 'não utilizado'} · ` +
          `Período: ${data?.info?.periodo?.startDate || '-'} até ${data?.info?.periodo?.endDate || '-'}`
      );
    } catch (error: any) {
      setErrorMsg(error?.message || 'Erro ao carregar Compras x Vendas.');
      setRows([]);
      setSummary({
        totalCompras: 0,
        emEstoque: 0,
        vendidos: 0,
        semLocalizacao: 0,
        valorComprado: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return rows.filter((row) => {
      if (statusFilter !== 'TODOS' && row.status !== statusFilter) return false;
      if (!term) return true;

      return [
        row.imei,
        row.referencia,
        row.descricao,
        row.status,
        row.categoria,
        row.lojaAtual,
        row.lojaVenda,
        row.notaFiscalCompra,
        row.notaFiscalVenda,
        row.dataCompra,
        row.dataVenda,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [rows, searchTerm, statusFilter]);

  const statusCounts = useMemo(
    () => ({
      TODOS: rows.length,
      'EM ESTOQUE': rows.filter((r) => r.status === 'EM ESTOQUE').length,
      VENDIDO: rows.filter((r) => r.status === 'VENDIDO').length,
      'SEM LOCALIZAÇÃO': rows.filter((r) => r.status === 'SEM LOCALIZAÇÃO').length,
    }),
    [rows]
  );

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const exportToExcel = () => {
    const exportRows = filteredRows.map((row) => ({
      IMEI: row.imei || '',
      Referência: row.referencia || '',
      Descrição: row.descricao || '',
      Status: row.status || '',
      'Data da compra': row.dataCompra || '',
      'NF compra': row.notaFiscalCompra || '',
      'Loja compra': row.lojaCompra || '',
      'Vendedor compra': row.vendedorCompra || '',
      Categoria: row.categoria || '',
      'Valor da compra': Number(row.valorCompra || 0),
      'Tipo transação': row.tipoTransacao || '',
      Natureza: row.naturezaOperacao || '',
      'Loja atual': row.lojaAtual || '',
      'Data da venda': row.dataVenda || '',
      'NF venda': row.notaFiscalVenda || '',
      'Loja venda': row.lojaVenda || '',
      'Estoque referência': Number(row.quantidadeEstoqueFamilia || 0),
      'Vendas referência': Number(row.quantidadeVendidaFamilia || 0),
      'Serial no estoque': row.serialNoEstoque ? 'SIM' : 'NÃO',
      'Serial vendido': row.serialVendido ? 'SIM' : 'NÃO',
      'Quantidade compra': Number(row.quantidadeCompra || 0),
      'Código produto': row.codigoProduto || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Compras x Vendas');

    worksheet['!cols'] = [
      { wch: 20 }, { wch: 14 }, { wch: 35 }, { wch: 18 }, { wch: 14 },
      { wch: 14 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 16 },
      { wch: 18 }, { wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 14 },
      { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    ];

    const fileName = `compras_x_vendas_${startDate}_ate_${endDate}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="w-full bg-slate-50 min-h-screen">
      <div className="mx-auto max-w-[1650px] px-6 py-6 space-y-5">
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
              {apiInfo && <p className="mt-3 text-[11px] font-black text-emerald-600 break-all">{apiInfo}</p>}
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Calendar size={16} className="text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-sm outline-none"
                />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Calendar size={16} className="text-slate-400" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-sm outline-none"
                />
              </div>
              <button
                onClick={exportToExcel}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-5 py-3 text-sm font-black shadow-sm"
              >
                <Download size={16} />
                Exportar XLSX
              </button>
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-[16px] font-black uppercase tracking-tight text-slate-900">Conferência detalhada</h2>
                <p className="text-[12px] text-slate-500 mt-1">
                  Clique em um item para ver os detalhes da compra, estoque e venda.
                </p>
              </div>

              <div className="w-full xl:w-auto">
                <div className="relative w-full xl:w-[420px]">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por IMEI, referência, descrição ou status"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none focus:border-slate-400"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <StatusButton
                label="Todos"
                value="TODOS"
                active={statusFilter === 'TODOS'}
                count={statusCounts.TODOS}
                onClick={() => setStatusFilter('TODOS')}
              />
              <StatusButton
                label="Em estoque"
                value="EM ESTOQUE"
                active={statusFilter === 'EM ESTOQUE'}
                count={statusCounts['EM ESTOQUE']}
                onClick={() => setStatusFilter('EM ESTOQUE')}
                icon={<PackageCheck size={14} />}
              />
              <StatusButton
                label="Vendido"
                value="VENDIDO"
                active={statusFilter === 'VENDIDO'}
                count={statusCounts.VENDIDO}
                onClick={() => setStatusFilter('VENDIDO')}
                icon={<ShoppingCart size={14} />}
              />
              <StatusButton
                label="Sem localização"
                value="SEM LOCALIZAÇÃO"
                active={statusFilter === 'SEM LOCALIZAÇÃO'}
                count={statusCounts['SEM LOCALIZAÇÃO']}
                onClick={() => setStatusFilter('SEM LOCALIZAÇÃO')}
                icon={<PackageX size={14} />}
              />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
            <div className="max-h-[72vh] overflow-auto overscroll-contain">
              <table className="min-w-[900px] w-full border-separate border-spacing-0 bg-white table-fixed">
                <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <Th className="w-[56px]"></Th>
                    <Th className="min-w-[220px]">IMEI</Th>
                    <Th className="min-w-[150px]">Referência</Th>
                    <Th className="min-w-[420px]">Descrição</Th>
                    <Th className="min-w-[180px]">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => {
                    const rowKey = `${row.imei}-${idx}`;
                    const expanded = !!expandedRows[rowKey];

                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          onClick={() => toggleRow(rowKey)}
                          className={`cursor-pointer ${
                            idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60'
                          }`}
                        >
                          <Td className="w-[56px] text-slate-400">
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </Td>
                          <Td className="font-black whitespace-nowrap">{row.imei || '-'}</Td>
                          <Td className="whitespace-nowrap">{row.referencia || '-'}</Td>
                          <Td className="truncate" title={row.descricao}>
                            {row.descricao || '-'}
                          </Td>
                          <Td>
                            <StatusPill status={row.status} />
                          </Td>
                        </tr>

                        {expanded && (
                          <tr className={idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'}>
                            <td colSpan={5} className="px-5 py-5 border-b border-slate-200">
                              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                  <DetailItem label="Data da compra" value={row.dataCompra || '-'} />
                                  <DetailItem label="Data da venda" value={row.dataVenda || '-'} />
                                  <DetailItem label="Categoria" value={row.categoria || '-'} />
                                  <DetailItem label="Valor da compra" value={formatMoney(row.valorCompra)} />
                                  <DetailItem label="Loja atual" value={row.lojaAtual || '-'} />
                                  <DetailItem label="NF compra" value={row.notaFiscalCompra || '-'} />
                                  <DetailItem label="NF venda" value={row.notaFiscalVenda || '-'} />
                                  <DetailItem label="Loja venda" value={row.lojaVenda || '-'} />
                                  <DetailItem label="Loja compra" value={row.lojaCompra || '-'} />
                                  <DetailItem label="Vendedor compra" value={row.vendedorCompra || '-'} />
                                  <DetailItem label="Estoque da referência" value={formatNumber(row.quantidadeEstoqueFamilia)} />
                                  <DetailItem label="Vendas da referência" value={formatNumber(row.quantidadeVendidaFamilia)} />
                                  <DetailItem label="Tipo transação" value={row.tipoTransacao || '-'} />
                                  <DetailItem label="Natureza operação" value={row.naturezaOperacao || '-'} />
                                  <DetailItem label="Código produto" value={row.codigoProduto || '-'} />
                                  <DetailItem label="Quantidade compra" value={formatNumber(row.quantidadeCompra)} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {!loading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-16 text-center text-slate-400">
                        Nenhuma compra encontrada no período informado.
                      </td>
                    </tr>
                  )}

                  {loading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-16 text-center text-slate-500">
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
  return (
    <th
      className={`px-3 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 text-left border-b border-slate-200 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 text-sm text-slate-700 border-b border-slate-100 align-middle ${className}`}>{children}</td>;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 min-h-[76px]">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-bold text-slate-800 break-words">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${statusStyleMap[status] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
      {status}
    </span>
  );
}

function StatusButton({
  label,
  active,
  count,
  onClick,
  icon,
}: {
  label: string;
  value: StatusFilter;
  active: boolean;
  count: number;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black border transition-all ${
        active
          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-white/15 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
        {formatNumber(count)}
      </span>
    </button>
  );
}
