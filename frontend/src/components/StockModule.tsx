import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, Search, Box, Store, 
  TrendingUp, AlertCircle, LayoutGrid, List as ListIcon,
  Smartphone, Tag, Filter, MapPin, X, Download
} from 'lucide-react';

// --- MAPA DE REGIÕES ---
const STORE_REGIONS: Record<string, string> = {
  "ARAGUAIA SHOPPING": "GOIÁS",
  "BOULEVARD SHOPPING": "DF",
  "BRASILIA SHOPPING": "DF",
  "CONJUNTO NACIONAL": "DF",
  "CONJUNTO NACIONAL QUIOSQUE": "DF",
  "GOIANIA SHOPPING": "GOIÁS",
  "IGUATEMI SHOPPING": "DF",
  "JK SHOPPING": "DF",
  "PARK SHOPPING": "DF",
  "PATIO BRASIL": "DF",
  "TAGUATINGA SHOPPING": "DF",
  "TERRAÇO SHOPPING": "DF",
  "TAGUATINGA SHOPPING QQ": "DF",
  "UBERLÂNDIA SHOPPING": "MINAS GERAIS",
  "UBERABA SHOPPING": "MINAS GERAIS",
  "FLAMBOYANT SHOPPING": "GOIÁS",
  "BURITI SHOPPING": "GOIÁS",
  "PASSEIO DAS AGUAS": "GOIÁS",
  "PORTAL SHOPPING": "GOIÁS",
  "SHOPPING SUL": "GOIÁS",
  "BURITI RIO VERDE": "GOIÁS",
  "PARK ANAPOLIS": "GOIÁS",
  "SHOPPING RECIFE": "NORDESTE",
  "MANAIRA SHOPPING": "NORDESTE",
  "IGUATEMI FORTALEZA": "NORDESTE"
};

export default function StockModule() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // --- FILTROS ---
  const [filter, setFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('TODAS');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [regionFilter, setRegionFilter] = useState('TODAS');
  
  // --- SELEÇÃO ---
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);

  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'; 

  // --- SYNC ---
  const handleSync = async () => {
    if(!confirm("Isso vai conectar na Microvix e atualizar o estoque. Pode levar alguns minutos. Continuar?")) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/stock/refresh`, { method: 'POST' });
      const json = await res.json();
      if (res.ok) { alert("Sucesso! " + json.message); fetchStock(); } 
      else { alert("Erro: " + json.error); }
    } catch (error) { alert("Erro de conexão."); } 
    finally { setLoading(false); }
  };

  const fetchStock = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/stock`);
      const result = await response.json();
      if(Array.isArray(result)) setData(result);
    } catch (error) { console.error(error); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchStock(); }, []);

  // --- LISTAS ÚNICAS ---
  const uniqueStores = useMemo(() => Array.from(new Set(data.map(i => i.storeName || 'Loja Desconhecida'))).sort(), [data]);
  const uniqueCategories = useMemo(() => Array.from(new Set(data.map(i => i.category || 'GERAL'))).sort(), [data]);
  const uniqueRegions = useMemo(() => Array.from(new Set(Object.values(STORE_REGIONS))).sort(), []);

  // --- FILTRAGEM ---
  const filteredData = useMemo(() => {
    return data.filter(item => {
      const itemRegion = STORE_REGIONS[item.storeName] || "OUTROS";

      const matchesSearch = (
        (item.description || '').toLowerCase().includes(filter.toLowerCase()) ||
        (item.reference || '').toLowerCase().includes(filter.toLowerCase()) ||
        (item.productCode || '').toString().includes(filter)
      );
      const matchesStore = storeFilter === 'TODAS' || item.storeName === storeFilter;
      const matchesCategory = categoryFilter === 'TODAS' || (item.category || 'GERAL') === categoryFilter;
      const matchesRegion = regionFilter === 'TODAS' || itemRegion === regionFilter;

      return matchesSearch && matchesStore && matchesCategory && matchesRegion;
    });
  }, [data, filter, storeFilter, categoryFilter, regionFilter]);

  // --- EXPORTAR EXCEL (CSV) ---
  const handleExport = () => {
    const headers = [
      "Loja", 
      "Região", 
      "Código", 
      "Produto", 
      "Referência", 
      "Categoria", 
      "Quantidade", 
      "Custo Unit.", 
      "Venda Unit.", 
      "Total Custo"
    ];

    const csvRows = filteredData.map(item => {
      const region = STORE_REGIONS[item.storeName] || "OUTROS";
      const totalCost = (Number(item.costPrice) || 0) * (Number(item.quantity) || 0);
      
      return [
        `"${item.storeName || ''}"`,
        `"${region}"`,
        `"${item.productCode || ''}"`,
        `"${(item.description || '').replace(/"/g, '""')}"`, 
        `"${item.reference || ''}"`,
        `"${item.category || ''}"`,
        Number(item.quantity).toString().replace('.', ','), 
        Number(item.costPrice).toFixed(2).replace('.', ','),
        Number(item.salePrice).toFixed(2).replace('.', ','),
        totalCost.toFixed(2).replace('.', ',')
      ].join(';'); 
    });

    const csvContent = "\uFEFF" + [headers.join(';'), ...csvRows].join('\n'); 

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Estoque_TeleFluxo_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- KPIS ---
  const kpis = useMemo(() => {
    const sourceData = selectedProduct 
        ? filteredData.filter(i => i.productCode === selectedProduct.productCode)
        : filteredData;

    const totalQty = sourceData.reduce((acc, curr) => acc + (Number(curr.quantity) || 0), 0);
    const totalCost = sourceData.reduce((acc, curr) => acc + ((Number(curr.costPrice) || 0) * (Number(curr.quantity) || 0)), 0);
    const totalSale = sourceData.reduce((acc, curr) => acc + ((Number(curr.salePrice) || 0) * (Number(curr.quantity) || 0)), 0);
    
    return {
      totalQty,
      totalCost,
      potentialRevenue: totalSale,
      avgTicket: totalQty ? totalCost / totalQty : 0
    };
  }, [filteredData, selectedProduct]);

  // --- RANKING DIREITA (ATUALIZADO COM QTD + VALOR) ---
  const rightSidebarData = useMemo(() => {
    // Agora o ranking guarda um objeto com VALUE (R$) e QTY (Peças)
    const summary: Record<string, { value: number, qty: number }> = {};
    
    const source = selectedProduct ? data.filter(i => i.productCode === selectedProduct.productCode) : filteredData;

    source.forEach(item => {
        const store = item.storeName || 'Outros';
        const q = Number(item.quantity) || 0;
        const v = (Number(item.costPrice) || 0) * q;
        
        if (!summary[store]) summary[store] = { value: 0, qty: 0 };
        summary[store].value += v;
        summary[store].qty += q;
    });

    // Ordenação Inteligente:
    // Se tem produto selecionado -> Ordena por QUANTIDADE (quem tem mais peças)
    // Se é visão geral -> Ordena por VALOR (quem tem mais dinheiro parado)
    return Object.entries(summary)
        .sort((a,b) => selectedProduct ? b[1].qty - a[1].qty : b[1].value - a[1].value)
        .filter(([_, data]) => data.qty > 0 || data.value > 0);

  }, [filteredData, data, selectedProduct]);

  const toggleProductSelect = (item: any) => {
    if (selectedProduct?.productCode === item.productCode) setSelectedProduct(null);
    else setSelectedProduct(item);
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto font-sans bg-slate-50 relative min-h-screen">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-200 text-white">
              <Package size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-black uppercase italic tracking-tighter text-slate-800">
                Gestão de Estoque
              </h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Controle Físico & Financeiro
              </p>
            </div>
          </div>
          
          <div className="flex gap-3">
             <button 
                onClick={handleExport}
                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-4 rounded-2xl font-black text-xs uppercase shadow-sm transition-all active:scale-95 flex items-center gap-2"
                title="Baixar CSV para Excel"
             >
                <Download size={18} /> Exportar
             </button>

             <button onClick={handleSync} disabled={loading} className={`bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center gap-2 ${loading ? 'opacity-50 cursor-wait' : ''}`}>
                {loading ? 'Sincronizando...' : 'Sincronizar'}
             </button>
             
             <div className="hidden sm:flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm ml-2">
                <button onClick={() => setViewMode('list')} className={`p-3 rounded-xl transition-all ${viewMode === 'list' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-indigo-500'}`}><ListIcon size={20}/></button>
                <button onClick={() => setViewMode('grid')} className={`p-3 rounded-xl transition-all ${viewMode === 'grid' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:text-indigo-500'}`}><LayoutGrid size={20}/></button>
             </div>
          </div>
        </div>

        {/* KPI CARDS */}
        <div className={`grid grid-cols-1 md:grid-cols-4 gap-6 transition-all duration-500 ${selectedProduct ? 'scale-[1.02]' : ''}`}>
          <div className={`p-6 rounded-[32px] border border-slate-100 shadow-sm relative overflow-hidden group ${selectedProduct ? 'bg-indigo-50 border-indigo-200' : 'bg-white'}`}>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Valor em Estoque</p>
            <h2 className="text-2xl font-black text-slate-800">R$ {kpis.totalCost.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h2>
          </div>

          <div className="bg-indigo-600 p-6 rounded-[32px] shadow-lg shadow-indigo-200 text-white relative overflow-hidden">
             <div className="absolute right-0 top-0 p-6 opacity-10"><TrendingUp size={64} /></div>
            <p className="text-[10px] font-black opacity-70 uppercase tracking-widest mb-2">Potencial de Venda</p>
            <h2 className="text-2xl font-black">R$ {kpis.potentialRevenue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h2>
          </div>

          <div className={`p-6 rounded-[32px] border border-slate-100 shadow-sm ${selectedProduct ? 'bg-indigo-50 border-indigo-200' : 'bg-white'}`}>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Volume Total</p>
            <h2 className="text-2xl font-black text-slate-800">{kpis.totalQty.toLocaleString('pt-BR')} <span className="text-sm text-slate-400 font-bold">peças</span></h2>
          </div>

          <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Custo Médio</p>
            <h2 className="text-2xl font-black text-slate-800">R$ {kpis.avgTicket.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h2>
          </div>
        </div>

        {/* FILTROS */}
        <div className="flex flex-col xl:flex-row gap-4 bg-white p-4 rounded-[32px] border border-slate-100 shadow-sm items-center justify-between">
            <div className="flex items-center gap-3 w-full xl:w-96">
                <div className="bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100 flex items-center gap-3 w-full shadow-inner focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
                    <Search size={18} className="text-slate-400" />
                    <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar produto..." className="text-xs font-bold outline-none bg-transparent w-full text-slate-700 placeholder:text-slate-400" />
                </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:w-auto overflow-x-auto pb-2 sm:pb-0">
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 min-w-[150px]">
                    <MapPin size={16} className="text-indigo-500" />
                    <span className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">Região:</span>
                    <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} className="bg-transparent text-slate-700 text-[10px] font-black uppercase outline-none cursor-pointer w-full">
                        <option value="TODAS">Todas</option>
                        {uniqueRegions.map(reg => <option key={reg} value={reg}>{reg}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 min-w-[200px]">
                    <Store size={16} className="text-indigo-500" />
                    <span className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">Loja:</span>
                    <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent text-slate-700 text-[10px] font-black uppercase outline-none cursor-pointer w-full">
                        <option value="TODAS">Todas</option>
                        {uniqueStores.map(store => <option key={store} value={store}>{store}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 min-w-[150px]">
                    <Filter size={16} className="text-indigo-500" />
                    <span className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">Categ:</span>
                    <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="bg-transparent text-slate-700 text-[10px] font-black uppercase outline-none cursor-pointer w-full">
                        <option value="TODAS">Todas</option>
                        {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                </div>
                {(regionFilter !== 'TODAS' || storeFilter !== 'TODAS' || categoryFilter !== 'TODAS' || selectedProduct) && (
                    <button onClick={() => { setRegionFilter('TODAS'); setStoreFilter('TODAS'); setCategoryFilter('TODAS'); setSelectedProduct(null); }} className="bg-red-50 text-red-500 p-2 rounded-xl hover:bg-red-100 transition-colors">
                        <X size={16} />
                    </button>
                )}
            </div>
        </div>

        {/* CONTEÚDO */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
                <div className="flex justify-between items-center px-2">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                        {selectedProduct ? 'Produto Selecionado' : `Produtos Listados`}
                    </h3>
                    <span className="text-[10px] font-bold text-slate-400">{filteredData.length} registros</span>
                </div>

                {filteredData.length > 0 ? (
                    <div className={viewMode === 'grid' ? "grid grid-cols-2 gap-4" : "space-y-3"}>
                        {filteredData.slice(0, 100).map((item, idx) => {
                            const isSelected = selectedProduct?.productCode === item.productCode;
                            return (
                                <div key={idx} onClick={() => toggleProductSelect(item)} className={`p-5 rounded-[24px] border shadow-sm transition-all cursor-pointer relative group ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl scale-[1.02] z-10' : 'bg-white border-slate-100 hover:shadow-md hover:border-indigo-200'} ${viewMode === 'grid' ? 'flex flex-col' : ''}`}>
                                    <div className="flex justify-between items-start h-full">
                                        <div className="flex gap-4">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xs shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-600'}`}>
                                                {item.quantity > 0 ? <Smartphone size={20}/> : <AlertCircle size={20}/>}
                                            </div>
                                            <div>
                                                <div className="flex flex-wrap gap-2 items-center mb-1">
                                                    <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{item.reference || 'S/ REF'}</span>
                                                    {!isSelected && <span className="text-[8px] font-black uppercase bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded truncate max-w-[150px]">{item.storeName}</span>}
                                                </div>
                                                <h4 className={`font-bold text-sm leading-tight uppercase line-clamp-2 ${isSelected ? 'text-white' : 'text-slate-800'}`}>{item.description}</h4>
                                                <p className={`text-[10px] font-bold mt-1 uppercase flex items-center gap-1 ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}><Tag size={10}/> {item.category || 'Geral'}</p>
                                            </div>
                                        </div>
                                        <div className={`text-right ${viewMode === 'grid' ? 'mt-4 w-full flex justify-between items-end border-t border-white/10 pt-3' : ''}`}>
                                            <div className={viewMode === 'grid' ? 'text-left' : ''}>
                                                <p className={`text-[9px] font-black uppercase mb-0.5 ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>Custo</p>
                                                <p className={`text-sm font-black ${isSelected ? 'text-white' : 'text-slate-700'}`}>R$ {Number(item.costPrice).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                            </div>
                                            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border ${isSelected ? 'bg-white/20 border-white/20 text-white' : 'bg-slate-50 border-slate-100'} ${viewMode === 'list' ? 'mt-2' : ''}`}>
                                                <span className={`text-[10px] font-bold uppercase ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>Qtd:</span>
                                                <span className={`text-sm font-black ${!isSelected && item.quantity < 2 ? 'text-red-500' : ''}`}>{item.quantity}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="p-20 text-center text-slate-300 font-black text-xs uppercase bg-white rounded-[40px] border border-dashed border-slate-200">Nenhum produto encontrado.</div>
                )}
            </div>

            {/* DIREITA: RANKING (COM AS DUAS INFORMAÇÕES) */}
            <div className="space-y-6">
                <div className={`p-8 rounded-[40px] border shadow-sm sticky top-6 transition-all duration-500 ${selectedProduct ? 'bg-indigo-900 border-indigo-800' : 'bg-white border-slate-100'}`}>
                    
                    <div className="flex items-center gap-3 mb-6">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${selectedProduct ? 'bg-white text-indigo-900' : 'bg-indigo-100 text-indigo-600'}`}>
                            {selectedProduct ? <Box size={20}/> : <Store size={20}/>}
                        </div>
                        <div className="flex-1">
                            <h3 className={`font-black uppercase text-xs tracking-widest ${selectedProduct ? 'text-indigo-300' : 'text-slate-400'}`}>
                                {selectedProduct ? 'Onde tem estoque?' : 'Ranking Geral (Valor)'}
                            </h3>
                            {selectedProduct && <p className="text-white font-bold text-xs truncate w-48">{selectedProduct.description}</p>}
                        </div>
                    </div>

                    <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar">
                        {rightSidebarData.length > 0 ? rightSidebarData.map(([store, data], idx) => (
                            <div key={store} className="group cursor-default">
                                <div className="flex justify-between items-center text-[10px] font-black uppercase mb-2">
                                    <span className={selectedProduct ? 'text-white' : (idx === 0 ? "text-indigo-600" : "text-slate-600")}>{store}</span>
                                    
                                    <div className="text-right">
                                        {selectedProduct ? (
                                            /* MODO PRODUTO: Foco na Quantidade */
                                            <span className="text-white text-xs">{data.qty} <span className="text-[8px] text-indigo-300">peças</span></span>
                                        ) : (
                                            /* MODO GERAL: Foco no Valor, com Qtd em baixo */
                                            <>
                                                <span className="block text-slate-600">R$ {data.value.toLocaleString('pt-BR', {maximumFractionDigits: 0})}</span>
                                                <span className="block text-[8px] text-slate-400">{data.qty} peças</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className={`h-3 rounded-full overflow-hidden ${selectedProduct ? 'bg-indigo-800' : 'bg-slate-50'}`}>
                                    <div 
                                        className={`h-full rounded-full transition-all duration-1000 ${selectedProduct ? 'bg-white' : (idx === 0 ? 'bg-indigo-500' : 'bg-slate-300')}`} 
                                        style={{ width: `${(selectedProduct ? (data.qty / rightSidebarData[0][1].qty) : (data.value / rightSidebarData[0][1].value)) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center py-10 opacity-50 text-xs font-bold uppercase text-white">Nenhum dado para exibir</div>
                        )}
                    </div>
                    
                    {selectedProduct && (
                        <div className="mt-6 pt-6 border-t border-indigo-800 text-center">
                            <button onClick={() => setSelectedProduct(null)} className="text-xs font-black text-indigo-300 hover:text-white uppercase transition-colors">Voltar para Visão Geral</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}