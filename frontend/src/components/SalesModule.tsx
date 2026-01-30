import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, Search, Store, Award, RefreshCw, 
  Calendar, DollarSign, ShoppingBag, LayoutDashboard, 
  MapPin, ArrowUpRight, XCircle, MousePointerClick,
  Users, TrendingDown, Filter, Package, Tag, AlertCircle 
} from 'lucide-react';

export default function SalesModule() {
  // --- ESTADOS ---
  const [activeTab, setActiveTab] = useState<'GERAL' | 'VENDEDORES' | 'PRODUTOS'>('GERAL'); 
  const [sales, setSales] = useState<any[]>([]);
  const [sellersKpi, setSellersKpi] = useState<any[]>([]); 
  const [stock, setStock] = useState<any[]>([]); 
  const [loading, setLoading] = useState(false);
  
  // FILTROS GERAIS
  const [filter, setFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // FILTROS ESPECÍFICOS
  const [storeFilter, setStoreFilter] = useState('TODAS');
  const [familyFilter, setFamilyFilter] = useState('TODOS');
  const [regionFilter, setRegionFilter] = useState('TODAS')

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // --- 🔒 SEGURANÇA: PEGAR USUÁRIO LOGADO E SUAS LOJAS ---
  const user = JSON.parse(localStorage.getItem('telefluxo_user') || '{}');
  const userRole = user.role || 'LOJA';
  
  // Quem vê tudo? (CEO, DIRETOR ou ADMIN)
  const isMasterUser = ['CEO', 'DIRETOR'].includes(userRole) || user.isAdmin;

  // Transforma a string "Loja A,Loja B" do banco em Array real
  const allowedStores = useMemo(() => {
    if (isMasterUser) return []; // Master não precisa de lista, vê tudo
    if (!user.allowedStores) return [];
    return String(user.allowedStores).split(',').map(s => s.trim().toUpperCase());
  }, [user, isMasterUser]);
  // --------------------------------------------------------
  
  // --- FETCH DATA (COM FILTRO DE USUÁRIO) ---
  const fetchData = async () => {
    setLoading(true);
    try {
      // Pega o ID do usuário para o servidor filtrar
      const userId = user.id || ''; 
      
      // 1. Vendas (Envia userId)
      const res = await fetch(`${API_URL}/sales?userId=${userId}`);
      const data = await res.json();
      setSales(Array.isArray(data) ? data : []);

      // 2. KPI Vendedores (Envia userId)
      const resSellers = await fetch(`${API_URL}/sellers-kpi?userId=${userId}`);
      const dataSellers = await resSellers.json();
      setSellersKpi(Array.isArray(dataSellers) ? dataSellers : []);

      // 3. Estoque (Geralmente estoque é global, mas se quiser filtrar, adicione userId aqui também)
      const resStock = await fetch(`${API_URL}/stock`);
      if (resStock.ok) {
          const dataStock = await resStock.json();
          setStock(Array.isArray(dataStock) ? dataStock : []);
      }

    } catch (e) { console.error("Erro API:", e); }
    finally { setLoading(false); }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await fetch(`${API_URL}/sales/refresh`, { method: 'POST' });
      setTimeout(fetchData, 4000);
    } catch (e) { alert("Comando enviado."); }
  };

  useEffect(() => { fetchData(); }, []);

  // --- PREPARAÇÃO DE DADOS (VISÃO GERAL) ---
  
  // 1. Lista de Famílias para o botão superior
  const uniqueFamilies = useMemo(() => {
    if (!Array.isArray(sales)) return ['TODOS'];
    const fams = new Set(sales.map(s => String(s.FAMILIA || 'OUTROS').trim().toUpperCase()));
    return ['TODOS', ...Array.from(fams).sort()];
  }, [sales]);

  // 2. Lista de Regiões para o Dropdown (Baseado nas vendas gerais)
  const uniqueRegionsGeneral = useMemo(() => {
    if (!Array.isArray(sales)) return ['TODAS'];
    const regs = new Set(sales.map(s => String(s.REGIAO || 'GERAL').trim().toUpperCase()));
    return ['TODAS', ...Array.from(regs).sort()];
  }, [sales]);

  // 3. Filtragem Principal da Visão Geral (AGORA COM REGIÃO)
  const filteredSales = useMemo(() => {
    if (!Array.isArray(sales)) return [];
    return sales.filter(s => {
      // Filtro de Loja
      const lojaItem = String(s.CNPJ_EMPRESA || '').trim().toUpperCase();
      const matchesStore = storeFilter === 'TODAS' || lojaItem === storeFilter.toUpperCase();
      
      // Filtro de Família
      const familiaItem = String(s.FAMILIA || 'OUTROS').trim().toUpperCase();
      const matchesFamily = familyFilter === 'TODOS' || familiaItem === familyFilter;
      
      // Filtro de Região (NOVO NA VISÃO GERAL)
      const regiaoItem = String(s.REGIAO || 'GERAL').trim().toUpperCase();
      const matchesRegion = regionFilter === 'TODAS' || regiaoItem === regionFilter.toUpperCase();

      // Filtro de Texto
      const term = filter.toLowerCase();
      const matchesSearch = String(s.NOME_VENDEDOR || '').toLowerCase().includes(term) || 
                            String(s.DESCRICAO || '').toLowerCase().includes(term);

      // Filtro de Data
      let matchesDate = true;
      if (startDate || endDate) {
          const [d, m, y] = (s.DATA_EMISSAO || '').split('/');
          const saleDateISO = `${y}-${m}-${d}`; 
          if (startDate && saleDateISO < startDate) matchesDate = false;
          if (endDate && saleDateISO > endDate) matchesDate = false;
      }
      return matchesStore && matchesSearch && matchesFamily && matchesDate && matchesRegion;
    });
  }, [sales, filter, storeFilter, familyFilter, startDate, endDate, regionFilter]);

  // 4. Cálculos de KPI baseados nos dados filtrados
  const kpis = useMemo(() => {
    const total = filteredSales.reduce((acc, curr) => acc + Number(curr.TOTAL_LIQUIDO || 0), 0);
    const qtd = filteredSales.reduce((acc, curr) => acc + Number(curr.QUANTIDADE || 0), 0);
    const ticket = qtd > 0 ? total / qtd : 0;
    
    const hoje = new Date();
    const diaAtual = hoje.getDate();
    const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const isFilteredByDate = startDate || endDate;
    const projecao = isFilteredByDate ? total : (diaAtual > 0 ? (total / diaAtual) * ultimoDiaMes : 0);
    
    const rankingVend: Record<string, number> = {};
    filteredSales.forEach(s => {
        const nome = s.NOME_VENDEDOR || 'N/D';
        rankingVend[nome] = (rankingVend[nome] || 0) + Number(s.TOTAL_LIQUIDO || 0);
    });
    const topVendedor = Object.entries(rankingVend).sort((a,b) => b[1] - a[1])[0];

    return { total, qtd, ticket, projecao, topVendedor };
  }, [filteredSales, startDate, endDate]);

  const sellerRanking = useMemo(() => {
    const map: Record<string, number> = {};
    filteredSales.forEach(s => {
      map[s.NOME_VENDEDOR || 'N/D'] = (map[s.NOME_VENDEDOR || 'N/D'] || 0) + Number(s.TOTAL_LIQUIDO || 0);
    });
    return Object.entries(map).sort((a,b) => b[1] - a[1]);
  }, [filteredSales]);

  const storeRanking = useMemo(() => {
    const map: Record<string, number> = {};
    // Para o ranking de lojas, aplicamos todos os filtros MENOS o de loja
    const relevantData = Array.isArray(sales) ? sales.filter(s => {
        const familiaItem = String(s.FAMILIA || 'OUTROS').trim().toUpperCase();
        const matchesFamily = familyFilter === 'TODOS' || familiaItem === familyFilter;
        
        const regiaoItem = String(s.REGIAO || 'GERAL').trim().toUpperCase();
        const matchesRegion = regionFilter === 'TODAS' || regiaoItem === regionFilter.toUpperCase();

        let matchesDate = true;
        if (startDate || endDate) {
            const [d, m, y] = (s.DATA_EMISSAO || '').split('/');
            const saleDateISO = `${y}-${m}-${d}`; 
            if (startDate && saleDateISO < startDate) matchesDate = false;
            if (endDate && saleDateISO > endDate) matchesDate = false;
        }
        return matchesFamily && matchesDate && matchesRegion;
    }) : [];

    relevantData.forEach(s => {
      map[s.CNPJ_EMPRESA || 'N/D'] = (map[s.CNPJ_EMPRESA || 'N/D'] || 0) + Number(s.TOTAL_LIQUIDO || 0);
    });
    return Object.entries(map).sort((a,b) => b[1] - a[1]);
  }, [sales, familyFilter, startDate, endDate, regionFilter]); 

  const regionRanking = useMemo(() => {
    const map: Record<string, number> = {};
    filteredSales.forEach(s => {
      const reg = s.REGIAO || 'GERAL';
      map[reg] = (map[reg] || 0) + Number(s.TOTAL_LIQUIDO || 0);
    });
    return Object.entries(map).sort((a,b) => b[1] - a[1]);
  }, [filteredSales]);


  // --- PREPARAÇÃO DE DADOS (VISÃO VENDEDORES DETALHADA) ---
  const uniqueStores = useMemo(() => {
    if (!Array.isArray(sellersKpi)) return ['TODAS'];
    const stores = new Set(sellersKpi.map(s => String(s.LOJA || '').trim().toUpperCase()).filter(s => s !== ''));
    return ['TODAS', ...Array.from(stores).sort()];
  }, [sellersKpi]);

  const uniqueRegions = useMemo(() => {
    if (!Array.isArray(sellersKpi)) return ['TODAS'];
    const regions = new Set(sellersKpi.map(s => String(s.REGIAO || '').trim().toUpperCase()).filter(s => s !== ''));
    return ['TODAS', ...Array.from(regions).sort()];
  }, [sellersKpi]);

  const filteredSellersKpi = useMemo(() => {
    if (!Array.isArray(sellersKpi)) return [];
    return sellersKpi.filter(s => {
        const term = filter.toLowerCase();
        const matchesSearch = String(s.VENDEDOR || '').toLowerCase().includes(term) || 
                              String(s.LOJA || '').toLowerCase().includes(term);
        
        const matchesStore = storeFilter === 'TODAS' || String(s.LOJA || '').toUpperCase() === storeFilter.toUpperCase();
        const matchesRegion = regionFilter === 'TODAS' || String(s.REGIAO || '').toUpperCase() === regionFilter.toUpperCase();
        
        return matchesSearch && matchesStore && matchesRegion;
    });
  }, [sellersKpi, filter, storeFilter, regionFilter]);


  // =================================================================================
  // ⚡ LÓGICA: RANKING DE PRODUTOS + SOMA TOTAL DE ESTOQUE
  // =================================================================================
  const productRanking = useMemo(() => {
    if (filteredSales.length === 0) return [];

    const agg: Record<string, { desc: string, qtd: number, total: number, familia: string }> = {};

    filteredSales.forEach(s => {
        const key = String(s.DESCRICAO || 'ND').trim();
        if (!agg[key]) {
            agg[key] = { 
                desc: key, 
                qtd: 0, 
                total: 0,
                familia: s.FAMILIA || 'OUTROS'
            };
        }
        agg[key].qtd += Number(s.QUANTIDADE || 0);
        agg[key].total += Number(s.TOTAL_LIQUIDO || 0);
    });

    let ranking = Object.values(agg).sort((a, b) => b.qtd - a.qtd);

    return ranking.map(prod => {
        const matchingStock = stock.filter(st => 
            String(st.description || '').trim().toUpperCase() === prod.desc.toUpperCase()
        );

        const totalEstoque = matchingStock.length > 0 
            ? matchingStock.reduce((acc, item) => acc + Number(item.quantity || 0), 0) 
            : 'N/D';

        return {
            ...prod,
            estoqueAtual: totalEstoque
        };
    });
  }, [filteredSales, stock]);


  return (
    // 📱 LAYOUT RESPONSIVO: p-2 no mobile, p-4 no PC
    <div className="flex-1 p-2 md:p-4 bg-[#F8FAFC] min-h-screen font-sans text-slate-800 w-full overflow-x-hidden">
      <div className="max-w-[1800px] mx-auto space-y-3 md:space-y-4">
        
        {/* === HEADER COM NAVEGAÇÃO === */}
        <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="flex flex-col xl:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="p-2 bg-blue-600 rounded-lg text-white shadow-md">
                        <LayoutDashboard size={20} />
                    </div>
                    <div>
                        <h1 className="text-base md:text-lg font-black uppercase tracking-tight text-slate-800">
                            Performance Comercial
                        </h1>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                             Samsung • Bi Automático
                        </p>
                    </div>
                </div>

                {/* BOTÕES DE NAVEGAÇÃO: SCROLL HORIZONTAL NO MOBILE */}
                <div className="flex bg-slate-100 p-1 rounded-lg overflow-x-auto w-full md:w-auto custom-scrollbar no-scrollbar">
                    <button 
                        onClick={() => { setActiveTab('GERAL'); setStoreFilter('TODAS'); setRegionFilter('TODAS'); setFilter(''); }}
                        className={`px-3 md:px-4 py-2 rounded-md text-[10px] md:text-xs font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap flex-shrink-0 ${activeTab === 'GERAL' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <TrendingUp size={14}/> Visão Geral
                    </button>
                    <button 
                        onClick={() => { setActiveTab('VENDEDORES'); setStoreFilter('TODAS'); setRegionFilter('TODAS'); setFilter(''); }}
                        className={`px-3 md:px-4 py-2 rounded-md text-[10px] md:text-xs font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap flex-shrink-0 ${activeTab === 'VENDEDORES' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <Users size={14}/> Vendedores
                    </button>
                    <button 
                        onClick={() => { setActiveTab('PRODUTOS'); setStoreFilter('TODAS'); setRegionFilter('TODAS'); setFilter(''); }}
                        className={`px-3 md:px-4 py-2 rounded-md text-[10px] md:text-xs font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap flex-shrink-0 ${activeTab === 'PRODUTOS' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        <Package size={14}/> Estoque
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                    <button 
                        onClick={handleRefresh} 
                        disabled={loading}
                        className="w-full md:w-auto bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg font-bold text-[10px] uppercase flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md"
                    >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                        {loading ? '...' : 'Atualizar Dados'}
                    </button>
                </div>
            </div>
        </div>

        {/* ================= CONTEÚDO 1: VISÃO GERAL ================= */}
        {activeTab === 'GERAL' && (
            <>
                {/* BARRA DE FILTROS GERAL */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 mb-4">
                      <div className="flex flex-wrap gap-1.5 items-center w-full">
                        {/* Familias: Scroll Horizontal */}
                        <div className="flex overflow-x-auto gap-1.5 pb-1 w-full md:w-auto custom-scrollbar no-scrollbar">
                            {uniqueFamilies.map(fam => (
                                <button
                                    key={fam}
                                    onClick={() => setFamilyFilter(fam)}
                                    className={`px-3 py-1 rounded-full text-[9px] font-black uppercase transition-all border whitespace-nowrap flex-shrink-0 ${
                                        familyFilter === fam 
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-500'
                                    }`}
                                >
                                    {fam}
                                </button>
                            ))}
                        </div>
                      </div>
                      
                      {/* Filtros em Stack no Mobile */}
                      <div className="flex items-center justify-between w-full md:w-auto gap-2">
                        <div className="relative group border border-slate-200 rounded-lg pl-2 flex-1 md:flex-none">
                             <div className="absolute left-2 top-1.5 text-slate-400"><MapPin size={12}/></div>
                             <select 
                                value={regionFilter} 
                                onChange={(e) => setRegionFilter(e.target.value)}
                                className="pl-6 pr-2 py-1 bg-slate-50 rounded-lg text-[10px] font-bold uppercase text-slate-600 outline-none w-full md:min-w-[120px]"
                             >
                                {uniqueRegionsGeneral.map(reg => (
                                    <option key={reg} value={reg}>{reg}</option>
                                ))}
                             </select>
                        </div>

                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-2 py-1.5 rounded-lg flex-1 md:flex-none justify-center">
                            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-[10px] font-bold uppercase text-slate-600 outline-none w-20"/>
                            <span className="text-slate-300 font-bold">-</span>
                            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-[10px] font-bold uppercase text-slate-600 outline-none w-20"/>
                            {(startDate || endDate) && (
                                <button onClick={() => { setStartDate(''); setEndDate(''); }} className="text-red-400 hover:text-red-600 ml-1">
                                    <XCircle size={14} />
                                </button>
                            )}
                        </div>
                      </div>
                </div>

                {/* KPI CARDS: 2 COLUNAS NO MOBILE (Antes era 1) */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                    <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-1">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Realizado</p>
                            <div className="p-1 bg-green-50 text-green-600 rounded"><DollarSign size={14}/></div>
                        </div>
                        <h2 className="text-lg md:text-2xl font-black text-slate-800">
                            R$ {kpis.total.toLocaleString('pt-BR', {maximumFractionDigits: 0})}
                        </h2>
                    </div>
                    <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-1">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Projeção</p>
                            <div className="p-1 bg-purple-50 text-purple-600 rounded"><ArrowUpRight size={14}/></div>
                        </div>
                        <h2 className="text-lg md:text-2xl font-black text-purple-600">
                            R$ {kpis.projecao.toLocaleString('pt-BR', {maximumFractionDigits: 0})}
                        </h2>
                    </div>
                    <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-1">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Volume</p>
                            <div className="p-1 bg-blue-50 text-blue-600 rounded"><ShoppingBag size={14}/></div>
                        </div>
                        <h2 className="text-lg md:text-2xl font-black text-slate-800">{kpis.qtd}</h2>
                    </div>
                    <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-3 md:p-4 rounded-xl shadow-md text-white relative overflow-hidden">
                        <div className="flex justify-between items-start mb-1">
                            <p className="text-[9px] font-black text-blue-200 uppercase tracking-wider">Top #1</p>
                            <Award size={14} className="text-yellow-300"/>
                        </div>
                        <h2 className="text-sm md:text-lg font-black truncate w-full" title={kpis.topVendedor?.[0]}>
                            {kpis.topVendedor ? kpis.topVendedor[0].split(' ')[0] : '-'}
                        </h2>
                        <p className="text-xs md:text-sm font-bold text-blue-100">
                            {kpis.topVendedor ? `R$ ${kpis.topVendedor[1].toLocaleString('pt-BR', {maximumFractionDigits:0})}` : ''}
                        </p>
                    </div>
                </div>

                {/* GRIDS COM ALTURA AUTOMÁTICA NO MOBILE */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-auto lg:h-[780px] mt-4">
                    <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[500px] lg:h-full overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
                            <div className="flex items-center gap-2">
                                <Store className="text-indigo-600" size={18}/>
                                <h3 className="text-sm font-black text-slate-800 uppercase">Ranking de Lojas</h3>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-1">
                            {storeRanking.map(([name, val], idx) => {
                                const maxVal = storeRanking[0][1] || 1;
                                const percent = (val / maxVal) * 100;
                                const isSelected = storeFilter === name;
                                return (
                                    <div 
                                        key={name} 
                                        onClick={() => setStoreFilter(isSelected ? 'TODAS' : name)}
                                        className={`group cursor-pointer p-2 rounded-lg transition-all border ${
                                            isSelected ? 'bg-blue-50 border-blue-400 shadow-sm' : 'border-transparent hover:bg-slate-50 border-b-slate-50'
                                        }`}
                                    >
                                        <div className="flex justify-between items-end mb-1">
                                            <span className={`text-[10px] md:text-[11px] font-bold uppercase flex items-center gap-2 ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>
                                                <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black ${
                                                    idx < 3 ? (isSelected ? 'bg-blue-600 text-white' : 'bg-indigo-100 text-indigo-700') : (isSelected ? 'bg-blue-200 text-blue-800' : 'bg-slate-100 text-slate-400')
                                                }`}>
                                                    {idx + 1}
                                                </span>
                                                <span className="truncate max-w-[150px] md:max-w-none">{name}</span>
                                            </span>
                                            <span className={`text-[11px] font-black ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                                                R$ {val.toLocaleString('pt-BR', {maximumFractionDigits:0})}
                                            </span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full transition-all duration-700 ${isSelected ? 'bg-blue-600' : (idx < 3 ? 'bg-indigo-500' : 'bg-slate-300')}`} style={{ width: `${percent}%` }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-col gap-4 h-full">
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[400px] lg:h-full overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
                                <div className="flex items-center gap-2">
                                    <Award className="text-amber-500" size={18}/>
                                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Top Vendedores</h3>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-1">
                                {sellerRanking.map(([name, val], idx) => {
                                    const percent = (val / (sellerRanking[0][1] || 1)) * 100;
                                    return (
                                        <div key={name} className="group p-1.5 hover:bg-slate-50 rounded-lg">
                                            <div className="flex justify-between items-end mb-1">
                                                <span className="text-[10px] font-bold text-slate-500 uppercase truncate w-28 md:w-36 flex items-center gap-2">
                                                    <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-black ${idx < 3 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>{idx + 1}</span>
                                                    {name}
                                                </span>
                                                <span className="text-[10px] font-black text-slate-700">R$ {val.toLocaleString('pt-BR', {maximumFractionDigits:0})}</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${idx < 3 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: `${percent}%` }}></div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </>
        )}

        {/* ================= CONTEÚDO 2: VISÃO VENDEDORES (TABELA RESPONSIVA) ================= */}
        {activeTab === 'VENDEDORES' && (
            // Altura automática no mobile
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-auto lg:h-[850px] overflow-hidden">
                <div className="p-3 md:p-4 border-b border-slate-100 bg-slate-50 flex flex-col gap-3">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                         <div className="flex items-center gap-3">
                            <Award className="text-blue-600" size={24}/>
                            <div>
                                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Ranking Detalhado</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase">{filteredSellersKpi.length} Colaboradores</p>
                            </div>
                        </div>
                        {/* Filtros em Grid no Mobile */}
                        <div className="grid grid-cols-2 md:flex gap-2 w-full md:w-auto">
                            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="py-2 px-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold uppercase text-slate-600 w-full">
                                {uniqueStores.map(store => <option key={store} value={store}>{store}</option>)}
                            </select>
                            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar..." className="py-2 px-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold w-full"/>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-auto custom-scrollbar">
                    {filteredSellersKpi.length > 0 && (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm text-slate-500">
                                <tr className="text-[9px] md:text-[10px] font-black uppercase tracking-wider">
                                    <th className="px-2 md:px-4 py-3 text-center w-8 md:w-12">#</th>
                                    <th className="px-2 md:px-4 py-3">Vendedor</th>
                                    {/* OCULTAR NO MOBILE: Colunas secundárias */}
                                    <th className="hidden md:table-cell px-4 py-3">Região</th>
                                    <th className="px-2 md:px-4 py-3 text-right text-blue-600">Fat. Atual</th>
                                    <th className="hidden md:table-cell px-4 py-3 text-right text-slate-400">Fat. Anterior</th>
                                    <th className="hidden md:table-cell px-4 py-3 text-center">Cresc.</th>
                                    <th className="hidden lg:table-cell px-4 py-3 text-center">PA</th>
                                    <th className="hidden lg:table-cell px-4 py-3 text-center">Ticket</th>
                                    <th className="hidden sm:table-cell px-4 py-3 text-center">Qtd</th>
                                    <th className="hidden lg:table-cell px-4 py-3 text-center">% Seg</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                                {filteredSellersKpi.map((s, i) => {
                                    const growth = Number(s.CRESCIMENTO || 0);
                                    const isPositive = growth >= 0;
                                    return (
                                        <tr key={i} className="hover:bg-blue-50 transition-colors group text-xs font-bold">
                                            <td className="px-2 md:px-4 py-3 text-center">
                                                <span className={`inline-block w-6 h-6 leading-6 rounded-md ${i < 3 ? 'bg-amber-100 text-amber-700 font-black' : 'bg-slate-200 text-slate-500'}`}>{i + 1}</span>
                                            </td>
                                            <td className="px-2 md:px-4 py-3">
                                                <div className="text-slate-800 font-black truncate max-w-[120px] md:max-w-none">{s.VENDEDOR}</div>
                                                <div className="text-[9px] text-slate-400 uppercase font-bold flex items-center gap-1 md:hidden">
                                                    {s.LOJA} {/* Mostra loja embaixo do nome só no mobile */}
                                                </div>
                                            </td>
                                            <td className="hidden md:table-cell px-4 py-3 text-[10px] font-bold uppercase text-slate-500">{s.REGIAO}</td>
                                            
                                            <td className="px-2 md:px-4 py-3 text-right font-black text-slate-800 text-sm">
                                                R$ {Number(s.FAT_ATUAL).toLocaleString('pt-BR', {maximumFractionDigits:0})}
                                            </td>
                                            
                                            <td className="hidden md:table-cell px-4 py-3 text-right text-slate-400">
                                                R$ {Number(s.FAT_ANTERIOR).toLocaleString('pt-BR', {maximumFractionDigits:0})}
                                            </td>
                                            <td className="hidden md:table-cell px-4 py-3 text-center">
                                                <span className={`flex items-center justify-center gap-1 ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                                                    {isPositive ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
                                                    {(growth * 100).toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="hidden lg:table-cell px-4 py-3 text-center text-slate-500">{Number(s.PA).toFixed(2)}</td>
                                            <td className="hidden lg:table-cell px-4 py-3 text-center text-slate-500">R$ {Number(s.TICKET).toFixed(0)}</td>
                                            <td className="hidden sm:table-cell px-4 py-3 text-center text-slate-800 font-black bg-blue-50/30">{Number(s.QTD)}</td>
                                            <td className="hidden lg:table-cell px-4 py-3 text-center font-black text-purple-600">{(Number(s.PCT_SEGURO) * 100).toFixed(1)}%</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        )}

        {/* ================= CONTEÚDO 3: VISÃO PRODUTOS (SIMPLIFICADA NO MOBILE) ================= */}
        {activeTab === 'PRODUTOS' && (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-auto lg:h-[850px] overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Package className="text-blue-600" size={24}/>
                        <div>
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Mix de Produtos</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Top Produtos</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-auto custom-scrollbar">
                    {productRanking.length > 0 && (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm text-slate-500">
                                <tr className="text-[10px] font-black uppercase tracking-wider">
                                    <th className="px-2 md:px-6 py-3 w-10 md:w-16 text-center">#</th>
                                    <th className="px-2 md:px-6 py-3">Produto</th>
                                    <th className="px-2 md:px-6 py-3 text-center text-blue-600">Qtd</th>
                                    <th className="hidden md:table-cell px-6 py-3 text-right">Total</th>
                                    <th className="px-2 md:px-6 py-3 text-center bg-yellow-50 text-yellow-700">Estoque</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                                {productRanking.slice(0, 100).map((prod, i) => (
                                    <tr key={i} className="hover:bg-blue-50 transition-colors group text-xs font-bold">
                                        <td className="px-2 md:px-6 py-3 text-center">
                                            <span className={`inline-block w-6 h-6 leading-6 rounded-md ${i < 3 ? 'bg-amber-100 text-amber-700 font-black' : 'bg-slate-200 text-slate-500'}`}>{i + 1}</span>
                                        </td>
                                        <td className="px-2 md:px-6 py-3">
                                            <div className="font-black text-slate-800 truncate max-w-[150px] md:max-w-none">{prod.desc}</div>
                                            <div className="flex items-center gap-1 text-[10px] text-slate-400 uppercase font-bold mt-0.5">
                                                <Tag size={10}/> {prod.familia}
                                            </div>
                                        </td>
                                        <td className="px-2 md:px-6 py-3 text-center">
                                            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-md font-black">{prod.qtd}</span>
                                        </td>
                                        <td className="hidden md:table-cell px-6 py-3 text-right text-slate-600">
                                            R$ {prod.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                        </td>
                                        <td className="px-2 md:px-6 py-3 text-center bg-yellow-50/50 border-l border-yellow-50">
                                             <span className={`font-black px-2 py-1 rounded ${Number(prod.estoqueAtual) > 10 ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'}`}>
                                                {prod.estoqueAtual}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        )}
      </div>
    </div>
  );
}