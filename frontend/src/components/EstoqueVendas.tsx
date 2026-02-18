import React, { useState, useEffect } from 'react';
import { Package, RefreshCw, AlertTriangle, Filter, Search } from 'lucide-react';

const TABS = [
  { id: 'DF_GO', label: 'Brasília e Goiás' },
  { id: 'MG', label: 'Uberlândia e Uberaba' },
  { id: 'RV', label: 'Rio Verde' },
  { id: 'REC', label: 'Recife' },
  { id: 'JPA', label: 'João Pessoa' },
  { id: 'FOR', label: 'Fortaleza' },
];

export function EstoqueVendas() {
  const [activeTab, setActiveTab] = useState('DF_GO');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [dates, setDates] = useState({ start: '2026-02-01', end: '2026-02-28' });
  
  // ESTADO DO FILTRO DE CATEGORIA E BUSCA
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('TODAS');
  const [searchTerm, setSearchTerm] = useState(''); // <--- NOVO: Estado da Busca

  const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : 'https://telefluxo-aplicacao.onrender.com';

  useEffect(() => {
    const fetchCategories = async () => {
        try {
            const res = await fetch(`${API_URL}/api/categories`);
            const json = await res.json();
            if (Array.isArray(json)) setCategories(json);
        } catch (e) { console.error("Erro categorias", e); }
    };
    fetchCategories();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${API_URL}/api/estoque-vendas?regiao_aba=${activeTab}&start=${dates.start}&end=${dates.end}&category=${selectedCategory}`);
      if (!res.ok) throw new Error(`Erro API: ${res.status}`);
      const json = await res.json();

      if (Array.isArray(json)) {
          setData(json);
      } else {
          setData([]);
      }
    } catch (error: any) {
      console.error("Erro", error);
      setErrorMsg("Falha ao carregar dados.");
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, selectedCategory]);

  const handleSave = async (modelo: string, campo: string, valor: string) => {
    try {
        await fetch(`${API_URL}/api/estoque-vendas/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo, regiao_aba: activeTab, campo, valor: Number(valor) || 0 })
        });
    } catch (error) { console.error(error); }
  };

  // --- LÓGICA DE FILTRO INSTANTÂNEO (SEARCH) ---
  const filteredData = data.filter((row) => {
    if (!searchTerm) return true; // Se não digitou nada, mostra tudo
    return row.modelo.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* CABEÇALHO */}
      <div className="p-6 bg-white border-b border-slate-200 flex justify-between items-center shrink-0 gap-4">
        <div>
            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                <Package className="text-cyan-600" /> Estoque x Vendas
            </h2>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                Sugestão de compra baseada em giro
            </p>
        </div>
        
        <div className="flex gap-3 items-center">
            
            {/* CAMPO DE BUSCA (NOVO) */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                    type="text"
                    placeholder="BUSCAR MODELO..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 w-48 bg-slate-100 border-none rounded-lg text-xs font-bold uppercase text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-cyan-500 outline-none transition-all focus:w-64"
                />
            </div>

            {/* SELETOR DE CATEGORIA */}
            <div className="relative hidden md:block">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <select 
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="pl-10 pr-8 py-2 bg-slate-100 border-none rounded-lg text-xs font-bold uppercase text-slate-700 focus:ring-2 focus:ring-cyan-500 outline-none cursor-pointer appearance-none min-w-[180px]"
                >
                    <option value="TODAS">Todas as Categorias</option>
                    {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                    ))}
                </select>
            </div>

            <button onClick={fetchData} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase hover:bg-slate-800 transition-all active:scale-95 whitespace-nowrap">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span className="hidden md:inline">Atualizar</span>
            </button>
        </div>
      </div>

      {/* ABAS */}
      <div className="flex px-6 pt-4 border-b border-slate-200 bg-white shrink-0 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`mr-6 pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
              activeTab === tab.id 
                ? 'border-cyan-600 text-cyan-600' 
                : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TABELA */}
      <div className="flex-1 overflow-auto p-6">
        {errorMsg && <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg flex items-center gap-2"><AlertTriangle size={20} />{errorMsg}</div>}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">MODELO</th>
                <th className="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest bg-red-50 text-red-700">VENDA</th>
                <th className="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest bg-red-50 text-red-700">ESTOQUE</th>
                
                {activeTab === 'DF_GO' && (
                    <>
                    <th className="px-4 py-3 text-center text-[10px] font-black text-blue-700 bg-blue-50 uppercase tracking-widest">VENDA GO</th>
                    <th className="px-4 py-3 text-center text-[10px] font-black text-blue-700 bg-blue-50 uppercase tracking-widest">ESTOQUE GO</th>
                    </>
                )}

                <th className="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">OBSERVAÇÃO</th>
                <th className="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">PENDENTE</th>
                <th className="px-2 py-3 text-center text-[10px] font-black text-slate-600 bg-gray-100 uppercase tracking-widest w-24">FATURADO</th>
                <th className="px-2 py-3 text-center text-[10px] font-black text-slate-600 bg-gray-100 uppercase tracking-widest w-24">SUGESTÃO</th>
                <th className="px-2 py-3 text-center text-[10px] font-black text-white bg-blue-600 uppercase tracking-widest w-24">PEDIDO</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-xs font-medium text-slate-700">
                {loading ? (
                    <tr><td colSpan={12} className="text-center py-20 text-slate-400 font-bold uppercase tracking-widest">Carregando dados...</td></tr>
                ) : filteredData.length === 0 ? (
                    <tr><td colSpan={12} className="text-center py-20 text-slate-400 font-bold uppercase tracking-widest">Nenhum modelo encontrado.</td></tr>
                ) : filteredData.map((row, i) => {
                
                const precisaPedir = row.venda >= row.estoque;
                const obsTexto = precisaPedir ? "FAZER PEDIDO" : "-";
                const obsClass = precisaPedir 
                    ? "bg-yellow-100 text-yellow-700 text-[9px] font-black px-2 py-0.5 rounded-full border border-yellow-200 uppercase" 
                    : "text-slate-400";

                return (
                    <tr key={i} className={`hover:bg-slate-50 transition-colors`}>
                    <td className="px-4 py-3 font-bold text-slate-800">{row.modelo}</td>
                    <td className="px-4 py-3 text-center font-bold text-red-600 border-l border-r border-red-100 bg-red-50/30">{row.venda}</td>
                    <td className="px-4 py-3 text-center font-bold text-red-600 border-r border-red-100 bg-red-50/30">{row.estoque}</td>

                    {activeTab === 'DF_GO' && (
                        <>
                        <td className="px-4 py-3 text-center font-bold text-blue-600 border-r border-blue-100 bg-blue-50/30">{row.venda_go}</td>
                        <td className="px-4 py-3 text-center font-bold text-blue-600 border-r border-blue-100 bg-blue-50/30">{row.estoque_go}</td>
                        </>
                    )}

                    <td className={`px-4 py-3 text-center border-r border-slate-100 ${obsClass}`}>{obsTexto}</td>
                    <td className="px-4 py-3 text-center text-slate-400 border-r border-slate-100">{row.pendente || '-'}</td>

                    <td className="p-1 border-r border-slate-200 bg-gray-50">
                        <input defaultValue={row.faturado} className="w-full text-center p-1 bg-white border border-slate-300 rounded text-slate-700 font-bold focus:ring-2 focus:ring-cyan-500 outline-none" onBlur={(e) => handleSave(row.modelo, 'faturado', e.target.value)} />
                    </td>
                    <td className="p-1 border-r border-slate-200 bg-gray-50">
                        <input defaultValue={row.sugestao} className="w-full text-center p-1 bg-white border border-slate-300 rounded text-slate-700 font-bold focus:ring-2 focus:ring-cyan-500 outline-none" onBlur={(e) => handleSave(row.modelo, 'sugestao_coordenador', e.target.value)} />
                    </td>
                    <td className="p-1 bg-blue-50">
                        <input defaultValue={row.pedido} className="w-full text-center p-1 bg-blue-600 border border-blue-700 rounded text-white font-black focus:ring-2 focus:ring-white outline-none" onBlur={(e) => handleSave(row.modelo, 'pedido_rufino', e.target.value)} />
                    </td>
                    </tr>
                );
                })}
            </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}