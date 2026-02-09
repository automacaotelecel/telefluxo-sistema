import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, Search, Box, Store, 
  TrendingUp, AlertCircle, LayoutGrid, List as ListIcon,
  Smartphone, Tag, Filter, MapPin, X, Download, ChevronRight, ArrowLeft, ShoppingBag, RefreshCw, Truck, ArrowRight, ShoppingCart, Calendar, Bug
} from 'lucide-react';

// --- 1. CONFIGURAÇÕES E MAPAS ---

const STORE_REGIONS: Record<string, string> = {
  "ARAGUAIA SHOPPING": "GOIÁS", "BOULEVARD SHOPPING": "DF", "BRASILIA SHOPPING": "DF",
  "CONJUNTO NACIONAL": "DF", "CONJUNTO NACIONAL QUIOSQUE": "DF", "GOIANIA SHOPPING": "GOIÁS",
  "IGUATEMI SHOPPING": "DF", "JK SHOPPING": "DF", "PARK SHOPPING": "DF",
  "PATIO BRASIL": "DF", "TAGUATINGA SHOPPING": "DF", "TERRAÇO SHOPPING": "DF",
  "TAGUATINGA SHOPPING QQ": "DF", "UBERLÂNDIA SHOPPING": "MINAS GERAIS",
  "UBERABA SHOPPING": "MINAS GERAIS", "FLAMBOYANT SHOPPING": "GOIÁS",
  "BURITI SHOPPING": "GOIÁS", "PASSEIO DAS AGUAS": "GOIÁS", "PORTAL SHOPPING": "GOIÁS",
  "SHOPPING SUL": "GOIÁS", "BURITI RIO VERDE": "GOIÁS", "PARK ANAPOLIS": "GOIÁS",
  "SHOPPING RECIFE": "NORDESTE", "MANAIRA SHOPPING": "NORDESTE", "IGUATEMI FORTALEZA": "NORDESTE",
  "CD TAGUATINGA": "CD"
};

const CNPJ_MAP: Record<string, string> = {
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

const normalizeStr = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const getStoreNameFromCNPJ = (raw: string) => {
    if (!raw) return "";
    const clean = raw.replace(/\D/g, ''); 
    return CNPJ_MAP[clean] || CNPJ_MAP[raw] || raw.toUpperCase();
};

export default function StockModule() {
  const [stockData, setStockData] = useState<any[]>([]);
  const [salesData, setSalesData] = useState<any[]>([]); 
  const [purchaseData, setPurchaseData] = useState<any[]>([]); 
  const [loading, setLoading] = useState(false);
  
  // ESTADO NOVO: CONTROLE DE DEBUG
  const [showDebug, setShowDebug] = useState(false);

  const [moduleMode, setModuleMode] = useState<'stock' | 'redistribution' | 'purchases'>('stock');

  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('TODAS');
  const [regionFilter, setRegionFilter] = useState('TODAS');
  const [expandedStore, setExpandedStore] = useState<string | null>(null); 
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const API_URL = 'https://telefluxo-aplicacao.onrender.com';

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Estoque
      const resStock = await fetch(`${API_URL}/stock`);
      const jsonStock = await resStock.json();
      if(Array.isArray(jsonStock)) setStockData(jsonStock);

      // 2. Compras
      try {
          const resPurchases = await fetch(`${API_URL}/purchases`);
          const jsonPurchases = await resPurchases.json();
          console.log("📦 Compras Recebidas do Banco:", jsonPurchases);
          if(Array.isArray(jsonPurchases)) setPurchaseData(jsonPurchases);
      } catch(e) { console.warn("Erro ao carregar compras", e); }

      // 3. Vendas
      let userId = '';
      try {
          const rawUser = localStorage.getItem('user') || localStorage.getItem('telefluxo_user');
          if (rawUser) userId = JSON.parse(rawUser).id || JSON.parse(rawUser).userId;
      } catch(e) {}

      if (userId) {
          const resSales = await fetch(`${API_URL}/sales?userId=${userId}`);
          const jsonSales = await resSales.json();
          const salesList = jsonSales.sales || (Array.isArray(jsonSales) ? jsonSales : []);
          setSalesData(salesList);
      }
    } catch (error) { console.error(error); } 
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleSync = async () => {
    if(!confirm("Isso vai conectar na Microvix e atualizar o estoque. Pode levar alguns minutos. Continuar?")) return;
    setLoading(true);
    try {
      await fetch(`${API_URL}/stock/refresh`, { method: 'POST' });
      loadData();
    } catch (error) { alert("Erro de conexão."); } 
    finally { setLoading(false); }
  };

  // --- MAPAS AUXILIARES ---
  const salesMap = useMemo(() => {
      const map: Record<string, number> = {};
      salesData.forEach(sale => {
          const rawStore = sale.cnpj_empresa || sale.loja || "";
          const storeName = getStoreNameFromCNPJ(rawStore).trim().toUpperCase();
          const desc = normalizeStr(sale.descricao || sale.produto || "");
          const key = `${storeName}|${desc}`;
          if (!map[key]) map[key] = 0;
          map[key] += Number(sale.quantidade || 1);
      });
      return map;
  }, [salesData]);

  const purchasesMap = useMemo(() => {
      const map: Record<string, any> = {};
      purchaseData.forEach(p => {
          // Normalização da Região para evitar problemas de acentos ou nomes diferentes
          const rawRegiao = (p.regiao || "OUTROS").toUpperCase();
          const key = `${rawRegiao}|${normalizeStr(p.descricao)}`;
          
          if (!map[key]) map[key] = { total: 0, details: [] };
          map[key].total += p.qtd_total;
          
          let prev = {};
          try { prev = JSON.parse(p.previsao_info); } catch(e) {}
          map[key].details.push(prev);
      });
      return map;
  }, [purchaseData]);

  const getProductSales = (storeName: string, description: string) => {
      const key = `${storeName.trim().toUpperCase()}|${normalizeStr(description)}`;
      return salesMap[key] || 0;
  };

  const getIncomingStock = (region: string, description: string) => {
      // Normalização da região para o Match
      const key = `${region.toUpperCase()}|${normalizeStr(description)}`;
      return purchasesMap[key] || null;
  };

  // --- ALGORITMOS ---
  
  const redistributionSuggestions = useMemo(() => {
      if (stockData.length === 0) return { moves: [], buys: [] };
      const suggestions: any[] = [];
      const purchasesSug: any[] = [];
      const productGroups: Record<string, any> = {};

      stockData.forEach(item => {
          const region = STORE_REGIONS[item.storeName] || "OUTROS";
          if (regionFilter !== 'TODAS' && region !== regionFilter) return;

          const key = `${region}|${item.description}|${item.productCode}`;
          if (!productGroups[key]) {
              productGroups[key] = {
                  description: item.description, productCode: item.productCode, region: region, category: item.category,
                  totalStock: 0, totalSales: 0, stores: []
              };
          }
          const sales = getProductSales(item.storeName, item.description);
          productGroups[key].totalStock += Number(item.quantity);
          productGroups[key].totalSales += sales;
          productGroups[key].stores.push({ storeName: item.storeName, qty: Number(item.quantity), sales: sales });
      });

      Object.values(productGroups).forEach((prod: any) => {
          const donors = prod.stores.filter((s: any) => s.qty > 3 && s.sales < s.qty).sort((a:any, b:any) => b.qty - a.qty);
          const receivers = prod.stores.filter((s: any) => s.qty < 2 && s.sales > 2).sort((a:any, b:any) => b.sales - a.sales);

          const incoming = getIncomingStock(prod.region, prod.description);
          const incomingQty = incoming ? incoming.total : 0;

          const gap = prod.totalSales - prod.totalStock;
          if (gap > 5) {
              if (incomingQty >= gap) {
                  // Tem incoming suficiente
              } else {
                  purchasesSug.push({
                      type: 'purchase', product: prod.description, region: prod.region, category: prod.category,
                      gap: gap - incomingQty,
                      insight: `Vendas: ${prod.totalSales} | Estoque: ${prod.totalStock} | Chegando: ${incomingQty}`
                  });
              }
          }

          if (donors.length > 0 && receivers.length > 0) {
              let dIdx = 0; let rIdx = 0;
              while (dIdx < donors.length && rIdx < receivers.length) {
                  const donor = donors[dIdx]; const receiver = receivers[rIdx];
                  const canGive = donor.qty - 2;
                  const need = 3 - receiver.qty;
                  const moveQty = Math.min(canGive, need);

                  if (moveQty > 0) {
                      suggestions.push({
                          type: 'move', product: prod.description, from: donor.storeName, to: receiver.storeName,
                          qty: moveQty, region: prod.region,
                          reason: `Loja ${donor.storeName} tem sobra (${donor.qty}) e ${receiver.storeName} tem giro (${receiver.sales}).`
                      });
                      donor.qty -= moveQty; receiver.qty += moveQty;
                  }
                  if (donor.qty <= 3) dIdx++;
                  if (receiver.qty >= 3) rIdx++;
              }
          }
      });
      return { moves: suggestions, buys: purchasesSug };
  }, [stockData, salesData, regionFilter, purchaseData]);

  // --- AGRUPAMENTO DE COMPRAS (CORRIGIDO) ---
  const groupedPurchases = useMemo(() => {
      const groups: Record<string, any[]> = {};
      
      purchaseData.forEach(p => {
          // Fallback: Se não tiver região na planilha, joga em "OUTROS"
          const regiao = (p.regiao || "OUTROS").toUpperCase();
          
          if (regionFilter !== 'TODAS' && regiao !== regionFilter) return;
          
          if (!groups[regiao]) groups[regiao] = [];
          groups[regiao].push(p);
      });
      return groups;
  }, [purchaseData, regionFilter]);

  const filteredData = useMemo(() => {
    return stockData.filter(item => {
      const itemRegion = STORE_REGIONS[item.storeName] || "OUTROS";
      const matchesSearch = ((item.description || '').toLowerCase().includes(filter.toLowerCase()) || (item.productCode || '').toString().includes(filter));
      const matchesCategory = categoryFilter === 'TODAS' || (item.category || 'GERAL') === categoryFilter;
      const matchesRegion = regionFilter === 'TODAS' || itemRegion === regionFilter;
      return matchesSearch && matchesCategory && matchesRegion;
    });
  }, [stockData, filter, categoryFilter, regionFilter]);

  const currentStoreProducts = useMemo(() => {
      if (!expandedStore) return [];
      return filteredData.filter(i => i.storeName === expandedStore);
  }, [filteredData, expandedStore]);

  const groupedStores = useMemo(() => {
    const groups: Record<string, any[]> = {}; 
    const storeStats: Record<string, any> = {};
    filteredData.forEach(item => {
        const store = item.storeName || 'LOJA DESCONHECIDA';
        const region = STORE_REGIONS[store] || 'OUTROS';
        if (!storeStats[store]) storeStats[store] = { name: store, region: region, qty: 0, value: 0, lowStockCount: 0 };
        const q = Number(item.quantity) || 0;
        storeStats[store].qty += q;
        storeStats[store].value += (Number(item.costPrice) || 0) * q;
        if (q > 0 && q < 3) storeStats[store].lowStockCount += 1;
    });
    Object.values(storeStats).forEach((store: any) => {
        if (!groups[store.region]) groups[store.region] = [];
        groups[store.region].push(store);
    });
    const sortedGroups: Record<string, any[]> = {};
    Object.keys(groups).sort().forEach(region => sortedGroups[region] = groups[region].sort((a,b) => b.value - a.value));
    return sortedGroups;
  }, [filteredData]);

  const uniqueCategories = useMemo(() => Array.from(new Set(stockData.map(i => i.category || 'GERAL'))).sort(), [stockData]);
  const uniqueRegions = useMemo(() => Array.from(new Set(Object.values(STORE_REGIONS))).sort(), []);
  
  const getStoreTotalSales = (storeName: string) => {
      const sales = salesData.filter(s => getStoreNameFromCNPJ(s.cnpj_empresa || s.loja) === storeName);
      return sales.reduce((acc, s) => acc + Number(s.quantidade), 0);
  };

  // --- LISTA ÚNICA DE REGIÕES QUE TÊM COMPRAS (PARA O FILTRO) ---
  const purchaseRegions = useMemo(() => {
      const regs = new Set(purchaseData.map(p => (p.regiao || "OUTROS").toUpperCase()));
      return Array.from(regs).sort();
  }, [purchaseData]);

  const handleExport = () => {
    const dataToExport = expandedStore ? currentStoreProducts : filteredData;
    const headers = ["Loja", "Região", "Código", "Produto", "Categoria", "Qtd Estoque", "Qtd Vendida", "Custo Unit", "Total"];
    const csvRows = dataToExport.map(item => {
        const sold = getProductSales(item.storeName, item.description);
        return [`"${item.storeName}"`, `"${STORE_REGIONS[item.storeName]}"`, `"${item.productCode}"`, `"${item.description}"`, `"${item.category}"`, String(item.quantity).replace('.',','), String(sold).replace('.',','), Number(item.costPrice).toFixed(2).replace('.',','), (item.quantity * item.costPrice).toFixed(2).replace('.',',')].join(';');
    });
    const csvContent = "\uFEFF" + [headers.join(';'), ...csvRows].join('\n'); 
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    link.setAttribute('download', `Estoque.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto font-sans bg-[#F0F2F5] min-h-screen">
      <div className="max-w-[1600px] mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3">
                {expandedStore ? (
                    <button onClick={() => setExpandedStore(null)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors">
                        <ArrowLeft size={24}/>
                    </button>
                ) : (
                    <div className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-md shadow-indigo-200">
                        {moduleMode === 'stock' ? <Box size={20} /> : moduleMode === 'redistribution' ? <Truck size={20}/> : <ShoppingCart size={20}/>}
                    </div>
                )}
                <div>
                    <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-800">
                        {moduleMode === 'stock' ? (expandedStore || "Visão Estratégica de Estoque") : moduleMode === 'redistribution' ? "Central de Remanejamento" : "Controle de Compras (Incoming)"}
                    </h1>
                    <div className="flex items-center gap-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {moduleMode === 'stock' ? "Físico & Giro" : moduleMode === 'redistribution' ? "Inteligência de Distribuição" : "Gestão de Pedidos em Aberto"}
                        </p>
                        {moduleMode === 'purchases' && purchaseData.length > 0 && <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-1.5 rounded border border-blue-100">{purchaseData.length} itens aguardando</span>}
                    </div>
                </div>
            </div>

            <div className="flex gap-2">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setModuleMode('stock')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'stock' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Estoque</button>
                    <button onClick={() => setModuleMode('redistribution')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'redistribution' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Remanejamento</button>
                    <button onClick={() => setModuleMode('purchases')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${moduleMode === 'purchases' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}>Compras</button>
                </div>
                <button onClick={handleSync} disabled={loading} className={`px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md flex items-center gap-2 ${loading ? 'opacity-50' : ''}`}>
                    {loading ? <RefreshCw size={14} className="animate-spin"/> : 'Sync'}
                </button>
                <button onClick={handleExport} className="p-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl transition-all" title="Exportar Excel"><Download size={18}/></button>
            </div>
        </div>

        {/* ================= MÓDULO DE COMPRAS (COM DEBUG) ================= */}
        {moduleMode === 'purchases' && (
            <div className="space-y-6 animate-fadeIn">
                <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-2">
                        <MapPin className="text-indigo-600" size={20}/>
                        <span className="text-sm font-bold text-slate-700 uppercase">Filtrar Região:</span>
                        <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} className="bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase px-3 py-2 rounded-lg outline-none cursor-pointer hover:border-indigo-300">
                            <option value="TODAS">Todas as Regiões</option>
                            {purchaseRegions.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                    <div className="text-right">
                        <span className="text-2xl font-black text-slate-800">{purchaseData.filter(p => regionFilter === 'TODAS' || (p.regiao||'OUTROS').toUpperCase() === regionFilter).reduce((acc, curr) => acc + curr.qtd_total, 0)}</span>
                        <span className="block text-[9px] font-bold text-slate-400 uppercase">Peças a receber</span>
                    </div>
                </div>

                {/* BOTÃO DE DIAGNÓSTICO (APARECE SE NÃO TIVER DADOS OU POR OPÇÃO) */}
                {purchaseData.length === 0 && (
                    <div className="bg-red-50 p-4 rounded-xl border border-red-200 text-center">
                        <p className="text-red-800 font-bold mb-2">⚠️ LISTA VAZIA - DIAGNÓSTICO</p>
                        <button onClick={() => setShowDebug(!showDebug)} className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 mx-auto">
                            <Bug size={16}/> VER DADOS DO SERVIDOR
                        </button>
                        {showDebug && (
                            <div className="mt-4 text-left bg-slate-900 text-green-400 p-4 rounded-xl text-xs overflow-auto max-h-60">
                                <p className="mb-2 text-white border-b border-white/20 pb-1">DADOS RECEBIDOS DO BACKEND:</p>
                                <pre>{JSON.stringify(purchaseData, null, 2)}</pre>
                            </div>
                        )}
                    </div>
                )}

                {Object.keys(groupedPurchases).length > 0 ? Object.entries(groupedPurchases).map(([region, items]) => (
                    <div key={region} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-black text-slate-700 uppercase flex items-center gap-2"><MapPin size={16}/> {region}</h3>
                            <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full">{items.reduce((acc, i)=>acc+i.qtd_total, 0)} un</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {items.map((item: any, idx: number) => {
                                let prev = {};
                                try { prev = JSON.parse(item.previsao_info || '{}'); } catch(e) {}
                                
                                return (
                                    <div key={idx} className="p-4 flex flex-col md:flex-row justify-between items-center gap-4 hover:bg-slate-50 transition-colors">
                                        <div className="flex-1">
                                            <h4 className="text-sm font-bold text-slate-800 uppercase">{item.descricao}</h4>
                                            {Object.keys(prev).length > 0 && (
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    {Object.entries(prev).map(([week, qtd]) => (
                                                        <span key={week} className="text-[10px] font-bold bg-green-50 text-green-700 border border-green-100 px-2 py-1 rounded uppercase flex items-center gap-1">
                                                            <Calendar size={10} /> {week}: {String(qtd)} un
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right min-w-[80px]">
                                            <span className="block text-2xl font-black text-slate-700">{item.qtd_total}</span>
                                            <span className="text-[8px] font-bold text-slate-400 uppercase">Total Geral</span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )) : (
                    purchaseData.length > 0 && (
                        <div className="p-20 text-center text-slate-400 font-bold uppercase text-sm bg-white rounded-2xl border border-dashed">
                            Filtro atual ocultou todos os {purchaseData.length} itens. Tente mudar a região.
                        </div>
                    )
                )}
            </div>
        )}

        {/* ================= MÓDULO REMANEJAMENTO ================= */}
        {moduleMode === 'redistribution' && (
            <div className="space-y-8 animate-fadeIn">
                <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 p-6 rounded-2xl text-white shadow-lg flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-black uppercase mb-1">Painel de Oportunidades</h2>
                        <p className="text-xs opacity-70">Otimização baseada em Estoque Local vs Vendas Recentes vs Compras Futuras.</p>
                    </div>
                    <div className="flex gap-4 text-center">
                        <div>
                            <span className="block text-2xl font-bold">{redistributionSuggestions.moves.length}</span>
                            <span className="text-[9px] uppercase opacity-70">Moves</span>
                        </div>
                        <div>
                            <span className="block text-2xl font-bold">{redistributionSuggestions.buys.length}</span>
                            <span className="text-[9px] uppercase opacity-70">Buys</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <h3 className="flex items-center gap-2 text-indigo-700 font-black uppercase text-sm border-b border-indigo-100 pb-2"><Truck size={18}/> Transferências</h3>
                        {redistributionSuggestions.moves.map((move: any, idx: number) => (
                            <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3 relative group">
                                <div className="absolute top-0 right-0 bg-indigo-50 text-indigo-600 text-[9px] font-bold px-2 py-1 rounded-bl-lg uppercase">{move.region}</div>
                                <h4 className="text-xs font-black text-slate-800 uppercase pr-8">{move.product}</h4>
                                <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100">
                                    <div className="text-center"><p className="text-[9px] font-bold text-red-400 uppercase">Origem</p><p className="text-xs font-black text-slate-700">{move.from}</p></div>
                                    <div className="flex flex-col items-center"><span className="text-xs font-black text-indigo-600 bg-indigo-100 px-2 py-1 rounded-full">{move.qty} un</span><ArrowRight size={14} className="text-indigo-300 mt-1"/></div>
                                    <div className="text-center"><p className="text-[9px] font-bold text-green-500 uppercase">Destino</p><p className="text-xs font-black text-slate-700">{move.to}</p></div>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <div className="space-y-4">
                        <h3 className="flex items-center gap-2 text-green-700 font-black uppercase text-sm border-b border-green-100 pb-2"><ShoppingBag size={18}/> Sugestões de Compra</h3>
                        {redistributionSuggestions.buys.map((buy: any, idx: number) => (
                            <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center gap-4">
                                <div>
                                    <div className="flex gap-2 mb-1"><span className="text-[9px] font-bold bg-green-50 text-green-600 px-1.5 py-0.5 rounded uppercase">{buy.region}</span></div>
                                    <h4 className="text-xs font-black text-slate-800 uppercase">{buy.product}</h4>
                                    <p className="text-[10px] text-slate-400 mt-1">{buy.insight}</p>
                                </div>
                                <div className="text-center"><p className="text-[9px] font-bold text-slate-400 uppercase">Comprar</p><p className="text-xl font-black text-green-600">+{buy.gap}</p></div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* ================= MÓDULO ESTOQUE (CLÁSSICO) ================= */}
        {moduleMode === 'stock' && (
            <>
            {!expandedStore && (
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} className="bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase px-3 py-2 rounded-lg outline-none cursor-pointer hover:border-indigo-300">
                        <option value="TODAS">Todas as Regiões</option>
                        {uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase px-3 py-2 rounded-lg outline-none cursor-pointer hover:border-indigo-300">
                        <option value="TODAS">Todas as Categorias</option>
                        {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {(regionFilter !== 'TODAS' || categoryFilter !== 'TODAS') && (
                        <button onClick={() => {setRegionFilter('TODAS'); setCategoryFilter('TODAS')}} className="text-red-500 text-xs font-bold px-2 hover:bg-red-50 rounded">LIMPAR</button>
                    )}
                </div>
            )}

            {expandedStore ? (
                /* MICRO VIEW */
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-fadeIn">
                    <div className="lg:col-span-3 space-y-3">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex gap-2">
                                <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-lg ${viewMode === 'list' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400'}`}><ListIcon size={16}/></button>
                                <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-lg ${viewMode === 'grid' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400'}`}><LayoutGrid size={16}/></button>
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">{currentStoreProducts.length} ITENS ENCONTRADOS</span>
                        </div>

                        <div className={viewMode === 'grid' ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" : "flex flex-col gap-2"}>
                            {currentStoreProducts.slice(0, 100).map((item, idx) => {
                                const stockQty = Number(item.quantity);
                                const isLowStock = stockQty < 3; 
                                const soldQty = getProductSales(item.storeName, item.description);

                                return (
                                    <div key={idx} className={`bg-white rounded-xl border p-4 hover:shadow-md transition-all group relative overflow-hidden ${isLowStock ? 'border-red-300 bg-red-50/20' : 'border-slate-100'} ${viewMode === 'list' ? 'flex justify-between items-center' : 'flex flex-col justify-between h-full'}`}>
                                        {isLowStock && (
                                            <div className="absolute top-0 right-0 p-2">
                                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                                            </div>
                                        )}

                                        <div className="flex gap-4 items-start">
                                            <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center font-black text-xs shrink-0 ${isLowStock ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'}`}>
                                                <span className="text-[14px]">{stockQty}</span>
                                                <span className="text-[8px] uppercase opacity-70">Est</span>
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-slate-800 uppercase line-clamp-2 leading-tight">{item.description}</h4>
                                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                                    <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase">{item.category}</span>
                                                    {soldQty > 0 ? (
                                                        <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded uppercase flex items-center gap-1 border border-green-200">
                                                            <ShoppingBag size={10}/> {soldQty} vend
                                                        </span>
                                                    ) : (
                                                        <span className="text-[8px] text-slate-300 uppercase">Sem giro</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className={`text-right ${viewMode === 'grid' ? 'mt-4 border-t border-slate-100 pt-3 w-full flex justify-between items-end' : ''}`}>
                                            <div className={viewMode === 'grid' ? 'text-left' : ''}>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">Custo Unit.</p>
                                                <p className="text-xs font-black text-slate-700">R$ {Number(item.costPrice).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                                            </div>
                                            <div className={viewMode === 'grid' ? 'text-right' : 'min-w-[100px]'}>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">Total Custo</p>
                                                <p className={`text-sm font-black ${isLowStock ? 'text-red-600' : 'text-indigo-700'}`}>
                                                    R$ {(Number(item.costPrice) * stockQty).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-indigo-900 rounded-[32px] p-6 text-white shadow-xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10"><Store size={80}/></div>
                            <p className="text-[10px] font-bold opacity-70 uppercase tracking-widest mb-1">Resumo da Loja</p>
                            <h2 className="text-xl font-black uppercase leading-tight mb-6">{expandedStore}</h2>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-[10px] opacity-70 uppercase">Valor em Estoque</p>
                                    <p className="text-2xl font-bold">R$ {currentStoreProducts.reduce((acc, i) => acc + (i.costPrice * i.quantity), 0).toLocaleString('pt-BR', {maximumFractionDigits: 0})}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] opacity-70 uppercase">Total de Peças</p>
                                    <p className="text-2xl font-bold">{currentStoreProducts.reduce((acc, i) => acc + Number(i.quantity), 0).toLocaleString('pt-BR')}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] opacity-70 uppercase">Giro Total (Período)</p>
                                    <p className="text-xl font-bold text-green-300">
                                        {getStoreTotalSales(expandedStore || "")} peças
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* MACRO VIEW */
                <div className="space-y-10 animate-fadeIn pb-10">
                    {Object.entries(groupedStores).length > 0 ? Object.entries(groupedStores).map(([region, stores]) => (
                        <div key={region} className="space-y-4">
                            <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
                                <MapPin className="text-indigo-600" size={20}/>
                                <h2 className="text-lg font-black text-slate-700 uppercase tracking-wide">{region}</h2>
                                <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{stores.length} Lojas</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {stores.map((store) => {
                                    const hasLowStockAlert = store.lowStockCount > 0 && filter !== ''; 
                                    return (
                                        <div 
                                            key={store.name} 
                                            onClick={() => setExpandedStore(store.name)}
                                            className={`group bg-white p-5 rounded-2xl border shadow-sm cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg relative overflow-hidden ${hasLowStockAlert ? 'border-red-300 ring-4 ring-red-50' : 'border-slate-100 hover:border-indigo-200'}`}
                                        >
                                            {hasLowStockAlert && <div className="absolute top-3 right-3 w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-lg"></div>}
                                            <h3 className="text-sm font-black text-slate-800 uppercase leading-tight mb-4 truncate pr-4">{store.name}</h3>
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-end border-b border-slate-50 pb-2">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Estoque</span>
                                                    <span className={`text-lg font-black ${store.qty === 0 ? 'text-slate-300' : (hasLowStockAlert ? 'text-red-600' : 'text-slate-700')}`}>{store.qty.toLocaleString('pt-BR')}</span>
                                                </div>
                                                <div className="flex justify-between items-end">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Financeiro</span>
                                                    <span className="text-sm font-bold text-indigo-600">R$ {store.value.toLocaleString('pt-BR', {notation: "compact", maximumFractionDigits: 1})}</span>
                                                </div>
                                            </div>
                                            <div className="absolute bottom-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0"><ChevronRight className="text-indigo-600" size={20}/></div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )) : (
                        <div className="col-span-full py-20 text-center">
                            <div className="inline-block p-4 bg-slate-100 rounded-full mb-4 text-slate-300"><Package size={40}/></div>
                            <p className="text-slate-400 font-bold uppercase text-sm">Nenhum estoque encontrado.</p>
                        </div>
                    )}
                </div>
            )}
            </>
        )}
      </div>
    </div>
  );
}