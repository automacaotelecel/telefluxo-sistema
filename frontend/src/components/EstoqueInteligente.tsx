import React, { useState, useEffect, useMemo } from 'react';
import { 
  Smartphone, 
  Layers, 
  MapPin, 
  RefreshCw, 
  Download, 
  Link as LinkIcon, 
  AlertCircle,
  CheckCircle,
  Search,
  X,
  Store,
  LayoutGrid,
  List as ListIcon,
  ShieldAlert,
  ChevronRight,
  Package
} from 'lucide-react';

// --- CONFIGURAÇÕES COMPARTILHADAS ---
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

// --- A INTELIGÊNCIA DE "FAMÍLIA DE APARELHOS" ---
const getBaseModelFamily = (fullName: string) => {
    let str = fullName.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    str = str.replace(/\+/g, ' PLUS ');

    let m = str.match(/\b(S[0-9]{2})\s?(FE|ULTRA|PLUS|PRO)?\b/);
    if (m) return `GALAXY ${m[0].trim()}`;

    m = str.match(/\b([AMF][0-9]{2})\b/);
    if (m) return `GALAXY ${m[0].trim()}`;

    m = str.match(/\b(Z\s?FLIP\s?[0-9]|Z\s?FOLD\s?[0-9]|FLIP\s?[0-9]|FOLD\s?[0-9])\b/);
    if (m) return `GALAXY ${m[0].replace(/\s+/g, ' ').trim()}`;

    m = str.match(/\b(IPHONE\s[0-9]{1,2})\s?(PRO\sMAX|PRO|PLUS|MINI)?\b/);
    if (m) return m[0].trim();

    m = str.match(/\b(MOTO\s?G[0-9]{2}|EDGE\s[0-9]{2})\s?(PRO|ULTRA|NEO)?\b/);
    if (m) return m[0].trim();

    m = str.match(/\b(REDMI\sNOTE\s[0-9]{1,2}|REDMI\s[0-9]{1,2}|POCO\s[A-Z][0-9]{1,2})\s?(PRO\sPLUS|PRO|PLUS)?\b/);
    if (m) return m[0].trim();

    return null; 
};

const formatDisplayName = (fullName: string) => {
    let clean = fullName
        .replace(/SMARTPHONE/i, '')
        .replace(/SAMSUNG/i, '')
        .replace(/MOTOROLA/i, '')
        .replace(/APPLE/i, '')
        .replace(/XIAOMI/i, '')
        .replace(/TPU/i, '')
        .replace(/\(OPEN\)/i, '')
        .replace(/ANTI\s?CHOQUE/i, '')
        .replace(/PROTETORA/i, '');
    
    return clean.trim().replace(/\s+/g, ' '); 
};

export default function EstoqueInteligente() {
  const [stockData, setStockData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Estados de Filtro e Visualização
  const [mainView, setMainView] = useState<'store' | 'product'>('store'); // NOVO: Controle de Agrupamento
  const [regionFilter, setRegionFilter] = useState('TODAS');
  const [storeFilter, setStoreFilter] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState('TODOS'); 
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); 
  
  // Estado para controlar o Modal de Detalhes
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const API_URL = 'https://telefluxo-aplicacao.onrender.com';

  const loadData = async () => {
    setLoading(true);
    try {
      const resStock = await fetch(`${API_URL}/stock`);
      const jsonStock = await resStock.json();
      if(Array.isArray(jsonStock)) setStockData(jsonStock);
    } catch (error) { 
        console.error("Erro ao carregar estoque:", error); 
    } finally { 
        setLoading(false); 
    }
  };

  useEffect(() => { loadData(); }, []);

  // Fechar modal com a tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setSelectedItem(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const uniqueRegions = useMemo(() => Array.from(new Set(Object.values(STORE_REGIONS))).sort(), []);
  const availableStores = useMemo(() => {
      let stores = Object.keys(STORE_REGIONS);
      if (regionFilter !== 'TODAS') {
          stores = stores.filter(store => STORE_REGIONS[store] === regionFilter);
      }
      return stores.sort();
  }, [regionFilter]);

  // --- ALGORITMO SMART ATTACH BASEADO NA VISÃO ESCOLHIDA ---
  const smartAttachData = useMemo(() => {
    if (stockData.length === 0) return [];

    const smartphones = stockData.filter(i => {
        const cat = (i.category || '').toUpperCase();
        return cat.includes('SMARTPHONE') || cat.includes('CELULAR') || cat.includes('TELEFONE');
    });
    
    const accessories = stockData.filter(i => {
        const cat = (i.category || '').toUpperCase();
        const desc = (i.description || '').toUpperCase();
        return cat.includes('ACESS') || cat.includes('CAPA') || desc.startsWith('CAPA') || desc.startsWith('PELICULA') || desc.includes('CASE');
    });

    const results: any[] = [];

    // ==========================================
    // LÓGICA 1: VISÃO POR LOJA (Micro)
    // ==========================================
    if (mainView === 'store') {
        const storeAnalysis: Record<string, any> = {};

        smartphones.forEach(phone => {
            const regiao = STORE_REGIONS[phone.storeName] || "OUTROS";
            if (regionFilter !== 'TODAS' && regiao !== regionFilter) return;
            if (storeFilter !== 'TODAS' && phone.storeName !== storeFilter) return;

            const familyName = getBaseModelFamily(phone.description);
            if (!familyName) return;

            if(!storeAnalysis[phone.storeName]) {
                storeAnalysis[phone.storeName] = { storeName: phone.storeName, region: regiao, families: {} };
            }

            if(!storeAnalysis[phone.storeName].families[familyName]) {
                storeAnalysis[phone.storeName].families[familyName] = {
                    familyName: familyName,
                    phoneQty: 0, accessoryQty: 0,
                    phonesSet: new Set(), accessoriesSet: new Set()
                };
            }
            
            const group = storeAnalysis[phone.storeName].families[familyName];
            group.phoneQty += Number(phone.quantity);
            group.phonesSet.add(formatDisplayName(phone.description));
        });

        accessories.forEach(acc => {
            if(storeAnalysis[acc.storeName]) {
                const accFamily = getBaseModelFamily(acc.description);
                if (accFamily && storeAnalysis[acc.storeName].families[accFamily]) {
                    const group = storeAnalysis[acc.storeName].families[accFamily];
                    group.accessoryQty += Number(acc.quantity);
                    group.accessoriesSet.add(formatDisplayName(acc.description));
                }
            }
        });

        Object.values(storeAnalysis).forEach((store: any) => {
            Object.values(store.families).forEach((family: any) => {
                if (family.phoneQty > 0 || family.accessoryQty > 0) {
                    let status = 'BALANCED'; let action = 'OK';
                    const ratio = family.accessoryQty / (family.phoneQty || 1);

                    if (family.phoneQty > 0 && family.accessoryQty === 0) {
                        status = 'CRITICAL'; action = 'ENVIAR CAPAS URGENTE';
                    } else if (family.phoneQty > 0 && ratio < 0.8) {
                        status = 'WARNING'; action = 'AUMENTAR MIX';
                    } else if (family.phoneQty === 0 && family.accessoryQty > 0) {
                        status = 'DEAD_STOCK'; action = 'REMANEJAR CAPAS';
                    } else if (family.phoneQty > 0 && family.accessoryQty >= family.phoneQty) {
                        status = 'HEALTHY'; action = 'ESTOQUE SAUDÁVEL';
                    }

                    results.push({
                        region: store.region,
                        storeName: store.storeName,
                        familyName: family.familyName,
                        phoneQty: family.phoneQty,
                        accessoryQty: family.accessoryQty,
                        phonesList: Array.from(family.phonesSet),
                        accessoriesList: Array.from(family.accessoriesSet),
                        status, action, ratio
                    });
                }
            });
        });
    } 
    // ==========================================
    // LÓGICA 2: VISÃO POR PRODUTO (Macro)
    // ==========================================
    else {
        const productAnalysis: Record<string, any> = {};

        smartphones.forEach(phone => {
            const regiao = STORE_REGIONS[phone.storeName] || "OUTROS";
            if (regionFilter !== 'TODAS' && regiao !== regionFilter) return;
            if (storeFilter !== 'TODAS' && phone.storeName !== storeFilter) return;

            const familyName = getBaseModelFamily(phone.description);
            if (!familyName) return;

            if(!productAnalysis[familyName]) {
                productAnalysis[familyName] = {
                    familyName, phoneQty: 0, accessoryQty: 0,
                    phonesSet: new Set(), accessoriesSet: new Set(), storesSet: new Set()
                };
            }
            
            const group = productAnalysis[familyName];
            group.phoneQty += Number(phone.quantity);
            group.phonesSet.add(formatDisplayName(phone.description));
            if(Number(phone.quantity) > 0) group.storesSet.add(phone.storeName);
        });

        accessories.forEach(acc => {
            const regiao = STORE_REGIONS[acc.storeName] || "OUTROS";
            if (regionFilter !== 'TODAS' && regiao !== regionFilter) return;
            if (storeFilter !== 'TODAS' && acc.storeName !== storeFilter) return;

            const accFamily = getBaseModelFamily(acc.description);
            // Se for visão de produto, podemos mapear capas mesmo sem ter o celular na loja, 
            // desde que a família já exista (foi criada pelos celulares) OU criamos ela agora.
            if (accFamily) {
                if(!productAnalysis[accFamily]) {
                    productAnalysis[accFamily] = {
                        familyName: accFamily, phoneQty: 0, accessoryQty: 0,
                        phonesSet: new Set(), accessoriesSet: new Set(), storesSet: new Set()
                    };
                }
                const group = productAnalysis[accFamily];
                group.accessoryQty += Number(acc.quantity);
                group.accessoriesSet.add(formatDisplayName(acc.description));
                if(Number(acc.quantity) > 0) group.storesSet.add(acc.storeName);
            }
        });

        Object.values(productAnalysis).forEach((family: any) => {
            if (family.phoneQty > 0 || family.accessoryQty > 0) {
                let status = 'BALANCED'; let action = 'OK';
                const ratio = family.accessoryQty / (family.phoneQty || 1);

                if (family.phoneQty > 0 && family.accessoryQty === 0) {
                    status = 'CRITICAL'; action = 'FALTA CAPA NA REDE';
                } else if (family.phoneQty > 0 && ratio < 0.8) {
                    status = 'WARNING'; action = 'COMPRAR MAIS CAPAS';
                } else if (family.phoneQty === 0 && family.accessoryQty > 0) {
                    status = 'DEAD_STOCK'; action = 'CAPAS ENCALHADAS';
                } else if (family.phoneQty > 0 && family.accessoryQty >= family.phoneQty) {
                    status = 'HEALTHY'; action = 'COBERTURA SAUDÁVEL';
                }

                results.push({
                    region: "MÚLTIPLAS",
                    storeName: `${family.storesSet.size} LOJA(S)`, // Usado apenas para manter compatibilidade na UI
                    storesList: Array.from(family.storesSet).sort(),
                    familyName: family.familyName,
                    phoneQty: family.phoneQty,
                    accessoryQty: family.accessoryQty,
                    phonesList: Array.from(family.phonesSet),
                    accessoriesList: Array.from(family.accessoriesSet),
                    status, action, ratio
                });
            }
        });
    }

    return results.sort((a, b) => {
        const score = (s: string) => s === 'CRITICAL' ? 4 : s === 'DEAD_STOCK' ? 3 : s === 'WARNING' ? 2 : s === 'HEALTHY' ? 1 : 0;
        return score(b.status) - score(a.status);
    });
  }, [stockData, regionFilter, storeFilter, mainView]);

  // --- FILTRO FINAL DE EXIBIÇÃO ---
  const filteredDisplayData = smartAttachData.filter(item => {
      let matchesStatus = true;
      if (statusFilter === 'CRITICAL') matchesStatus = item.status === 'CRITICAL';
      if (statusFilter === 'WARNING') matchesStatus = item.status === 'WARNING';
      if (statusFilter === 'DEAD_STOCK') matchesStatus = item.status === 'DEAD_STOCK';
      if (statusFilter === 'HEALTHY') matchesStatus = ['HEALTHY', 'BALANCED'].includes(item.status);

      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = searchQuery === '' || 
          item.storeName.toLowerCase().includes(searchLower) ||
          item.familyName.toLowerCase().includes(searchLower) ||
          item.phonesList.join(' ').toLowerCase().includes(searchLower) ||
          (mainView === 'product' && item.storesList.join(' ').toLowerCase().includes(searchLower));

      return matchesStatus && matchesSearch;
  });

  const totals = useMemo(() => {
    return filteredDisplayData.reduce((acc, item) => {
        acc.phones += item.phoneQty;
        acc.accessories += item.accessoryQty;
        return acc;
    }, { phones: 0, accessories: 0 });
  }, [filteredDisplayData]);

  const handleExport = () => {
      const isStoreView = mainView === 'store';
      const headers = isStoreView 
          ? ["Loja", "Região", "Família", "Modelos Aparelho", "Qtd Celular", "Modelos Capa", "Qtd Capas", "Status", "Ação"]
          : ["Família", "Presente em Lojas", "Modelos Aparelho", "Qtd Celular", "Modelos Capa", "Qtd Capas", "Status", "Ação"];
      
      const csvRows = filteredDisplayData.map(item => {
          if (isStoreView) {
              return [`"${item.storeName}"`, `"${item.region}"`, `"${item.familyName}"`, `"${item.phonesList.join(' / ')}"`, item.phoneQty, `"${item.accessoriesList.join(' / ')}"`, item.accessoryQty, item.status, item.action].join(';');
          } else {
              return [`"${item.familyName}"`, `"${item.storesList.join(' / ')}"`, `"${item.phonesList.join(' / ')}"`, item.phoneQty, `"${item.accessoriesList.join(' / ')}"`, item.accessoryQty, item.status, item.action].join(';');
          }
      });
      const csvContent = "\uFEFF" + [headers.join(';'), ...csvRows].join('\n'); 
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
      link.setAttribute('download', `Estoque_Inteligente_${mainView}.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto font-sans bg-[#F0F2F5] min-h-screen relative">
      <div className="max-w-[1600px] mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-md shadow-indigo-200">
                    <LinkIcon size={20}/>
                </div>
                <div>
                    <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-800">
                        Estoque Inteligente
                    </h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Otimização de acessórios (celular + Capa)
                    </p>
                </div>
            </div>

            {/* BOTOES DE ALTERNÂNCIA DE MODO */}
            <div className="flex bg-slate-100 p-1 rounded-xl w-full md:w-auto">
                <button 
                    onClick={() => { setMainView('store'); setStoreFilter('TODAS'); }} 
                    className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-xs font-black uppercase transition-all flex justify-center items-center gap-2 ${mainView === 'store' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}
                >
                    <Store size={14}/> Por Loja
                </button>
                <button 
                    onClick={() => { setMainView('product'); setStoreFilter('TODAS'); }} 
                    className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-xs font-black uppercase transition-all flex justify-center items-center gap-2 ${mainView === 'product' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-indigo-500'}`}
                >
                    <Smartphone size={14}/> Por Produto
                </button>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
                <button onClick={loadData} disabled={loading} className={`flex-1 md:flex-none justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md flex items-center gap-2 ${loading ? 'opacity-50' : ''}`}>
                    {loading ? <RefreshCw size={14} className="animate-spin"/> : 'Atualizar'}
                </button>
                <button onClick={handleExport} className="p-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl transition-all" title="Exportar Relatório"><Download size={18}/></button>
            </div>
        </div>

        {/* FILTROS E RESUMO */}
        <div className="space-y-4 animate-fadeIn">
            
            {/* LINHA 1: BUSCA, REGIÃO, LOJA E TOTAIS */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200">
                <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
                    
                    <div className="relative w-full md:w-64 shrink-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                            type="text" 
                            placeholder={mainView === 'store' ? "Buscar loja ou modelo..." : "Buscar modelo..."} 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500">
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <MapPin className="text-indigo-600 shrink-0" size={20}/>
                        <select 
                            value={regionFilter} 
                            onChange={e => {
                                setRegionFilter(e.target.value);
                                setStoreFilter('TODAS');
                            }} 
                            className="w-full md:w-auto bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase px-3 py-2 rounded-lg outline-none cursor-pointer hover:border-indigo-300"
                        >
                            <option value="TODAS">Todas Regiões</option>
                            {uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <Store className="text-indigo-600 shrink-0" size={20}/>
                        <select 
                            value={storeFilter} 
                            onChange={e => setStoreFilter(e.target.value)} 
                            className="w-full md:max-w-[200px] bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase px-3 py-2 rounded-lg outline-none cursor-pointer hover:border-indigo-300 truncate"
                        >
                            <option value="TODAS">Todas as Lojas</option>
                            {availableStores.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex flex-wrap md:flex-nowrap gap-4 md:gap-6 border-t xl:border-t-0 xl:border-l border-slate-100 pt-4 xl:pt-0 xl:pl-6 w-full xl:w-auto justify-center md:justify-end shrink-0">
                    <div className="text-center">
                        <span className="block text-xl md:text-2xl font-black text-slate-800">{filteredDisplayData.length}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Listados</span>
                    </div>
                    <div className="text-center">
                        <span className="block text-xl md:text-2xl font-black text-slate-800">{totals.phones}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Aparelhos</span>
                    </div>
                    <div className="text-center">
                        <span className="block text-xl md:text-2xl font-black text-indigo-600">{totals.accessories}</span>
                        <span className="text-[9px] font-bold text-indigo-400 uppercase">Capas</span>
                    </div>
                    <div className="flex flex-row md:flex-col justify-center gap-1 border-l border-slate-100 pl-4 ml-2">
                        <button onClick={() => setViewMode('grid')} title="Visão em Grade" className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <LayoutGrid size={16}/>
                        </button>
                        <button onClick={() => setViewMode('list')} title="Visão em Lista" className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <ListIcon size={16}/>
                        </button>
                    </div>
                </div>
            </div>

            {/* LINHA 2: FILTROS RÁPIDOS (PILLS) */}
            <div className="flex bg-white p-2 rounded-xl border border-slate-200 shadow-sm w-full overflow-x-auto gap-2 scrollbar-hide">
                <button 
                    onClick={() => setStatusFilter('TODOS')}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap ${statusFilter === 'TODOS' ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                >
                    Todos ({smartAttachData.length})
                </button>
                <button 
                    onClick={() => setStatusFilter('CRITICAL')}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap flex items-center gap-1 ${statusFilter === 'CRITICAL' ? 'bg-red-500 text-white shadow-md' : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100'}`}
                >
                    🚨 Urgente ({smartAttachData.filter(i => i.status === 'CRITICAL').length})
                </button>
                <button 
                    onClick={() => setStatusFilter('WARNING')}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap flex items-center gap-1 ${statusFilter === 'WARNING' ? 'bg-orange-500 text-white shadow-md' : 'bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-100'}`}
                >
                    ⚠️ Mix Baixo ({smartAttachData.filter(i => i.status === 'WARNING').length})
                </button>
                <button 
                    onClick={() => setStatusFilter('HEALTHY')}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap flex items-center gap-1 ${statusFilter === 'HEALTHY' ? 'bg-green-500 text-white shadow-md' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-100'}`}
                >
                    ✅ Saudável ({smartAttachData.filter(i => ['HEALTHY', 'BALANCED'].includes(i.status)).length})
                </button>
                <button 
                    onClick={() => setStatusFilter('DEAD_STOCK')}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap flex items-center gap-1 ${statusFilter === 'DEAD_STOCK' ? 'bg-yellow-400 text-white shadow-md' : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100 border border-yellow-100'}`}
                >
                    📦 Capa Parada ({smartAttachData.filter(i => i.status === 'DEAD_STOCK').length})
                </button>
            </div>

            {/* RENDERIZAÇÃO: LISTA OU GRADE */}
            {viewMode === 'list' ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-4">
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase">{mainView === 'store' ? 'Loja' : 'Abrangência'}</th>
                                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Família / Aparelho</th>
                                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase text-center">Aparelhos</th>
                                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase text-center">Capas</th>
                                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase text-center">Status</th>
                                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Ação</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredDisplayData.map((item, idx) => {
                                    const isCritical = item.status === 'CRITICAL';
                                    const isDead = item.status === 'DEAD_STOCK';
                                    const isWarning = item.status === 'WARNING';
                                    const isHealthy = item.status === 'HEALTHY' || item.status === 'BALANCED';

                                    return (
                                        <tr 
                                            key={idx} 
                                            onClick={() => setSelectedItem(item)}
                                            className="hover:bg-slate-50 transition-colors cursor-pointer group"
                                        >
                                            <td className="p-4 text-xs font-bold text-slate-700 uppercase whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    {mainView === 'store' ? <Store size={12} className="text-slate-400 group-hover:text-indigo-500 transition-colors"/> : <MapPin size={12} className="text-slate-400 group-hover:text-indigo-500 transition-colors"/>}
                                                    {item.storeName}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="text-xs font-black text-slate-800 uppercase">{item.familyName}</div>
                                                <div className="text-[10px] text-slate-400 truncate max-w-[200px] mt-0.5" title={item.phonesList.join(', ')}>
                                                    {item.phonesList.join(', ')}
                                                </div>
                                            </td>
                                            <td className="p-4 text-sm font-black text-slate-800 text-center">{item.phoneQty}</td>
                                            <td className="p-4 text-sm font-black text-indigo-600 text-center">{item.accessoryQty}</td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 inline-block rounded text-[9px] font-black uppercase whitespace-nowrap ${
                                                    isCritical ? 'bg-red-100 text-red-600' : 
                                                    isDead ? 'bg-yellow-100 text-yellow-700' : 
                                                    isHealthy ? 'bg-green-100 text-green-700' : 
                                                    'bg-orange-100 text-orange-700'
                                                }`}>
                                                    {isCritical ? 'Urgente' : isDead ? 'Capa Parada' : isHealthy ? 'Saudável' : 'Mix Baixo'}
                                                </span>
                                            </td>
                                            <td className="p-4 text-[10px] font-bold uppercase whitespace-nowrap flex items-center justify-between">
                                                <span className={`${isCritical ? 'text-red-500' : isDead ? 'text-yellow-600' : isHealthy ? 'text-green-500' : 'text-orange-500'}`}>
                                                    {item.action}
                                                </span>
                                                <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
                    {filteredDisplayData.map((item, idx) => {
                        const isCritical = item.status === 'CRITICAL';
                        const isDead = item.status === 'DEAD_STOCK';
                        const isWarning = item.status === 'WARNING';
                        const isHealthy = item.status === 'HEALTHY' || item.status === 'BALANCED';
                        
                        return (
                            <div 
                                key={idx} 
                                onClick={() => setSelectedItem(item)}
                                className={`bg-white p-5 rounded-2xl border shadow-sm relative overflow-hidden group flex flex-col justify-between cursor-pointer hover:-translate-y-1 hover:shadow-md transition-all ${isCritical ? 'border-red-200 ring-1 ring-red-100 hover:border-red-300' : isDead ? 'border-yellow-200 bg-yellow-50/20 hover:border-yellow-300' : isHealthy ? 'border-green-200 bg-green-50/20 hover:border-green-300' : 'border-orange-200 hover:border-orange-300'}`}
                            >
                                <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[10px] font-black uppercase tracking-wide ${isCritical ? 'bg-red-500 text-white' : isDead ? 'bg-yellow-400 text-white' : isHealthy ? 'bg-green-500 text-white' : 'bg-orange-400 text-white'}`}>
                                    {item.action}
                                </div>
                                
                                <div className="mb-4">
                                    <p className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1">
                                        {mainView === 'store' ? <Store size={10}/> : <MapPin size={10}/>} {item.storeName}
                                    </p>
                                    <h3 className="text-base font-black text-slate-800 uppercase mt-1">FAMÍLIA {item.familyName}</h3>
                                </div>

                                <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100 mb-4 group-hover:bg-white transition-colors">
                                    <div className="text-center flex-1">
                                        <Smartphone size={16} className="mx-auto text-slate-400 mb-1"/>
                                        <span className="block text-xl font-black text-slate-800">{item.phoneQty}</span>
                                        <span className="text-[8px] uppercase font-bold text-slate-400">Celulares</span>
                                    </div>
                                    
                                    {isHealthy ? (
                                        <CheckCircle size={20} className="text-green-500 shrink-0 mx-2" />
                                    ) : (
                                        <div className="h-8 w-px bg-slate-200 mx-4"></div>
                                    )}

                                    <div className="text-center flex-1">
                                        <Layers size={16} className="mx-auto text-slate-400 mb-1"/>
                                        <span className={`block text-xl font-black ${isCritical ? 'text-red-500' : 'text-indigo-600'}`}>{item.accessoryQty}</span>
                                        <span className="text-[8px] uppercase font-bold text-slate-400">Acessórios</span>
                                    </div>
                                </div>

                                <div className="space-y-2 mt-auto">
                                    {item.phonesList.length > 0 && (
                                        <div className="text-[9px] text-slate-600 bg-white border border-slate-100 p-2 rounded-lg">
                                            <span className="font-bold block mb-1 text-slate-400">📱 APARELHOS NO ESTOQUE:</span>
                                            {item.phonesList.map((p:string, i:number) => (
                                                <div key={i} className="truncate">• {p}</div>
                                            ))}
                                        </div>
                                    )}

                                    {item.accessoriesList.length > 0 ? (
                                        <div className="text-[9px] text-slate-600 bg-indigo-50/50 border border-indigo-100 p-2 rounded-lg">
                                            <span className="font-bold block mb-1 text-indigo-400">🛡️ CAPAS COMPATÍVEIS:</span>
                                            {item.accessoriesList.slice(0, 3).map((acc:string, i:number) => (
                                                <div key={i} className="truncate">• {acc}</div>
                                            ))}
                                            {item.accessoriesList.length > 3 && (
                                                <div className="font-bold mt-1 text-indigo-500">+ {item.accessoriesList.length - 3} outros modelos...</div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-[9px] text-red-500 bg-red-50 p-2 rounded-lg font-bold flex items-center gap-2">
                                            <AlertCircle size={12}/> NENHUMA CAPA PARA ESTE MODELO
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4 text-[9px] font-bold text-center text-slate-400 group-hover:text-indigo-500 transition-colors">
                                    CLIQUE PARA VER DETALHES
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            
            {filteredDisplayData.length === 0 && !loading && (
                <div className="p-20 text-center text-slate-400 font-bold uppercase text-sm bg-white rounded-2xl border border-dashed">
                    Nenhuma combinação encontrada para os filtros aplicados.
                </div>
            )}
        </div>
      </div>

      {/* ================= MODAL DE DETALHES ================= */}
      {selectedItem && (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn"
            onClick={() => setSelectedItem(null)} // Clicar fora fecha o modal
        >
            <div 
                className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
                onClick={(e) => e.stopPropagation()} // Previne que o clique dentro do modal feche ele
            >
                {/* Header do Modal */}
                <div className={`p-6 border-b flex justify-between items-start ${
                    selectedItem.status === 'CRITICAL' ? 'bg-red-50 border-red-100' : 
                    selectedItem.status === 'DEAD_STOCK' ? 'bg-yellow-50 border-yellow-100' : 
                    selectedItem.status === 'WARNING' ? 'bg-orange-50 border-orange-100' : 
                    'bg-green-50 border-green-100'
                }`}>
                    <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-[10px] font-black bg-white px-2 py-1 rounded shadow-sm text-slate-600 uppercase flex items-center gap-1">
                                {mainView === 'store' ? <Store size={10} /> : <MapPin size={10}/>} {selectedItem.storeName}
                            </span>
                            {mainView === 'store' && (
                                <span className="text-[10px] font-black bg-slate-800 text-white px-2 py-1 rounded shadow-sm uppercase">
                                    {selectedItem.region}
                                </span>
                            )}
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-slate-800 uppercase tracking-tight">
                            FAMÍLIA {selectedItem.familyName}
                        </h2>
                        <p className={`text-xs font-bold mt-2 uppercase flex items-center gap-1 ${
                            selectedItem.status === 'CRITICAL' ? 'text-red-600' : 
                            selectedItem.status === 'DEAD_STOCK' ? 'text-yellow-600' : 
                            selectedItem.status === 'WARNING' ? 'text-orange-600' : 
                            'text-green-600'
                        }`}>
                            <AlertCircle size={14} /> Ação Necessária: {selectedItem.action}
                        </p>
                    </div>
                    <button 
                        onClick={() => setSelectedItem(null)} 
                        className="p-2 bg-white rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shadow-sm"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Corpo do Modal */}
                <div className="p-6 overflow-y-auto flex-1 bg-slate-50">
                    
                    {/* Resumo Numérico */}
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                                <Smartphone size={24} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Total Aparelhos</p>
                                <p className="text-2xl font-black text-slate-800">{selectedItem.phoneQty}</p>
                            </div>
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                                <Layers size={24} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Total Capas</p>
                                <p className={`text-2xl font-black ${selectedItem.accessoryQty === 0 ? 'text-red-500' : 'text-indigo-600'}`}>
                                    {selectedItem.accessoryQty}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Coluna Celulares */}
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                            <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 shrink-0">
                                <h3 className="text-xs font-black text-slate-700 uppercase flex items-center gap-2">
                                    📱 Modelos Físicos ({selectedItem.phonesList.length})
                                </h3>
                            </div>
                            <div className="p-4 space-y-2 flex-1">
                                {selectedItem.phonesList.length > 0 ? (
                                    selectedItem.phonesList.map((phone: string, i: number) => (
                                        <div key={i} className="text-xs font-bold text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                            {phone}
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-xs text-slate-400 text-center py-4 italic">Nenhum aparelho desta família.</div>
                                )}
                            </div>
                        </div>

                        {/* Coluna Capas */}
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                            <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-100 shrink-0">
                                <h3 className="text-xs font-black text-indigo-800 uppercase flex items-center gap-2">
                                    🛡️ Capas Compatíveis ({selectedItem.accessoriesList.length})
                                </h3>
                            </div>
                            <div className="p-4 space-y-2 flex-1">
                                {selectedItem.accessoriesList.length > 0 ? (
                                    selectedItem.accessoriesList.map((acc: string, i: number) => (
                                        <div key={i} className="text-xs font-bold text-slate-600 bg-indigo-50/30 p-3 rounded-xl border border-indigo-50">
                                            {acc}
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-xs text-red-500 bg-red-50 p-4 rounded-xl border border-red-100 font-bold flex flex-col items-center justify-center text-center gap-2 h-full">
                                        <ShieldAlert size={24} />
                                        Nenhuma capa disponível para atender a demanda destes aparelhos.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* NOVO: Lojas com o Produto (Aparece apenas na Visão por Produto) */}
                    {mainView === 'product' && selectedItem.storesList && (
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm mt-6">
                            <div className="bg-slate-800 px-4 py-3 border-b border-slate-700">
                                <h3 className="text-xs font-black text-white uppercase flex items-center gap-2">
                                    <Package size={14} /> Lojas com estoque físico ({selectedItem.storesList.length})
                                </h3>
                            </div>
                            <div className="p-4 flex flex-wrap gap-2 bg-slate-50">
                                {selectedItem.storesList.length > 0 ? (
                                    selectedItem.storesList.map((loja: string, i: number) => (
                                        <span key={i} className="text-[10px] font-black text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
                                            {loja}
                                        </span>
                                    ))
                                ) : (
                                    <div className="text-xs text-slate-400 italic w-full text-center">Nenhuma loja com estoque no momento.</div>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
      )}
      
    </div>
  );
}