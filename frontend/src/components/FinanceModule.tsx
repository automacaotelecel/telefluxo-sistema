import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Landmark, AlertCircle, CheckCircle2, Search, Plus, FileText, UploadCloud, Trash2, PieChart, List, Bell, TrendingDown, Store, Circle, X, Calendar, Settings, ArrowRight, ChevronRight, Filter, ChevronLeft, Layers, ChevronDown, CalendarDays, Box, Package, ArrowUpCircle, ArrowDownCircle, DollarSign, Wallet } from 'lucide-react';

export default function FinanceModule() {
  const [data, setData] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  
  // *** CONTROLE DE MODO (PAGAR vs RECEBER) ***
  const [operationType, setOperationType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');

  // --- PAGINAÇÃO ---
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 50; 

  // --- FILTROS & VISUALIZAÇÃO ---
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'PENDENTE' | 'PAGO'>('TODOS');
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  
  // *** CONTROLE DE EXPANSÃO (DIÁRIO) ***
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  
  const [activeTab, setActiveTab] = useState<'list' | 'dashboard' | 'management'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<any>(null); // Para o modal da aba gestão

  const [formData, setFormData] = useState({
    supplier: '',
    description: '',
    category: 'FORNECEDORES', // Alterado padrão para Fornecedores
    unit: 'MATRIZ',
    payer: 'RMC',
    value: '',
    dueDate: '',
    isRecurring: false,
    installments: '1'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // *** NOVO: LISTAS DE CATEGORIAS ***
  const expenseCategories = [
    { id: 'FORNECEDORES', label: 'FORNECEDORES / ESTOQUE' },
    { id: 'ALUGUEL', label: 'ALUGUEL / CONDOMÍNIO' },
    { id: 'PESSOAL', label: 'PESSOAL / SALÁRIOS' },
    { id: 'IMPOSTOS', label: 'IMPOSTOS E TAXAS' },
    { id: 'MARKETING', label: 'MARKETING / MÍDIA' },
    { id: 'SERVICOS', label: 'ÁGUA / LUZ / INTERNET' },
    { id: 'SOFTWARE', label: 'SOFTWARE / SISTEMAS' },
    { id: 'MANUTENCAO', label: 'MANUTENÇÃO / LIMPEZA' },
    { id: 'TRANSPORTE', label: 'TRANSPORTE / COMBUSTÍVEL' },
    { id: 'OUTROS', label: 'OUTROS / DIVERSOS' }
  ];

  const incomeCategories = [
    { id: 'VENDAS', label: 'VENDAS DE PRODUTOS' },
    { id: 'SERVICOS', label: 'PRESTAÇÃO DE SERVIÇOS' },
    { id: 'COMISSAO', label: 'COMISSÕES RECEBIDAS' },
    { id: 'RENDIMENTOS', label: 'RENDIMENTOS FINANCEIROS' },
    { id: 'REEMBOLSO', label: 'REEMBOLSOS / ESTORNOS' },
    { id: 'OUTROS', label: 'OUTRAS ENTRADAS' }
  ];

  // *** TEMA DINÂMICO (Cores e Textos baseados no Modo) ***
  const theme = operationType === 'EXPENSE' 
    ? { 
        main: 'slate', 
        accent: 'red', 
        icon: <ArrowUpCircle />, 
        label: 'A Pagar', 
        entity: 'Fornecedor', 
        destination: 'Pagador',
        bg: 'bg-slate-50',
        titleColor: 'text-slate-800'
      }
    : { 
        main: 'emerald', 
        accent: 'blue', 
        icon: <ArrowDownCircle />, 
        label: 'A Receber', 
        entity: 'Cliente/Origem', 
        destination: 'Conta Destino',
        bg: 'bg-emerald-50/50',
        titleColor: 'text-emerald-900'
      };

  const fetchFinance = () => {
    fetch(`${API_URL}/finance?page=${currentPage}&limit=${itemsPerPage}&type=${operationType}`)
      .then(r => r.json())
      .then(response => {
        if (Array.isArray(response)) {
            setData(response);
            setTotalPages(1);
        } else {
            setData(response.data || []);
            setTotalPages(response.totalPages || 1);
        }
      })
      .catch(() => setData([]));
  };

  // Recarrega quando muda a página OU o tipo de operação
  useEffect(() => { 
      setCurrentPage(1); 
      // *** NOVO: Reseta a categoria para evitar enviar categoria errada ***
      setFormData(prev => ({ 
          ...prev, 
          category: operationType === 'INCOME' ? 'VENDAS' : 'FORNECEDORES' 
      }));
      fetchFinance(); 
  }, [operationType]);

  useEffect(() => { fetchFinance(); }, [currentPage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/finance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            ...formData, 
            type: operationType, 
            value: Number(formData.value), // Garante envio como número
            issueDate: new Date().toISOString() 
        })
      });

      if (response.ok) {
        setIsModalOpen(false);
        setFormData({ 
            supplier: '', 
            description: '', 
            category: operationType === 'INCOME' ? 'VENDAS' : 'FORNECEDORES', 
            unit: 'MATRIZ', 
            payer: 'RMC', 
            value: '', 
            dueDate: '', 
            isRecurring: false, 
            installments: '1' 
        });
        fetchFinance();
      } else {
        alert("Erro ao salvar registro.");
      }
    } catch (error) {
      alert("Erro na conexão com o servidor.");
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'PENDENTE' ? 'PAGO' : 'PENDENTE';
    try {
        await fetch(`${API_URL}/finance/${id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        fetchFinance();
        if(selectedGroup) {
            const updatedItems = selectedGroup.items.map((i:any) => i.id === id ? {...i, status: newStatus} : i);
            setSelectedGroup({...selectedGroup, items: updatedItems});
        }
    } catch (e) { console.error("Erro ao mudar status"); }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm("Tem certeza que deseja EXCLUIR apenas este lançamento?")) return;
    try {
        await fetch(`${API_URL}/finance/${id}`, { method: 'DELETE' });
        setData(prev => prev.filter(item => item.id !== id));
        if(selectedGroup) {
            const updatedItems = selectedGroup.items.filter((i:any) => i.id !== id);
            if(updatedItems.length === 0) setSelectedGroup(null);
            else setSelectedGroup({...selectedGroup, items: updatedItems});
        }
    } catch (e) { alert("Erro ao excluir item."); }
  };

  const handleClearAll = async () => {
    if (!confirm(`⚠️ APAGAR TODO O HISTÓRICO DE ${operationType === 'EXPENSE' ? 'DESPESAS' : 'RECEITAS'}?`)) return;
    await fetch(`${API_URL}/finance/all?type=${operationType}`, { method: 'DELETE' });
    fetchFinance();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; 
    if(!file) return;
    const fd = new FormData(); 
    fd.append('file', file);
    fd.append('type', operationType); 
    try {
        await fetch(`${API_URL}/finance/import`, {method:'POST', body:fd});
        fetchFinance();
    } catch (e) { alert("Erro no upload"); }
    if (event.target) event.target.value = '';
  };

  // --- LÓGICA DE FILTRAGEM ---
  const today = new Date();
  today.setHours(0,0,0,0);

  const filteredData = useMemo(() => {
    return data.filter(item => {
      const matchesSearch = (item.supplier || '').toLowerCase().includes(filter.toLowerCase());
      const matchesStatus = statusFilter === 'TODOS' || item.status === statusFilter;
      
      let matchesUrgency = true;
      if (showUrgentOnly) {
        const d = new Date(item.dueDate);
        const diff = (d.getTime() - today.getTime()) / (1000 * 3600 * 24);
        matchesUrgency = item.status === 'PENDENTE' && diff <= 2;
      }
      return matchesSearch && matchesStatus && matchesUrgency;
    });
  }, [data, filter, statusFilter, showUrgentOnly]); 

  // *** LÓGICA MISTA PARA O DIÁRIO ***
  const dailyMixedList = useMemo(() => {
    const groups: Record<string, any> = {};
    const singles: any[] = [];

    filteredData.forEach(item => {
        if (item.groupId) {
            if (!groups[item.groupId]) {
                groups[item.groupId] = {
                    type: 'GROUP',
                    id: item.groupId,
                    supplier: item.supplier,
                    description: item.description || 'Parcelamento',
                    category: item.category,
                    items: [],
                    totalValue: 0,
                    paidCount: 0,
                    totalCount: item.totalInstallments || 1,
                    earliestDate: item.dueDate
                };
            }
            groups[item.groupId].items.push(item);
            groups[item.groupId].totalValue += Number(item.value);
            if (item.status === 'PAGO') groups[item.groupId].paidCount += 1;
            
            if (new Date(item.dueDate) < new Date(groups[item.groupId].earliestDate)) {
                groups[item.groupId].earliestDate = item.dueDate;
            }

        } else {
            singles.push({
                type: 'SINGLE',
                ...item,
                sortDate: item.dueDate
            });
        }
    });

    const combined = [ ...Object.values(groups), ...singles ];

    return combined.sort((a, b) => {
        const dateA = a.type === 'GROUP' ? a.earliestDate : a.sortDate;
        const dateB = b.type === 'GROUP' ? b.earliestDate : b.sortDate;
        return new Date(dateA).getTime() - new Date(dateB).getTime();
    });

  }, [filteredData]);

  const toggleGroupAccordion = (groupId: string) => {
      setExpandedGroups(prev => prev.includes(groupId) ? prev.filter(k => k !== groupId) : [...prev, groupId]);
  };

  // --- INDICADORES ---
  const criticalItems = data.filter(t => {
    const d = new Date(t.dueDate);
    const diff = (d.getTime() - today.getTime()) / (1000 * 3600 * 24);
    return t.status === 'PENDENTE' && diff <= 2;
  });

  const groupManagement = data.reduce((acc: any, curr: any) => {
    if (!curr.groupId) return acc; 
    if (!acc[curr.groupId]) {
        acc[curr.groupId] = {
            id: curr.groupId,
            supplier: curr.supplier,
            description: curr.description,
            totalValue: 0,
            paidCount: 0,
            totalCount: curr.totalInstallments || 1,
            category: curr.category,
            items: []
        };
    }
    acc[curr.groupId].totalValue += Number(curr.value) || 0;
    if (curr.status === 'PAGO') acc[curr.groupId].paidCount += 1;
    acc[curr.groupId].items.push(curr);
    return acc;
  }, {});

  const categorySummary = data.reduce((acc: any, curr: any) => {
    const cat = curr.category || 'Geral';
    acc[cat] = (acc[cat] || 0) + (Number(curr.value) || 0);
    return acc;
  }, {});

  const unitSummary = data.reduce((acc: any, curr: any) => {
    const unit = curr.unit || 'Matriz';
    acc[unit] = (acc[unit] || 0) + (Number(curr.value) || 0);
    return acc;
  }, {});

  const totalPendente = data.filter(t => t.status === 'PENDENTE').reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
  const totalPago = data.filter(t => t.status === 'PAGO').reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);

  // Helper para renderizar linhas
  const renderTableRows = (items: any[]) => {
      return items.sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map(title => {
        const d = new Date(title.dueDate);
        const diff = (d.getTime() - today.getTime()) / (1000 * 3600 * 24);
        const isUrgent = title.status === 'PENDENTE' && diff <= 2;
        const isOverdue = title.status === 'PENDENTE' && diff < 0;

        return (
            <tr key={title.id} className={`hover:bg-slate-50/80 transition-all ${isOverdue ? 'bg-red-50/30' : ''} border-b border-slate-50 last:border-0`}>
                <td className="px-8 py-4">
                    <div className="flex items-center gap-4">
                        <button onClick={(e) => { e.stopPropagation(); toggleStatus(title.id, title.status); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${title.status === 'PAGO' ? `bg-${theme.main}-500 text-white` : 'bg-slate-100 text-slate-400 hover:bg-orange-100 hover:text-orange-500'}`}>
                            {title.status === 'PAGO' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                        </button>
                        <div>
                            <p className={`text-xs font-black italic ${isOverdue ? 'text-red-600' : isUrgent ? 'text-orange-500' : 'text-slate-500'}`}>
                                {new Date(title.dueDate).toLocaleDateString('pt-BR')}
                            </p>
                            {isOverdue && <span className="text-[8px] font-black text-red-500 uppercase">Atrasado!</span>}
                        </div>
                    </div>
                </td>
                <td className="px-8 py-4">
                    <p className="text-xs font-black text-slate-800 uppercase leading-none">{title.supplier}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                        <span className="text-[9px] font-bold text-slate-400 uppercase bg-slate-100 px-2 py-0.5 rounded">{title.unit}</span>
                        {/* ADICIONADO: Visualização da Categoria na Lista */}
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${operationType === 'INCOME' ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-blue-500 bg-blue-50 border-blue-100'}`}>{title.category}</span>
                        {title.payer && <span className={`text-[9px] font-bold text-${theme.accent}-600 uppercase bg-${theme.accent}-50 px-2 py-0.5 rounded border border-${theme.accent}-100`}>PG: {title.payer}</span>}
                    </div>
                </td>
                <td className="px-8 py-4 text-right font-black text-sm text-slate-700">
                    R$ {Number(title.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-8 py-4 text-center">
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteItem(title.id); }} className="w-8 h-8 rounded-full bg-white border border-slate-100 text-slate-300 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-all mx-auto shadow-sm"><Trash2 size={14} /></button>
                </td>
            </tr>
        );
      });
  };

  return (
    <div className={`flex-1 p-8 overflow-y-auto font-sans relative transition-colors duration-500 ${theme.bg}`}>
      <div className="max-w-7xl mx-auto">
        
        {/* --- HEADER --- */}
        <div className="flex flex-col md:flex-row justify-between items-start mb-10 gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-2xl shadow-sm transition-all ${operationType === 'INCOME' ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white'}`}>
                    {theme.icon}
                </div>
                <div>
                    <h1 className={`text-3xl font-black uppercase italic tracking-tighter transition-colors ${theme.titleColor}`}>
                        {operationType === 'INCOME' ? 'Contas a Receber' : 'Contas a Pagar'}
                    </h1>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Financeiro Telecel</p>
                </div>
            </div>

            <div className="bg-white p-1 rounded-2xl border border-slate-200 shadow-sm inline-flex">
                <button 
                    onClick={() => setOperationType('EXPENSE')} 
                    className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${operationType === 'EXPENSE' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                    <ArrowUpCircle size={14}/> Saídas (Pagar)
                </button>
                <button 
                    onClick={() => setOperationType('INCOME')} 
                    className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${operationType === 'INCOME' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:bg-emerald-50'}`}
                >
                    <ArrowDownCircle size={14}/> Entradas (Receber)
                </button>
            </div>
          </div>

          <div className="flex gap-3">
             <div className="flex gap-2 bg-white p-1 rounded-2xl border border-slate-100 shadow-sm w-fit h-fit">
               <button onClick={() => setActiveTab('list')} className={`flex gap-2 items-center px-4 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'list' ? `bg-${theme.main}-900 text-white shadow-md` : 'text-slate-400 hover:text-slate-600'}`}><List size={14}/> Diário</button>
               <button onClick={() => setActiveTab('management')} className={`flex gap-2 items-center px-4 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'management' ? `bg-${theme.main}-900 text-white shadow-md` : 'text-slate-400 hover:text-slate-600'}`}><Settings size={14}/> Gestão</button>
               <button onClick={() => setActiveTab('dashboard')} className={`flex gap-2 items-center px-4 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'dashboard' ? `bg-${theme.main}-900 text-white shadow-md` : 'text-slate-400 hover:text-slate-600'}`}><PieChart size={14}/> BI</button>
            </div>
            <button onClick={() => setIsModalOpen(true)} className={`px-6 py-4 rounded-2xl font-black text-xs uppercase flex gap-2 shadow-lg transition-all active:scale-95 text-white ${operationType === 'INCOME' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
                <Plus size={16} /> Novo
            </button>
            <button onClick={handleClearAll} className="bg-white text-red-500 border border-red-100 px-4 py-2 rounded-xl font-black text-[10px] uppercase flex gap-2 hover:bg-red-50 transition-all shadow-sm items-center"><Trash2 size={14} /></button>
            <input type="file" accept=".csv,.xlsx,.xls,.xlsm" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            <button onClick={() => fileInputRef.current?.click()} className={`text-white px-6 py-4 rounded-2xl font-black text-xs uppercase flex gap-2 shadow-xl transition-all items-center ${operationType === 'INCOME' ? 'bg-emerald-800 hover:bg-emerald-900' : 'bg-slate-900 hover:bg-slate-800'}`}><UploadCloud size={16} /> Importar</button>
          </div>
        </div>

        {activeTab === 'list' && (
          <div className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{theme.label} Total</p>
                    <h2 className={`text-2xl font-black text-${theme.main}-800`}>R$ {totalPendente.toLocaleString('pt-BR')}</h2>
                </div>
                <div className={`p-6 rounded-[32px] shadow-lg text-white ${operationType === 'INCOME' ? 'bg-emerald-600' : 'bg-emerald-500'}`}>
                    <p className="text-[10px] font-black opacity-60 uppercase tracking-widest mb-1">Total {operationType === 'INCOME' ? 'Recebido' : 'Pago'}</p>
                    <h2 className="text-2xl font-black">R$ {totalPago.toLocaleString('pt-BR')}</h2>
                </div>
                <div className={`p-6 rounded-[32px] shadow-xl text-white ${operationType === 'INCOME' ? 'bg-emerald-900' : 'bg-slate-900'}`}>
                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Previsão</p>
                    <h2 className="text-xl font-black italic uppercase tracking-tighter">Fluxo {operationType === 'INCOME' ? 'Positivo' : 'Controlado'}</h2>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-[32px] border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="bg-slate-50 px-4 py-2 rounded-2xl border border-slate-100 flex items-center gap-3 w-80 shadow-inner">
                        <Search size={16} className="text-slate-400" />
                        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={`Pesquisar ${theme.entity}...`} className="text-xs font-bold outline-none bg-transparent w-full" />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                        <button onClick={() => setStatusFilter('TODOS')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${statusFilter === 'TODOS' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Todos</button>
                        <button onClick={() => setStatusFilter('PENDENTE')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${statusFilter === 'PENDENTE' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Pendentes</button>
                        <button onClick={() => setStatusFilter('PAGO')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${statusFilter === 'PAGO' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{operationType === 'INCOME' ? 'Recebidos' : 'Pagos'}</button>
                    </div>

                    <div className="h-6 w-[1px] bg-slate-200 mx-2"></div>

                    <button 
                        onClick={() => setShowUrgentOnly(!showUrgentOnly)} 
                        className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-2 transition-all ${showUrgentOnly ? 'bg-red-500 text-white shadow-md' : 'bg-white text-slate-400 border border-slate-100 hover:bg-slate-50'}`}
                    >
                        <AlertCircle size={14}/> {showUrgentOnly ? 'Urgentes' : 'Urgentes'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                 <div className="flex justify-between items-center mb-2 px-2">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Diário Geral ({theme.label})</h3>
                    <p className="text-[10px] font-bold text-slate-400 italic">Contratos são agrupados, avulsos são listados.</p>
                </div>
                
                {dailyMixedList.length > 0 ? dailyMixedList.map(item => {
                    
                    if (item.type === 'GROUP') {
                        const isOpen = expandedGroups.includes(item.id);
                        return (
                            <div key={item.id} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm group hover:border-blue-200 transition-all cursor-pointer overflow-hidden" onClick={() => toggleGroupAccordion(item.id)}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-6">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-inner ${isOpen ? `bg-${theme.main}-900 text-white` : `bg-slate-50 text-slate-400 group-hover:bg-${theme.main}-50 group-hover:text-${theme.main}-600`}`}>
                                            <FileText size={24} />
                                        </div>
                                        <div>
                                            <h4 className="font-black text-slate-800 uppercase text-sm leading-none mb-1">{item.supplier}</h4>
                                            <div className="flex gap-2">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">{item.description}</p>
                                                <span className={`text-[9px] font-black text-${theme.accent}-500 uppercase`}>{item.category}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-12">
                                        <div className="text-right">
                                            <p className="text-[9px] font-black text-slate-300 uppercase mb-1">Status</p>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-black text-slate-700">{item.paidCount} / {item.totalCount}</span>
                                                <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                                                    <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${(item.paidCount / item.totalCount) * 100}%` }}></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right w-32">
                                            <p className="text-[9px] font-black text-slate-300 uppercase mb-1">Valor Total</p>
                                            <p className="text-sm font-black text-slate-800">R$ {item.totalValue.toLocaleString('pt-BR')}</p>
                                        </div>
                                        <div className={`p-3 rounded-xl transition-all ${isOpen ? `bg-${theme.main}-900 text-white` : 'bg-slate-50 text-slate-400'}`}>
                                            {isOpen ? <ChevronDown size={18} /> : <ArrowRight size={18} />}
                                        </div>
                                    </div>
                                </div>
                                {isOpen && (
                                    <div className="mt-6 pt-6 border-t border-slate-100 animate-in slide-in-from-top-2 duration-300">
                                        <table className="w-full text-left">
                                            <tbody className="bg-slate-50/50 rounded-2xl">
                                                {renderTableRows(item.items)}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    } 
                    
                    else {
                        const d = new Date(item.dueDate);
                        const diff = (d.getTime() - today.getTime()) / (1000 * 3600 * 24);
                        const isUrgent = item.status === 'PENDENTE' && diff <= 2;
                        const isOverdue = item.status === 'PENDENTE' && diff < 0;

                        return (
                            <div key={item.id} className={`bg-white p-5 rounded-[24px] border border-slate-100 shadow-sm flex items-center justify-between hover:bg-slate-50 transition-all ${isOverdue ? 'border-l-4 border-l-red-500' : ''}`}>
                                <div className="flex items-center gap-6">
                                    <div className="w-10 h-10 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 shadow-sm">
                                        <Package size={20} />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-slate-800 uppercase text-xs leading-none mb-1">{item.supplier}</h4>
                                        <div className="flex gap-2 items-center">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">{item.description || 'Avulso'}</p>
                                            {/* VISUALIZAÇÃO DA CATEGORIA NO CARD AVULSO */}
                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${operationType === 'INCOME' ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-blue-500 bg-blue-50 border-blue-100'}`}>{item.category}</span>
                                            {isOverdue && <span className="text-[8px] font-black text-red-500 uppercase bg-red-50 px-2 rounded">Atrasado</span>}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-12">
                                     <div className="text-right">
                                        <p className="text-[9px] font-black text-slate-300 uppercase mb-0.5">Vencimento</p>
                                        <p className={`text-xs font-black uppercase ${isUrgent ? 'text-orange-500' : 'text-slate-600'}`}>
                                            {new Date(item.dueDate).toLocaleDateString('pt-BR')}
                                        </p>
                                    </div>
                                    <div className="text-right w-32">
                                        <p className="text-[9px] font-black text-slate-300 uppercase mb-0.5">Valor</p>
                                        <p className="text-sm font-black text-slate-800">R$ {Number(item.value).toLocaleString('pt-BR')}</p>
                                    </div>
                                    <div className="flex gap-2">
                                         <button onClick={() => toggleStatus(item.id, item.status)} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${item.status === 'PAGO' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-300 hover:text-orange-500 hover:bg-orange-50'}`}>
                                            {item.status === 'PAGO' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                                        </button>
                                        <button onClick={() => handleDeleteItem(item.id)} className="w-8 h-8 rounded-full bg-white border border-slate-100 text-slate-300 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-all shadow-sm">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    }
                }) : (
                    <div className="p-20 text-center text-slate-300 font-black text-xs uppercase bg-white rounded-[40px] border border-dashed border-slate-200">
                        Nenhum registro de {operationType === 'EXPENSE' ? 'despesa' : 'receita'} encontrado nesta página.
                    </div>
                )}
            </div>

            <div className="flex justify-between items-center p-4 bg-white rounded-2xl border border-slate-100 shadow-sm mt-6">
                <p className="text-[10px] font-black uppercase text-slate-400">
                  Página {currentPage} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="flex items-center gap-1 px-4 py-2 bg-slate-100 rounded-xl text-[10px] font-black uppercase disabled:opacity-50 hover:bg-slate-200 transition-all"
                  >
                    <ChevronLeft size={14} /> Anterior
                  </button>
                  <button 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className="flex items-center gap-1 px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase disabled:opacity-50 hover:bg-slate-800 transition-all"
                  >
                    Próximo <ChevronRight size={14} />
                  </button>
                </div>
            </div>

          </div>
        )}

        {/* --- TELA 2: GESTÃO DE CONTRATOS --- */}
        {activeTab === 'management' && (
            <div className="grid grid-cols-1 gap-4">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Contratos e Parcelamentos Ativos</h3>
                    <p className="text-[10px] font-bold text-slate-400 italic">Agrupamento automático por Grupo de Parcelas</p>
                </div>
                {Object.values(groupManagement).length > 0 ? Object.values(groupManagement).map((group: any) => (
                    <div key={group.id} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex items-center justify-between group hover:border-blue-200 transition-all cursor-pointer" onClick={() => setSelectedGroup(group)}>
                        <div className="flex items-center gap-6">
                            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all shadow-inner">
                                <FileText size={24} />
                            </div>
                            <div>
                                <h4 className="font-black text-slate-800 uppercase text-sm leading-none mb-1">{group.supplier}</h4>
                                <div className="flex gap-2">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">{group.description}</p>
                                    <span className="text-[9px] font-black text-blue-500 uppercase">{group.category}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-12">
                            <div className="text-right">
                                <p className="text-[9px] font-black text-slate-300 uppercase mb-1">Status de Quitação</p>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-black text-slate-700">{group.paidCount} / {group.totalCount}</span>
                                    <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                                        <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${(group.paidCount / group.totalCount) * 100}%` }}></div>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right w-32">
                                <p className="text-[9px] font-black text-slate-300 uppercase mb-1">Valor Total</p>
                                <p className="text-sm font-black text-slate-800">R$ {group.totalValue.toLocaleString('pt-BR')}</p>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-xl text-slate-400 group-hover:bg-slate-900 group-hover:text-white transition-all">
                                <ArrowRight size={18} />
                            </div>
                        </div>
                    </div>
                )) : (
                    <div className="bg-white p-20 rounded-[40px] text-center border border-dashed border-slate-200">
                        <Settings className="mx-auto text-slate-200 mb-4" size={40} />
                        <p className="text-slate-400 font-black uppercase text-xs tracking-widest">Nenhum contrato ou parcelamento identificado.</p>
                    </div>
                )}
            </div>
        )}

        {/* --- TELA 3: DASHBOARD --- */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center"><TrendingDown size={20}/></div>
                    <h3 className="font-black uppercase text-xs text-slate-400 tracking-widest">Por Categoria ({theme.label})</h3>
                </div>
                <div className="space-y-6">
                    {Object.entries(categorySummary).sort((a:any, b:any) => b[1] - a[1]).map(([cat, val]: any) => (
                        <div key={cat}>
                            <div className="flex justify-between text-[10px] font-black uppercase mb-2">
                                <span>{cat}</span>
                                <span className="text-slate-400">R$ {val.toLocaleString('pt-BR')}</span>
                            </div>
                            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000" style={{ width: `${(val / ((totalPendente + totalPago) || 1)) * 100}%` }}></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center"><Store size={20}/></div>
                    <h3 className="font-black uppercase text-xs text-slate-400 tracking-widest">Por Unidade ({theme.label})</h3>
                </div>
                <div className="space-y-6">
                    {Object.entries(unitSummary).sort((a:any, b:any) => b[1] - a[1]).map(([unit, val]: any) => (
                        <div key={unit}>
                            <div className="flex justify-between text-[10px] font-black uppercase mb-2">
                                <span>{unit}</span>
                                <span className="text-slate-400">R$ {val.toLocaleString('pt-BR')}</span>
                            </div>
                            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${(val / ((totalPendente + totalPago) || 1)) * 100}%` }}></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
          </div>
        )}

        {/* --- MODAL DRILL-DOWN --- */}
        {selectedGroup && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[60] flex items-center justify-end p-4">
                <div className="bg-white w-full max-w-2xl h-full rounded-[40px] shadow-2xl flex flex-col animate-in slide-in-from-right duration-500 overflow-hidden">
                    <div className="p-10 flex justify-between items-center border-b border-slate-50 bg-slate-50/30">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="px-2 py-1 bg-blue-600 text-white text-[8px] font-black uppercase rounded">Contrato Ativo</span>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedGroup.category}</p>
                            </div>
                            <h2 className="text-2xl font-black text-slate-800 uppercase italic tracking-tighter">{selectedGroup.supplier}</h2>
                        </div>
                        <button onClick={() => setSelectedGroup(null)} className="p-4 bg-white border border-slate-100 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all shadow-sm"><X /></button>
                    </div>
                    <div className="p-10 flex-1 overflow-y-auto space-y-8">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 shadow-inner">
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1 tracking-widest">Comprometimento Total</p>
                                <p className="text-xl font-black text-slate-800 italic">R$ {selectedGroup.totalValue.toLocaleString('pt-BR')}</p>
                            </div>
                            <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 shadow-inner">
                                <p className="text-[9px] font-black text-emerald-600 uppercase mb-1 tracking-widest">Progresso de Quitação</p>
                                <p className="text-xl font-black text-emerald-700 italic">{Math.round((selectedGroup.paidCount / selectedGroup.totalCount) * 100)}% Pago</p>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-6">
                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cronograma de Pagamentos</h5>
                                <span className="text-[9px] font-black bg-slate-100 px-3 py-1 rounded-full text-slate-500">{selectedGroup.totalCount} Parcelas</span>
                            </div>
                            <div className="space-y-3">
                                {selectedGroup.items.sort((a:any, b:any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map((item: any) => (
                                    <div key={item.id} className="flex justify-between items-center p-5 border border-slate-50 rounded-[24px] bg-white hover:border-blue-100 hover:shadow-sm transition-all group">
                                        <div className="flex gap-4 items-center">
                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${item.status === 'PAGO' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                                                P{item.currentInstallment}
                                            </div>
                                            <div>
                                                <p className="text-xs font-black text-slate-800 uppercase">{new Date(item.dueDate).toLocaleDateString('pt-BR')}</p>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">{item.status}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <p className="text-sm font-black text-slate-900 italic">R$ {item.value.toLocaleString('pt-BR')}</p>
                                            <button onClick={() => toggleStatus(item.id, item.status)} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${item.status === 'PAGO' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-300 hover:text-orange-500 hover:bg-orange-50'}`}>
                                                {item.status === 'PAGO' ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                                            </button>
                                            <button onClick={() => handleDeleteItem(item.id)} className="w-8 h-8 rounded-full bg-slate-50 text-slate-300 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-all" title="Excluir item">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* --- MODAL: NOVO REGISTRO (ADAPTÁVEL) --- */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
              <div className={`p-8 border-b border-slate-50 flex justify-between items-center ${operationType === 'INCOME' ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white ${operationType === 'INCOME' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
                        <Calendar size={20} />
                    </div>
                    <h2 className="text-xl font-black uppercase italic tracking-tighter">Novo {operationType === 'INCOME' ? 'Recebimento' : 'Pagamento'}</h2>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="bg-white p-2 rounded-full border border-slate-100 text-slate-300 hover:text-slate-600 transition-all shadow-sm">
                    <X size={20} />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-8 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">{theme.entity}</label>
                        <input required className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-blue-500" placeholder={operationType === 'INCOME' ? "Ex: Cliente João Silva" : "Ex: Telecel Aluguel"} value={formData.supplier} onChange={e => setFormData({...formData, supplier: e.target.value})} />
                    </div>
                    <div className="col-span-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Descrição Adicional</label>
                        <input className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-blue-500" placeholder="Opcional..." value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                    </div>

                    {/* *** NOVO: SELECT DINÂMICO DE CATEGORIA *** */}
                    <div className="col-span-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Categoria da Despesa</label>
                        <select className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-blue-500 text-slate-700" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                            {(operationType === 'INCOME' ? incomeCategories : expenseCategories).map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Valor (R$)</label>
                        <input type="number" step="0.01" required className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-black outline-blue-500" value={formData.value} onChange={e => setFormData({...formData, value: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Vencimento (1ª Parcela)</label>
                        <input type="date" required className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-blue-500" value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Unidade / Loja</label>
                        <select className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-blue-500" value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>
                            <option value="MATRIZ">MATRIZ</option>
                            <option value="FILIAL">FILIAL</option>
                            <option value="LOJAS SAMSUNG">LOJAS SAMSUNG</option>
                            <option value="LOJAS TIM">LOJAS TIM</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">{theme.destination}</label>
                        <select className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-blue-500" value={formData.payer} onChange={e => setFormData({...formData, payer: e.target.value})}>
                            <option value="RMC">RMC</option>
                            <option value="MRF">MRF</option>
                            <option value="CMR">CMR</option>
                            <option value="MATRIZ">MATRIZ</option>
                        </select>
                    </div>
                </div>

                <div className={`p-6 rounded-[28px] border space-y-4 ${operationType === 'INCOME' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'}`}>
                    <div className="flex items-center gap-3">
                        <input type="checkbox" className={`w-5 h-5 ${operationType === 'INCOME' ? 'accent-emerald-600' : 'accent-blue-600'}`} checked={formData.isRecurring} onChange={e => setFormData({...formData, isRecurring: e.target.checked})} />
                        <label className={`text-[11px] font-black uppercase ${operationType === 'INCOME' ? 'text-emerald-700' : 'text-blue-700'}`}>É Recorrente / Parcelado?</label>
                    </div>
                    {!formData.isRecurring && (
                        <div>
                            <label className={`text-[10px] font-black uppercase mb-1 block ${operationType === 'INCOME' ? 'text-emerald-700' : 'text-blue-700'}`}>Parcelar em quantas vezes?</label>
                            <input type="number" min="1" className={`w-full bg-white border rounded-xl p-3 text-sm font-black outline-none ${operationType === 'INCOME' ? 'border-emerald-100 text-emerald-900' : 'border-blue-100 text-blue-900'}`} value={formData.installments} onChange={e => setFormData({...formData, installments: e.target.value})} />
                        </div>
                    )}
                </div>

                <button type="submit" className={`w-full text-white p-5 rounded-2xl font-black uppercase text-xs transition-all shadow-lg active:scale-95 ${operationType === 'INCOME' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-blue-600'}`}>
                    Confirmar e Registrar
                </button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}