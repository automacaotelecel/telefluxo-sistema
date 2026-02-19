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
  ArrowRight,
  Search,
  X,
  Store
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
  
  // Estados de Filtro
  const [regionFilter, setRegionFilter] = useState('TODAS');
  const [storeFilter, setStoreFilter] = useState('TODAS');
  // NOVO: Estado para o filtro rápido em vez de abas
  const [statusFilter, setStatusFilter] = useState('TODOS'); 
  const [searchQuery, setSearchQuery] = useState('');

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

  const uniqueRegions = useMemo(() => Array.from(new Set(Object.values(STORE_REGIONS))).sort(), []);
  const availableStores = useMemo(() => {
      let stores = Object.keys(STORE_REGIONS);
      if (regionFilter !== 'TODAS') {
          stores = stores.filter(store => STORE_REGIONS[store] === regionFilter);
      }
      return stores.sort();
  }, [regionFilter]);

  // --- ALGORITMO SMART ATTACH BASEADO EM FAMÍLIAS ---
  const smartAttachData = useMemo(() => {
    if (stockData.length === 0) return [];

    const storeAnalysis: Record<string, any> = {};

    const smartphones = stockData.filter(i => {
        const cat = (i.category || '').toUpperCase();
        return cat.includes('SMARTPHONE') || cat.includes('CELULAR') || cat.includes('TELEFONE');
    });
    
    const accessories = stockData.filter(i => {
        const cat = (i.category || '').toUpperCase();
        const desc = (i.description || '').toUpperCase();
        return cat.includes('ACESS') || cat.includes('CAPA') || desc.startsWith('CAPA') || desc.startsWith('PELICULA') || desc.includes('CASE');
    });

    smartphones.forEach(phone => {
        const regiao = STORE_REGIONS[phone.storeName] || "OUTROS";
        if (regionFilter !== 'TODAS' && regiao !== regionFilter) return;

        const familyName = getBaseModelFamily(phone.description);
        if (!familyName) return;

        if(!storeAnalysis[phone.storeName]) {
            storeAnalysis[phone.storeName] = { storeName: phone.storeName, region: regiao, families: {} };
        }

        if(!storeAnalysis[phone.storeName].families[familyName]) {
            storeAnalysis[phone.storeName].families[familyName] = {
                familyName: familyName,
                phoneQty: 0,
                accessoryQty: 0,
                phonesList: [],
                accessoriesList: [] 
            };
        }
        
        const group = storeAnalysis[phone.storeName].families[familyName];
        group.phoneQty += Number(phone.quantity);
        
        const prettyPhoneName = formatDisplayName(phone.description);
        if (!group.phonesList.includes(prettyPhoneName)) {
            group.phonesList.push(prettyPhoneName);
        }
    });

    accessories.forEach(acc => {
        if(storeAnalysis[acc.storeName]) {
            const accFamily = getBaseModelFamily(acc.description);
            
            if (accFamily && storeAnalysis[acc.storeName].families[accFamily]) {
                const group = storeAnalysis[acc.storeName].families[accFamily];
                group.accessoryQty += Number(acc.quantity);
                
                const prettyAccName = formatDisplayName(acc.description);
                if (!group.accessoriesList.includes(prettyAccName)) {
                    group.accessoriesList.push(prettyAccName);
                }
            }
        }
    });

    const results: any[] = [];
    Object.values(storeAnalysis).forEach((store: any) => {
        Object.values(store.families).forEach((family: any) => {
            if (family.phoneQty > 0 || family.accessoryQty > 0) {
                let status = 'BALANCED';
                let action = 'OK';
                const ratio = family.accessoryQty / (family.phoneQty || 1);

                if (family.phoneQty > 0 && family.accessoryQty === 0) {
                    status = 'CRITICAL';
                    action = 'ENVIAR CAPAS URGENTE';
                } else if (family.phoneQty > 0 && ratio < 0.8) {
                    status = 'WARNING';
                    action = 'AUMENTAR MIX';
                } else if (family.phoneQty === 0 && family.accessoryQty > 0) {
                    status = 'DEAD_STOCK';
                    action = 'REMANEJAR CAPAS';
                } else if (family.phoneQty > 0 && family.accessoryQty >= family.phoneQty) {
                    status = 'HEALTHY'; 
                    action = 'ESTOQUE SAUDÁVEL';
                }

                results.push({
                    region: store.region,
                    storeName: store.storeName,
                    ...family,
                    status,
                    action,
                    ratio
                });
            }
        });
    });

    return results.sort((a, b) => {
        const score = (s: string) => s === 'CRITICAL' ? 4 : s === 'DEAD_STOCK' ? 3 : s === 'WARNING' ? 2 : s === 'HEALTHY' ? 1 : 0;
        return score(b.status) - score(a.status);
    });
  }, [stockData, regionFilter]);

  // --- FILTRO FINAL DE EXIBIÇÃO (ATUALIZADO COM OS FILTROS RÁPIDOS) ---
  const filteredDisplayData = smartAttachData.filter(item => {
      // Filtro Rápido (Pills)
      let matchesStatus = true;
      if (statusFilter === 'CRITICAL') matchesStatus = item.status === 'CRITICAL';
      if (statusFilter === 'WARNING') matchesStatus = item.status === 'WARNING';
      if (statusFilter === 'DEAD_STOCK') matchesStatus = item.status === 'DEAD_STOCK';
      if (statusFilter === 'HEALTHY') matchesStatus = ['HEALTHY', 'BALANCED'].includes(item.status);

      const matchesStore = storeFilter === 'TODAS' || item.storeName === storeFilter;

      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = searchQuery === '' || 
          item.storeName.toLowerCase().includes(searchLower) ||
          item.familyName.toLowerCase().includes(searchLower) ||
          item.phonesList.join(' ').toLowerCase().includes(searchLower);

      return matchesStatus && matchesStore && matchesSearch;
  });

  const handleExport = () => {
      const headers = ["Loja", "Região", "Família", "Modelos Aparelho", "Qtd Celular", "Modelos Capa", "Qtd Capas", "Status", "Ação"];
      const csvRows = filteredDisplayData.map(item => {
          return [
              `"${item.storeName}"`, 
              `"${item.region}"`, 
              `"${item.familyName}"`,
              `"${item.phonesList.join(' / ')}"`,
              item.phoneQty, 
              `"${item.accessoriesList.join(' / ')}"`,
              item.accessoryQty, 
              item.status, 
              item.action
            ].join(';');
      });
      const csvContent = "\uFEFF" + [headers.join(';'), ...csvRows].join('\n'); 
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
      link.setAttribute('download', `Estoque_Inteligente.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto font-sans bg-[#F0F2F5] min-h-screen">
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

            <div className="flex gap-2">
                <button onClick={loadData} disabled={loading} className={`px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md flex items-center gap-2 ${loading ? 'opacity-50' : ''}`}>
                    {loading ? <RefreshCw size={14} className="animate-spin"/> : 'Atualizar'}
                </button>
                <button onClick={handleExport} className="p-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl transition-all" title="Exportar Relatório"><Download size={18}/></button>
            </div>
        </div>

        {/* FILTROS E RESUMO */}
        <div className="space-y-4 animate-fadeIn">
            
            {/* LINHA 1: BUSCA, REGIÃO E LOJA */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200">
                <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
                    
                    <div className="relative w-full md:w-64 shrink-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                            type="text" 
                            placeholder="Buscar loja ou modelo..." 
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

                <div className="flex gap-4 border-t xl:border-t-0 xl:border-l border-slate-100 pt-4 xl:pt-0 xl:pl-4 w-full xl:w-auto justify-center shrink-0">
                    <div className="text-center px-4">
                        <span className="block text-2xl font-black text-slate-800">{filteredDisplayData.length}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Listados</span>
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

            {/* LISTAGEM DE CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
                {filteredDisplayData.map((item, idx) => {
                    const isCritical = item.status === 'CRITICAL';
                    const isDead = item.status === 'DEAD_STOCK';
                    const isWarning = item.status === 'WARNING';
                    const isHealthy = item.status === 'HEALTHY' || item.status === 'BALANCED';
                    
                    return (
                        <div key={idx} className={`bg-white p-5 rounded-2xl border shadow-sm relative overflow-hidden group flex flex-col justify-between ${isCritical ? 'border-red-200 ring-1 ring-red-100' : isDead ? 'border-yellow-200 bg-yellow-50/20' : isHealthy ? 'border-green-200 bg-green-50/20' : 'border-orange-200'}`}>
                            <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[10px] font-black uppercase tracking-wide ${isCritical ? 'bg-red-500 text-white' : isDead ? 'bg-yellow-400 text-white' : isHealthy ? 'bg-green-500 text-white' : 'bg-orange-400 text-white'}`}>
                                {item.action}
                            </div>
                            
                            <div className="mb-4">
                                <p className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1"><Store size={10}/> {item.storeName}</p>
                                <h3 className="text-base font-black text-slate-800 uppercase mt-1">FAMÍLIA {item.familyName}</h3>
                            </div>

                            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100 mb-4">
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

                            {/* LISTA LIMPA DE APARELHOS E CAPAS */}
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
                        </div>
                    );
                })}
            </div>
            
            {filteredDisplayData.length === 0 && !loading && (
                <div className="p-20 text-center text-slate-400 font-bold uppercase text-sm bg-white rounded-2xl border border-dashed">
                    Nenhuma combinação encontrada para os filtros aplicados.
                </div>
            )}
        </div>
      </div>
    </div>
  );
}