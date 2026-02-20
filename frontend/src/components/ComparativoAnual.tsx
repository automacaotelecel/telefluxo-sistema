import React, { useEffect, useState, useMemo, useRef } from 'react';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell, LabelList, Legend
} from 'recharts';
import { 
  Calendar, Store, AlertCircle, ChevronDown, CheckSquare, Square, Filter, Layers, ArrowUpRight, ArrowDownRight, Activity, LayoutGrid
} from 'lucide-react';

const STORE_MAP: Record<string, string> = {
    "12309173001309": "ARAGUAIA SHOPPING", "12309173000418": "BOULEVARD SHOPPING",
    "12309173000175": "BRASILIA SHOPPING", "12309173000680": "CONJUNTO NACIONAL",
    "12309173001228": "CONJUNTO NACIONAL QUIOSQUE", "12309173000507": "GOIANIA SHOPPING",
    "12309173000256": "IGUATEMI SHOPPING", "12309173000841": "JK SHOPPING",
    "12309173000337": "PARK SHOPPING", "12309173000922": "PATIO BRASIL",
    "12309173000760": "TAGUATINGA SHOPPING", "12309173001147": "TERRAÇO SHOPPING",
    "12309173001651": "TAGUATINGA SHOPPING QQ", "12309173001732": "UBERLÂNDIA SHOPPING",
    "12309173001813": "UBERABA SHOPPING", "12309173001570": "FLAMBOYANT SHOPPING",
    "12309173002119": "BURITI SHOPPING", "12309173002461": "PASSEIO DAS AGUAS",
    "12309173002038": "PORTAL SHOPPING", "12309173002208": "SHOPPING SUL",
    "12309173001902": "BURITI RIO VERDE", "12309173002380": "PARK ANAPOLIS",
    "12309173002542": "SHOPPING RECIFE", "12309173002895": "MANAIRA SHOPPING",
    "12309173002976": "IGUATEMI FORTALEZA", "12309173001066": "CD TAGUATINGA"
};

const getStoreName = (raw: string) => {
    if (!raw) return "N/D";
    const clean = raw.replace(/\D/g, ''); 
    return STORE_MAP[clean] || STORE_MAP[raw] || raw;
};

const formatMoneyShort = (val: number) => {
    if (!val) return 'R$ 0';
    if (val >= 1000000) return `R$ ${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
    return `R$ ${val.toFixed(0)}`;
}

const formatMoney = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

export default function ComparativoAnual() {
  const [annualRawData, setAnnualRawData] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);
  const [categoryFilter, setCategoryFilter] = useState('TODAS');

  const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : 'https://telefluxo-aplicacao.onrender.com';

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target)) setIsStoreMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = async () => {
    setLoading(true);
    let userId = '';
    try {
        const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
        if (rawUser) userId = JSON.parse(rawUser).id || JSON.parse(rawUser).userId || '';
    } catch (e) { console.error(e); }

    try {
        const resAnnual = await fetch(`${API_URL}/sales_anuais?userId=${userId}`);
        if (resAnnual.ok) {
            const dataAnnual = await resAnnual.json();
            setAnnualRawData(dataAnnual.sales || (Array.isArray(dataAnnual) ? dataAnnual : []));
            setErrorMsg('');
        } else {
            setErrorMsg("Rota de histórico anual não encontrada no servidor.");
        }
    } catch (err: any) { 
        setErrorMsg("Erro ao carregar dados anuais. Verifique se o servidor está rodando.");
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const uniqueCategories = useMemo(() => {
      const cats = new Set(annualRawData.map(r => (r.categoria || r.grupo || r.familia || 'OUTROS').toUpperCase()));
      return Array.from(cats).sort();
  }, [annualRawData]);

  const uniqueStores = useMemo(() => {
      const stores = new Set(annualRawData.map(r => getStoreName(r.cnpj_empresa || r.loja)).filter(Boolean));
      return Array.from(stores).sort();
  }, [annualRawData]);

  const toggleStore = (store: string) => {
    if (selectedStores.includes(store)) setSelectedStores(selectedStores.filter(s => s !== store));
    else setSelectedStores([...selectedStores, store]);
  };

  // --- MOTOR DE COMPARAÇÃO ---
  const annualComparison = useMemo(() => {
      const validSales = annualRawData.filter(sale => {
          if (selectedStores.length > 0) {
              const storeName = getStoreName(sale.cnpj_empresa || sale.loja);
              if (!selectedStores.includes(storeName)) return false;
          }
          if (categoryFilter !== 'TODAS') {
              const cat = (sale.categoria || sale.grupo || sale.familia || 'OUTROS').toUpperCase();
              if (cat !== categoryFilter) return false;
          }
          return true;
      });

      const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const monthlyData: Record<string, any> = {};
      
      mesesNomes.forEach((m, i) => {
          const mesNum = String(i + 1).padStart(2, '0');
          monthlyData[mesNum] = { mes: m, mesNum };
      });

      const yearsSet = new Set<string>();

      validSales.forEach(sale => {
          const dataVenda = sale.data_emissao || "";
          let ano = "", mes = "";
          
          if (dataVenda.includes('-')) {
              [ano, mes] = dataVenda.substring(0, 7).split('-'); 
          } else if (dataVenda.includes('/')) {
              const parts = dataVenda.split('/');
              if(parts.length === 3) { ano = parts[2]; mes = parts[1]; }
          }

          if (ano && mes && monthlyData[mes]) {
              if(Number(ano) > 2020) {
                  yearsSet.add(ano);
                  if (!monthlyData[mes][ano]) monthlyData[mes][ano] = 0;
                  monthlyData[mes][ano] += Number(sale.total_liquido || 0);
              }
          }
      });

      const years = Array.from(yearsSet).sort();
      const currentYear = years.length > 0 ? years[years.length - 1] : new Date().getFullYear().toString();
      const previousYear = years.length > 1 ? years[years.length - 2] : (Number(currentYear) - 1).toString();

      let totalCurrent = 0;
      let totalPrev = 0;
      
      const chartData = Object.values(monthlyData).map(d => {
          const valCurrent = d[currentYear] || 0;
          const valPrev = d[previousYear] || 0;
          
          totalCurrent += valCurrent;
          totalPrev += valPrev;

          return {
              ...d,
              [currentYear]: valCurrent,
              [previousYear]: valPrev,
              variacao: valPrev > 0 ? ((valCurrent - valPrev) / valPrev) * 100 : 0
          };
      }).sort((a, b) => Number(a.mesNum) - Number(b.mesNum)); 

      const totalVariacao = totalPrev > 0 ? ((totalCurrent - totalPrev) / totalPrev) * 100 : 0;

      return { chartData, years, currentYear, previousYear, totalCurrent, totalPrev, totalVariacao };
  }, [annualRawData, selectedStores, categoryFilter]);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-[#F0F2F5] font-sans text-slate-800">
      
      {errorMsg && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative flex items-center gap-2">
            <AlertCircle size={20} />
            <span className="block sm:inline">{errorMsg}</span>
        </div>
      )}

      {/* HEADER E FILTROS */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
            <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-[#1428A0] rounded text-white"><Activity size={18} /></div>
                <h1 className="text-lg font-black uppercase tracking-tight text-[#1428A0]">Comparativo Anual (YoY)</h1>
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-10">Histórico Macro de Vendas</p>
        </div>

        <div className="flex flex-wrap gap-3 items-center w-full xl:w-auto">
            <div className="flex items-center bg-white border border-slate-200 px-3 py-2 rounded-lg gap-2 shadow-sm">
                <Layers size={14} className="text-blue-600"/>
                <select 
                    value={categoryFilter} 
                    onChange={e => setCategoryFilter(e.target.value)} 
                    className="bg-transparent text-xs font-bold text-slate-600 uppercase outline-none cursor-pointer w-full md:w-auto max-w-[150px] truncate"
                >
                    <option value="TODAS">Todas Categorias</option>
                    {uniqueCategories.map(c => <option key={c as string} value={c as string}>{c as string}</option>)}
                </select>
            </div>

            <div className="relative" ref={storeMenuRef}>
                <button 
                    onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
                    className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors min-w-[160px] justify-between shadow-sm"
                >
                    <div className="flex items-center gap-2">
                        <Store size={14} className="text-blue-600"/>
                        <span className="truncate max-w-[120px] uppercase">
                            {selectedStores.length === 0 ? "Todas Lojas" : 
                             selectedStores.length === 1 ? selectedStores[0] : 
                             `${selectedStores.length} Lojas`}
                        </span>
                    </div>
                    <ChevronDown size={14} className="text-slate-400"/>
                </button>

                {isStoreMenuOpen && (
                    <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 p-2 max-h-80 overflow-y-auto">
                        <div onClick={() => setSelectedStores([])} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer border-b border-slate-50 mb-1">
                            {selectedStores.length === 0 ? <CheckSquare size={16} className="text-blue-600"/> : <Square size={16} className="text-slate-300"/>}
                            <span className="text-xs font-bold text-slate-700 uppercase">Todas as Lojas</span>
                        </div>
                        {uniqueStores.map((store: string) => (
                            <div key={store} onClick={() => toggleStore(store)} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg cursor-pointer">
                                {selectedStores.includes(store) ? <CheckSquare size={16} className="text-blue-600"/> : <Square size={16} className="text-slate-300"/>}
                                <span className="text-xs font-bold text-slate-600 uppercase truncate">{store}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <button onClick={loadData} disabled={loading} className="bg-[#1428A0] hover:bg-blue-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md shadow-blue-900/10 flex items-center gap-2 disabled:opacity-50">
                <Filter size={14}/> {loading ? 'Carregando...' : 'Atualizar'}
            </button>
        </div>
      </div>

      {annualComparison.years.length < 2 && !loading && !errorMsg && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 p-4 rounded-xl flex items-center gap-3 mb-6">
              <AlertCircle size={20} />
              <span className="text-sm font-bold">O sistema detectou apenas {annualComparison.years.length} ano de dados ou a base histórica está vazia. Rode o integrador de histórico anual.</span>
          </div>
      )}

      {/* CARDS DE RESUMO */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Ano Atual ({annualComparison.currentYear})</span>
                  <Calendar size={16} className="text-indigo-600"/>
              </div>
              <h3 className="text-3xl font-black text-indigo-900 mt-1">
                  {formatMoney(annualComparison.totalCurrent)}
              </h3>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Ano Anterior ({annualComparison.previousYear})</span>
                  <Calendar size={16} className="text-slate-400"/>
              </div>
              <h3 className="text-3xl font-black text-slate-600 mt-1">
                  {formatMoney(annualComparison.totalPrev)}
              </h3>
          </div>

          <div className={`p-5 rounded-2xl border shadow-sm ${annualComparison.totalVariacao >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex justify-between items-start mb-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest ${annualComparison.totalVariacao >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      Crescimento (YoY)
                  </span>
                  {annualComparison.totalVariacao >= 0 ? <ArrowUpRight size={16} className="text-emerald-600"/> : <ArrowDownRight size={16} className="text-red-600"/>}
              </div>
              <h3 className={`text-3xl font-black mt-1 ${annualComparison.totalVariacao >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {annualComparison.totalVariacao > 0 ? '+' : ''}{annualComparison.totalVariacao.toFixed(2)}%
              </h3>
          </div>
      </div>

      {/* GRÁFICO */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px] mb-6">
          <div className="flex items-center gap-2 mb-6">
              <Activity size={16} className="text-indigo-600"/>
              <h3 className="font-black text-slate-700 uppercase text-xs">Desempenho Mensal: {annualComparison.currentYear} vs {annualComparison.previousYear}</h3>
          </div>
          <div className="h-full pb-8">
              <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={annualComparison.chartData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                      <XAxis dataKey="mes" tick={{fontSize: 12, fontWeight: 'bold', fill: '#64748b'}} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff'}} formatter={(val: number) => [formatMoney(val), 'Faturamento']} />
                      <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }}/>
                      
                      <Bar dataKey={annualComparison.previousYear} fill="#cbd5e1" radius={[4, 4, 0, 0]} name={`Ano ${annualComparison.previousYear}`}>
                          <LabelList dataKey={annualComparison.previousYear} position="top" formatter={(val: number) => val > 0 ? formatMoneyShort(val) : ''} style={{ fontSize: '9px', fill: '#94a3b8', fontWeight: 'bold' }} />
                      </Bar>
                      
                      <Bar dataKey={annualComparison.currentYear} fill="#1428A0" radius={[4, 4, 0, 0]} name={`Ano ${annualComparison.currentYear}`}>
                          <LabelList dataKey={annualComparison.currentYear} position="top" formatter={(val: number) => val > 0 ? formatMoneyShort(val) : ''} style={{ fontSize: '10px', fill: '#1428A0', fontWeight: '900' }} />
                      </Bar>
                  </BarChart>
              </ResponsiveContainer>
          </div>
      </div>

      {/* TABELA DRE MENSAL */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-700 uppercase flex items-center gap-2 text-xs"><LayoutGrid size={16} className="text-indigo-600"/> Resumo Mensal</h3>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                  <thead>
                      <tr className="text-[10px] font-black text-slate-400 uppercase bg-white border-b border-slate-200">
                          <th className="p-4">Mês</th>
                          <th className="p-4 text-right">Faturamento {annualComparison.previousYear}</th>
                          <th className="p-4 text-right text-[#1428A0]">Faturamento {annualComparison.currentYear}</th>
                          <th className="p-4 text-right">Variação (%)</th>
                      </tr>
                  </thead>
                  <tbody className="text-sm font-bold text-slate-600 divide-y divide-slate-50">
                      {annualComparison.chartData.filter(d => d[annualComparison.currentYear] > 0 || d[annualComparison.previousYear] > 0).map((row: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                              <td className="p-4 uppercase">{row.mes}</td>
                              <td className="p-4 text-right text-slate-400">{formatMoney(row[annualComparison.previousYear])}</td>
                              <td className="p-4 text-right text-[#1428A0] font-black">{formatMoney(row[annualComparison.currentYear])}</td>
                              <td className={`p-4 text-right ${row.variacao >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  <div className="flex items-center justify-end gap-1">
                                      {row.variacao > 0 ? '+' : ''}{row.variacao.toFixed(1)}%
                                      {row.variacao >= 0 ? <TrendingUp size={12}/> : <ArrowDownRight size={12}/>}
                                  </div>
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      </div>

    </div>
  );
}