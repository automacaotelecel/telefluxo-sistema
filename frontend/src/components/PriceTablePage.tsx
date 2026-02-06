import React, { useEffect, useState } from 'react';
import { Search, Smartphone, Archive, Headphones, AlertTriangle, Calendar, X, Tag, ChevronRight, Filter } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function PriceTablePage() {
  const [activeTab, setActiveTab] = useState('Aparelhos');
  const [searchTerm, setSearchTerm] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  // 1. Segurança
  useEffect(() => {
    try {
        const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('telefluxo_user') || '{}');
        const role = user.role ? user.role.toUpperCase() : '';
        const permitidos = ['LOJA', 'GERENTE', 'ADM', 'CEO', 'DIRETOR', 'ADMIN'];
        if (!permitidos.includes(role)) window.location.href = "/"; 
    } catch (e) { window.location.href = "/"; }
  }, []);

  // 2. Busca
  useEffect(() => {
    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/price-table?category=${activeTab}`);
            const data = await res.json();
            setItems(Array.isArray(data) ? data : []);
        } catch (error) { console.error(error); } 
        finally { setLoading(false); }
    };
    fetchData();
  }, [activeTab]);

  const filteredItems = items.filter(item => 
    item.model?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Função para formatar o preço bonito
  const formatPrice = (val: string) => {
      if (!val || val === '-') return { currency: '', value: '-' };
      // Remove R$ se já vier da planilha para não duplicar
      const clean = val.replace('R$', '').trim();
      return { currency: 'R$', value: clean };
  };

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC] font-sans text-slate-800">
      
      {/* --- HEADER FIXO --- */}
      <div className="bg-white border-b border-slate-200 px-6 py-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm shrink-0">
        <div>
            <h1 className="text-2xl font-black uppercase text-slate-800 tracking-tight flex items-center gap-2">
               <span className="bg-indigo-600 text-white p-2 rounded-lg"><Tag size={20} /></span>
               Tabela Oficial
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-1 ml-1">
                Consulte vigências, preços parcelados e descontos exclusivos.
            </p>
        </div>

        {/* Barra de Pesquisa */}
        <div className="relative w-full md:w-96 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
            <input 
                type="text" placeholder="Buscar modelo (ex: S24)..." 
                className="w-full pl-10 pr-4 py-3 bg-slate-100 border-none rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all outline-none"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            />
        </div>
      </div>

      {/* --- CONTROLES (ABAS) --- */}
      <div className="px-6 py-4 shrink-0">
          <div className="inline-flex bg-slate-200 p-1 rounded-xl">
            {['Aparelhos', 'Obsoletos', 'Acessorios'].map(tab => (
                <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-all flex items-center gap-2 ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm scale-105' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    {tab === 'Aparelhos' && <Smartphone size={14}/>}
                    {tab === 'Obsoletos' && <Archive size={14}/>}
                    {tab === 'Acessorios' && <Headphones size={14}/>}
                    {tab === 'Acessorios' ? 'Acessórios' : tab}
                </button>
            ))}
          </div>
      </div>

      {/* --- TABELA (COM SCROLL) --- */}
      <div className="flex-1 overflow-hidden px-6 pb-6">
        <div className="bg-white h-full rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            
            {/* Cabeçalho da Tabela */}
            <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 py-3 px-4 shrink-0">
                <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={12}/> Vigência</div>
                <div className="col-span-5 text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Modelo / Produto</div>
                <div className="col-span-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right pr-4">Preço</div>
                <div className="col-span-2 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Ação</div>
            </div>

            {/* Lista de Itens */}
            <div className="overflow-y-auto flex-1 custom-scrollbar">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                        <span className="text-xs font-bold uppercase">Buscando ofertas...</span>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                        <Filter size={48} className="opacity-20 mb-2"/>
                        <span className="text-sm font-medium">Nenhum produto encontrado.</span>
                    </div>
                ) : (
                    filteredItems.map((item, idx) => {
                        const priceObj = formatPrice(item.price);
                        return (
                            <div 
                                key={item.id} 
                                onClick={() => setSelectedItem(item)}
                                className={`grid grid-cols-12 items-center py-4 px-4 border-b border-slate-50 hover:bg-indigo-50/50 cursor-pointer transition-colors group ${idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}`}
                            >
                                {/* Vigência */}
                                <div className="col-span-2">
                                    <div className="inline-block px-2 py-1 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold border border-slate-200 whitespace-nowrap">
                                        {item.vigencia || "-"}
                                    </div>
                                </div>

                                {/* Modelo */}
                                <div className="col-span-5 pl-2 pr-4">
                                    <div className={`text-sm font-bold truncate ${item.highlight ? 'text-indigo-900' : 'text-slate-700'}`}>
                                        {item.model}
                                    </div>
                                    {item.highlight && (
                                        <div className="flex items-center gap-1 mt-1 text-amber-600 text-[9px] font-black uppercase tracking-wider animate-pulse">
                                            <AlertTriangle size={10} /> Preço Alterado
                                        </div>
                                    )}
                                </div>

                                {/* Preço (Estilo E-commerce) */}
                                <div className="col-span-3 text-right pr-4">
                                    <div className="flex flex-col items-end">
                                        <div className="flex items-baseline gap-1 text-[#1428A0]">
                                            <span className="text-xs font-medium text-slate-400">{priceObj.currency}</span>
                                            <span className="text-lg font-black tracking-tight">{priceObj.value}</span>
                                        </div>
                                        {item.highlight && <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-1 rounded">OFERTA</span>}
                                    </div>
                                </div>

                                {/* Botão */}
                                <div className="col-span-2 flex justify-center">
                                    <button className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg shadow-sm text-[10px] font-black uppercase text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-all">
                                        Ver Oferta <ChevronRight size={10} />
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
      </div>

      {/* --- MODAL DE DETALHES (PREMIUM) --- */}
      {selectedItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setSelectedItem(null)}>
            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden scale-100 transition-transform" onClick={e => e.stopPropagation()}>
                
                {/* Header Modal */}
                <div className="bg-slate-900 p-8 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-32 bg-indigo-600 rounded-full blur-3xl opacity-20 -mr-16 -mt-16"></div>
                    
                    <button onClick={() => setSelectedItem(null)} className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"><X size={20}/></button>

                    <div className="relative z-10">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/30 border border-indigo-400/30 text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-3">
                            <Tag size={12}/> Oferta Oficial Telecel
                        </div>
                        <h2 className="text-2xl font-black uppercase tracking-tight leading-tight">{selectedItem.model}</h2>
                        {selectedItem.reference && selectedItem.reference !== '-' && (
                             <p className="text-slate-400 text-xs font-mono mt-2">REF: {selectedItem.reference}</p>
                        )}
                    </div>
                </div>

                {/* Body Modal */}
                <div className="p-8">
                    {/* Preços Destaque */}
                    <div className="flex flex-col md:flex-row gap-4 mb-8">
                        <div className="flex-1 bg-indigo-50 p-5 rounded-2xl border border-indigo-100 relative overflow-hidden">
                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-wider mb-1">Preço Final (À Vista)</p>
                            <p className="text-3xl font-black text-indigo-700">{formatPrice(selectedItem.price).currency} {formatPrice(selectedItem.price).value}</p>
                            <div className="absolute -bottom-4 -right-4 text-indigo-200 opacity-20">
                                <Tag size={80} />
                            </div>
                        </div>
                        <div className="flex-1 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Preço Parcelado (18x)</p>
                            <p className="text-2xl font-black text-slate-700">{selectedItem.price18x || "-"}</p>
                        </div>
                    </div>

                    {/* Grid de Detalhes */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-4">
                        <DetailItem label="Preço Base (SSG)" value={selectedItem.priceSSG} />
                        <DetailItem label="Desc. Telecel" value={selectedItem.descTelecel} highlight />
                        <DetailItem label="Rebate" value={selectedItem.rebate} />
                        
                        <DetailItem label="Trade-In (Troca)" value={selectedItem.tradeIn} />
                        <DetailItem label="Bônus (BOGO)" value={selectedItem.bogo} />
                        <DetailItem label="Incentivo (SIP)" value={selectedItem.sip} />
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-center text-slate-400 text-xs font-bold gap-2">
                         <Calendar size={14}/> Vigência: {selectedItem.vigencia}
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

// Componente para itens do detalhe
const DetailItem = ({ label, value, highlight }: any) => (
    <div>
        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">{label}</p>
        <p className={`text-sm font-bold ${highlight ? 'text-green-600' : 'text-slate-800'}`}>
            {(!value || value === '0' || value === '-') ? '-' : value}
        </p>
    </div>
);