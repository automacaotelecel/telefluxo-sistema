import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, X, MapPin, Store, AlertTriangle, 
  Activity, Download, RefreshCw, 
  ChevronRight, ChevronDown, ChevronUp, PackageX, Layers, Smartphone, AlertCircle
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

const getLineValue = (item: any) =>
  String(item.emLinha || item.em_linha || item.linha || 'SEM LINHA')
    .trim()
    .toUpperCase();

// --- 1. FILTRO DIRETO POR CATEGORIA ---
const isSmartphoneItem = (item: any) => {
    const cat = String(item.category || '').toUpperCase().trim();
    return cat === 'SMARTPHONE' || cat === 'CELULAR' || cat === 'APARELHO';
};

// --- 2. AGRUPADOR DE MODELOS ---
const getSpecificModel = (fullName: string) => {
    if (!fullName) return null;
    let str = fullName.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    str = str.replace(/\+/g, ' PLUS ');

    let baseName = "";

    if (str.includes("IPHONE")) {
        let m = str.match(/IPHONE\s\d{1,2}/);
        baseName = m ? m[0] : "IPHONE";
    } else if (str.match(/\b(S\d{2}|[AMF]\d{2}|Z\s?FOLD\s?\d|Z\s?FLIP\s?\d|FOLD\s?\d|FLIP\s?\d)\b/)) {
        let m = str.match(/\b(S\d{2}|[AMF]\d{2}|Z\s?FOLD\s?\d|Z\s?FLIP\s?\d|FOLD\s?\d|FLIP\s?\d)\b/);
        baseName = `GALAXY ${m[0].replace(/\s+/g, '')}`; 
    } else if (str.includes("MOTO G") || str.includes("EDGE")) {
         let m = str.match(/\b(MOTO\s?G\d{2}|EDGE\s\d{2})\b/);
         baseName = m ? m[0] : "MOTOROLA";
    } else if (str.includes("REDMI") || str.includes("POCO")) {
         let m = str.match(/\b(REDMI\sNOTE\s\d{1,2}|REDMI\s\d{1,2}|POCO\s[A-Z]\d{1,2})\b/);
         baseName = m ? m[0] : "XIAOMI";
    }

    if (!baseName) {
        let clean = str.replace(/SMARTPHONE|CELULAR|TELEFONE|APARELHO|SAMSUNG|MOTOROLA|APPLE|XIAOMI/g, "").trim();
        baseName = clean.split(' ').slice(0, 2).join(' '); 
    }

    let modifiers = [];
    if (str.includes("PRO MAX")) modifiers.push("PRO MAX");
    else if (str.includes("PRO PLUS")) modifiers.push("PRO PLUS");
    else {
        if (str.includes("PRO")) modifiers.push("PRO");
        if (str.match(/\bMAX\b/) && !str.includes("PRO MAX")) modifiers.push("MAX");
        if (str.includes("ULTRA")) modifiers.push("ULTRA");
        if (str.includes("PLUS")) modifiers.push("PLUS");
        if (str.match(/\bFE\b/)) modifiers.push("FE");
        if (str.includes("MINI")) modifiers.push("MINI");
        if (str.includes("NEO")) modifiers.push("NEO");
    }
    let modifierStr = modifiers.length > 0 ? " " + modifiers.join(" ") : "";
    let is5G = str.match(/\b5G\b/) ? " 5G" : "";

    let storage = "";
    let storageMatch = str.match(/\b(\d{2,4})\s?(GB|TB)\b/);
    if (storageMatch) storage = ` ${storageMatch[1]}${storageMatch[2]}`;

    return `${baseName}${modifierStr}${is5G}${storage}`.trim();
};

export default function Stockout() {
  const [stockData, setStockData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [regionFilter, setRegionFilter] = useState('TODAS');
  const [storeFilter, setStoreFilter] = useState('TODAS');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Controle de qual modelo está expandido na tabela
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const isLocal = window.location.hostname === 'localhost' || /^[0-9.]+$/.test(window.location.hostname);
  const API_URL = isLocal ? `http://${window.location.hostname}:3000` : 'https://telefluxo-aplicacao.onrender.com';

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
      let stores = Object.keys(STORE_REGIONS).filter(s => s !== "CD TAGUATINGA" && s !== "CD");
      if (regionFilter !== 'TODAS') {
          stores = stores.filter(store => STORE_REGIONS[store] === regionFilter);
      }
      return stores.sort();
  }, [regionFilter]);

  const stockoutAnalysis = useMemo(() => {
      if (stockData.length === 0) return { models: [], totalModels: 0, totalCriticalPoints: 0, healthRate: 0 };

      // 1. Filtrar base ativa
      const activeSmartphones = stockData.filter(i => {
          const linha = getLineValue(i);
          const inLine = linha === 'SIM' || linha === 'S' || linha.includes('EM LINHA') || linha === 'TRUE' || linha === 'ATIVO';
          return isSmartphoneItem(i) && inLine;
      });

      // 2. Levantar todos os modelos base únicos
      const uniqueModels = new Set(activeSmartphones.map(s => getSpecificModel(s.description)).filter(Boolean));
      const modelMap = new Map();

      // 3. Inicializar o mapa com todas as lojas válidas zeradas para cada modelo
      uniqueModels.forEach(model => {
          const storesData: Record<string, any> = {};
          availableStores.forEach(store => {
              storesData[store] = { 
                  name: store, 
                  region: STORE_REGIONS[store], 
                  qty: 0, 
                  variations: [] 
              };
          });
          modelMap.set(model, {
              modelName: model,
              totalQty: 0,
              stores: storesData
          });
      });

      // 4. Preencher com os dados reais e variações (cores, etc)
      activeSmartphones.forEach(item => {
          const store = item.storeName;
          if (!availableStores.includes(store)) return; // Ignora se não estiver nos filtros de loja atuais

          const model = getSpecificModel(item.description);
          if (!model || !modelMap.has(model)) return;

          const qty = Number(item.quantity) || 0;
          const group = modelMap.get(model);
          
          group.totalQty += qty;
          group.stores[store].qty += qty;
          
          if (qty > 0) {
              group.stores[store].variations.push({
                  desc: item.description,
                  qty: qty
              });
          }
      });

      // 5. Consolidar e calcular métricas por modelo
      let totalCriticalPoints = 0;
      let totalPoints = 0;

      const analysisList = Array.from(modelMap.values()).map(group => {
          // Converte o objeto de lojas em array e ordena (as com menos estoque primeiro)
          const storesList = Object.values(group.stores).sort((a: any, b: any) => a.qty - b.qty);
          
          const storesOk = storesList.filter((s: any) => s.qty >= 2).length;
          const storesCritical = storesList.filter((s: any) => s.qty === 1).length;
          const storesStockout = storesList.filter((s: any) => s.qty === 0).length;

          totalCriticalPoints += (storesCritical + storesStockout);
          totalPoints += storesList.length;

          return {
              ...group,
              storesList,
              storesOk,
              storesCritical,
              storesStockout
          };
      });

      // Ordenar a lista principal: Modelos com mais lojas zeradas/críticas aparecem no topo
      analysisList.sort((a, b) => {
          const aIssues = a.storesStockout + a.storesCritical;
          const bIssues = b.storesStockout + b.storesCritical;
          if (bIssues !== aIssues) return bIssues - aIssues;
          return a.modelName.localeCompare(b.modelName);
      });

      const healthRate = totalPoints > 0 ? ((totalPoints - totalCriticalPoints) / totalPoints) * 100 : 0;

      return { 
          models: analysisList, 
          totalModels: uniqueModels.size, 
          totalCriticalPoints, 
          healthRate 
      };
  }, [stockData, availableStores]);

  const displayData = useMemo(() => {
      const searchLower = searchQuery.toLowerCase();
      let data = stockoutAnalysis.models;

      if (storeFilter !== 'TODAS') {
          data = data.filter(item => item.storesList.some((s: any) => s.name === storeFilter));
      }

      if (!searchLower) return data;

      return data.filter(item => item.modelName.toLowerCase().includes(searchLower));
  }, [stockoutAnalysis.models, searchQuery, storeFilter]);

  const handleExport = () => {
      const headers = ["Modelo", "Qtd Total Rede", "Lojas Abastecidas (>=2)", "Lojas Críticas (=1)", "Lojas Zeradas (=0)"];
      const csvRows = displayData.map(item => {
          return [`"${item.modelName}"`, item.totalQty, item.storesOk, item.storesCritical, item.storesStockout].join(';');
      });
      const csvContent = "\uFEFF" + [headers.join(';'), ...csvRows].join('\n'); 
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
      link.setAttribute('download', `Stockout_Por_Modelo.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const toggleRow = (modelName: string) => {
      if (expandedModel === modelName) setExpandedModel(null);
      else setExpandedModel(modelName);
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto font-sans bg-[#F0F2F5] min-h-screen relative">
      <div className="max-w-[1600px] mx-auto space-y-6 animate-fadeIn">
        
        {/* HEADER E FILTROS */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3">
                <div className="p-2.5 bg-slate-800 rounded-xl text-white shadow-md">
                    <Layers size={20}/>
                </div>
                <div>
                    <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-800">
                        Cobertura de Aparelhos
                    </h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Análise de StockOut
                    </p>
                </div>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto">
                <div className="relative w-full md:w-64 shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                        type="text" 
                        placeholder="Buscar modelo..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-slate-500"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500">
                            <X size={14} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                    <MapPin className="text-slate-500 shrink-0" size={20}/>
                    <select 
                        value={regionFilter} 
                        onChange={e => {
                            setRegionFilter(e.target.value);
                            setStoreFilter('TODAS');
                        }} 
                        className="w-full md:w-auto bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase px-3 py-2 rounded-lg outline-none cursor-pointer hover:border-slate-300"
                    >
                        <option value="TODAS">Todas Regiões</option>
                        {uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                    <Store className="text-slate-500 shrink-0" size={20}/>
                    <select 
                        value={storeFilter} 
                        onChange={e => setStoreFilter(e.target.value)} 
                        className="w-full md:max-w-[200px] bg-white border border-slate-200 text-slate-600 text-xs font-bold uppercase px-3 py-2 rounded-lg outline-none cursor-pointer hover:border-slate-300 truncate"
                    >
                        <option value="TODAS">Todas as Lojas</option>
                        {availableStores.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>

                <div className="flex gap-2 w-full md:w-auto ml-auto">
                    <button onClick={loadData} disabled={loading} className={`flex-1 md:flex-none justify-center px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md flex items-center gap-2 ${loading ? 'opacity-50' : ''}`}>
                        {loading ? <RefreshCw size={14} className="animate-spin"/> : 'Atualizar'}
                    </button>
                    <button onClick={handleExport} className="p-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl transition-all shadow-sm" title="Exportar Relatório"><Download size={18}/></button>
                </div>
            </div>
        </div>

        {/* CARDS DE KPIS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-slate-50 rounded-full group-hover:scale-110 transition-transform"></div>
                <div className="flex items-center gap-3 mb-4 relative z-10">
                    <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
                        <Smartphone size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mix de Aparelhos</p>
                        <h3 className="text-3xl font-black text-slate-800">{stockoutAnalysis.totalModels}</h3>
                    </div>
                </div>
                <p className="text-xs font-bold text-slate-500 uppercase relative z-10">Modelos em Linha</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-red-100 shadow-sm flex flex-col relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-red-50 rounded-full group-hover:scale-110 transition-transform"></div>
                <div className="flex items-center gap-3 mb-4 relative z-10">
                    <div className="p-3 bg-red-100 text-red-600 rounded-xl">
                        <AlertTriangle size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pontos Críticos</p>
                        <h3 className="text-3xl font-black text-slate-800">{stockoutAnalysis.totalCriticalPoints}</h3>
                    </div>
                </div>
                <p className="text-xs font-bold text-slate-500 uppercase relative z-10">Combinações Loja x Modelo com &lt; 2 und</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm flex flex-col relative overflow-hidden group">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-50 rounded-full group-hover:scale-110 transition-transform"></div>
                <div className="flex items-center gap-3 mb-4 relative z-10">
                    <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                        <Activity size={24} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saúde da Cobertura</p>
                        <h3 className="text-3xl font-black text-slate-800">{stockoutAnalysis.healthRate.toFixed(1)}%</h3>
                    </div>
                </div>
                <p className="text-xs font-bold text-slate-500 uppercase relative z-10">Rede abastecida com margem de segurança</p>
            </div>
        </div>

        {/* TABELA DE MODELOS E ACORDEÃO DAS LOJAS */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase">Modelo</th>
                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase text-center">Total na Rede</th>
                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase text-center">Status Lojas (Filtro Atual)</th>
                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase text-right">Ação</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {displayData.map((item, idx) => (
                            <React.Fragment key={idx}>
                                <tr 
                                    onClick={() => toggleRow(item.modelName)}
                                    className={`hover:bg-slate-50 transition-colors cursor-pointer group ${expandedModel === item.modelName ? 'bg-indigo-50/30' : ''}`}
                                >
                                    <td className="p-4">
                                        <div className="text-sm font-black text-slate-800 uppercase">{item.modelName}</div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className="text-sm font-black text-slate-700 bg-slate-100 px-3 py-1 rounded-full">{item.totalQty} un</span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center justify-center gap-2">
                                            {item.storesStockout > 0 && (
                                                <span className="px-2 py-1 bg-red-100 text-red-700 rounded-md text-[10px] font-black uppercase flex items-center gap-1" title="Lojas Zeradas">
                                                    <PackageX size={12}/> {item.storesStockout}
                                                </span>
                                            )}
                                            {item.storesCritical > 0 && (
                                                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-md text-[10px] font-black uppercase flex items-center gap-1" title="Lojas com 1 unidade">
                                                    <AlertTriangle size={12}/> {item.storesCritical}
                                                </span>
                                            )}
                                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md text-[10px] font-black uppercase" title="Lojas Abastecidas">
                                                {item.storesOk} OK
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <button className="text-indigo-600 p-1 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors">
                                            {expandedModel === item.modelName ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                        </button>
                                    </td>
                                </tr>

                                {/* ÁREA EXPANDIDA: Detalhes por Loja */}
                                {expandedModel === item.modelName && (
                                    <tr>
                                        <td colSpan={4} className="bg-slate-50/50 p-6 border-b-2 border-indigo-100">
                                            <div className="flex items-center gap-2 mb-4">
                                                <Store size={16} className="text-indigo-600"/>
                                                <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">Distribuição por Loja</h4>
                                            </div>
                                            
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                                {item.storesList.map((store: any, sIdx: number) => {
                                                    const isCritical = store.qty < 2;
                                                    
                                                    return (
                                                        <div key={sIdx} className={`p-4 rounded-xl border transition-all ${isCritical ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-white border-slate-200'}`}>
                                                            <div className="flex justify-between items-start mb-3">
                                                                <div>
                                                                    <span className="block font-black text-xs text-slate-800 uppercase leading-tight pr-2">{store.name}</span>
                                                                    <span className="text-[9px] text-slate-400 font-bold uppercase">{store.region}</span>
                                                                </div>
                                                                <span className={`shrink-0 text-xs font-black px-2 py-1 rounded-lg ${store.qty === 0 ? 'bg-red-200 text-red-800' : store.qty === 1 ? 'bg-orange-200 text-orange-800' : 'bg-emerald-100 text-emerald-700'}`}>
                                                                    {store.qty} un
                                                                </span>
                                                            </div>

                                                            {store.variations.length > 0 ? (
                                                                <div className="mt-2 space-y-1.5 pt-2 border-t border-slate-200/60">
                                                                    {store.variations.map((v: any, vIdx: number) => (
                                                                        <div key={vIdx} className="flex justify-between items-center gap-2 text-[9px] text-slate-600">
                                                                            <span className="truncate uppercase font-bold" title={v.desc}>{v.desc}</span>
                                                                            <span className="font-black bg-slate-100 px-1.5 py-0.5 rounded">{v.qty}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <div className="mt-2 pt-2 border-t border-red-200/60">
                                                                    <span className="text-[9px] font-bold text-red-500 uppercase flex items-center gap-1">
                                                                        <AlertCircle size={10}/> RUPTURA TOTAL
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            
            {displayData.length === 0 && !loading && (
                <div className="p-20 text-center text-slate-400 font-bold uppercase text-sm bg-white flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                        <Activity size={32} className="text-slate-300"/>
                    </div>
                    Nenhum modelo encontrado com os filtros atuais.
                </div>
            )}
        </div>
      </div>
    </div>
  );
}