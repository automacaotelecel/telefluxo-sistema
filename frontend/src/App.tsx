import { useState, useEffect } from 'react';
import TaskList from "./components/TaskList";
import TaskDashboard from "./components/TaskDashboard";
import UserList from "./components/UserList";
import NewUserModal from "./components/NewUserModal";
import NewTaskModal from "./components/NewTaskModal";
import Login from "./components/Login";
import Agenda from "./components/Agenda"; 
import ManagerDashboard from "./components/ManagerDashboard"; 
import SalesModule from "./components/SalesModule"; 
import NotificationBell from "./components/NotificationBell";
import Home from "./components/Home";
import DeptBulletin from "./components/DeptBulletin";
import FinanceModule from "./components/FinanceModule"; 
import StockModule from "./components/StockModule"; 
import { 
  FileText, CheckCircle, LayoutDashboard, Users, LogOut, 
  Calendar, BarChart3, ChevronDown, ChevronRight, Circle, Plus,
  TrendingUp, Home as HomeIcon, MessageSquare, DollarSign,
  Package, Menu, X // <--- ADICIONEI OS ÍCONES 'Menu' e 'X' AQUI
} from 'lucide-react';

function App() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState('home'); 
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  
  // --- NOVO: Estado para controlar o menu no celular ---
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [expanded, setExpanded] = useState({ general: false, mine: true, info: false });

  useEffect(() => {
    const savedUser = localStorage.getItem('telefluxo_user');
    if (savedUser && savedUser !== "undefined") {
      try { 
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser); 
        setCurrentView('home'); 
      } catch (e) { 
        localStorage.removeItem('telefluxo_user'); 
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handleOpenModal = () => setIsNewTaskModalOpen(true);
    window.addEventListener('openNewTaskModal', handleOpenModal);
    return () => window.removeEventListener('openNewTaskModal', handleOpenModal);
  }, []);

  // --- LÓGICA DE PERMISSÕES (RBAC) ---
  const userRole = user?.role || '';
  const isAdmin = user?.isAdmin === true || Number(user?.isAdmin) === 1;
  const isManager = user?.role?.toLowerCase().includes('gerente') || user?.role?.toLowerCase().includes('gestor');

  // Hierarquia: Quem pode ver o quê?
  const canViewSales = ['CEO', 'DIRETOR', 'LOJA'].includes(userRole) || isAdmin;
  const canViewStock = ['CEO', 'DIRETOR', 'LOJA'].includes(userRole) || isAdmin;
  const canViewFinance = ['CEO', 'DIRETOR', 'ADM'].includes(userRole) || isAdmin;
  const canViewTeam = ['CEO', 'DIRETOR', 'ADM'].includes(userRole) || isAdmin;

  const isStoreOnly = userRole === 'LOJA';
  // -----------------------------------

  const handleLogout = () => { localStorage.clear(); window.location.reload(); };

  // --- NOVO: Função auxiliar para fechar o menu ao clicar em um item (UX Mobile) ---
  const handleNavigate = (view: string) => {
      setCurrentView(view);
      setIsMobileMenuOpen(false); // Fecha o menu no celular automaticamente
  };

  if (isLoading) return <div className="h-screen bg-slate-900 flex items-center justify-center text-white font-black uppercase tracking-widest animate-pulse">Iniciando TeleFluxo...</div>;
  
  if (!user) return <Login onLogin={(data:any) => { 
    setUser(data); 
    localStorage.setItem('telefluxo_user', JSON.stringify(data));
    setCurrentView('home');
  }} />;

  const SubMenuItem = ({ label, view, active }: any) => (
    <div onClick={() => handleNavigate(view)} className={`pl-12 pr-4 py-2 cursor-pointer flex items-center gap-2 text-[11px] font-black uppercase tracking-tighter transition-all hover:text-white ${active ? 'text-orange-500' : 'text-slate-500'}`}>
      <Circle size={6} fill={active ? "currentColor" : "transparent"} /> {label}
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      
      {/* --- BACKDROP ESCURO (SÓ APARECE NO CELULAR QUANDO O MENU ESTÁ ABERTO) --- */}
      {isMobileMenuOpen && (
        <div 
            className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* --- MENU LATERAL (ASIDE) RESPONSIVO --- */}
      {/* Alterações: 'fixed' no mobile, 'relative' no PC. Efeito de slide com translate-x */}
      <aside className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white flex flex-col shadow-2xl transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 text-xl font-bold border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-600 rounded text-white flex items-center justify-center font-black italic shadow-lg">T</div>
              <span className="tracking-tighter font-black">TELE<span className="text-orange-500">FLUXO</span></span>
          </div>
          {/* Botão de Fechar (X) - Só aparece no celular */}
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
              <X size={24} />
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 mt-2 overflow-y-auto custom-scrollbar">
          
          <div onClick={() => handleNavigate('home')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'home' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <HomeIcon size={18} /> Início
          </div>

          {(isAdmin || isManager) && !isStoreOnly && (
            <div>
              <div onClick={() => setExpanded({...expanded, general: !expanded.general})} className={`p-3 rounded-xl cursor-pointer flex items-center justify-between transition-all ${currentView.startsWith('all') ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
                <div className="flex gap-3 items-center font-bold text-sm"><LayoutDashboard size={18} /> Visão Geral</div>
                {expanded.general ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
              </div>
              {expanded.general && (
                <div className="mt-1 space-y-1">
                  <SubMenuItem label="Total" view="all" active={currentView === 'all'} />
                  <SubMenuItem label="Pendentes" view="all_pending" active={currentView === 'all_pending'} />
                  <SubMenuItem label="Em Tratativa" view="all_doing" active={currentView === 'all_doing'} />
                  <SubMenuItem label="Finalizadas" view="all_done" active={currentView === 'all_done'} />
                </div>
              )}
            </div>
          )}

          <div>
            <div onClick={() => setExpanded({...expanded, mine: !expanded.mine})} className={`p-3 rounded-xl cursor-pointer flex items-center justify-between transition-all ${currentView.startsWith('mine_') ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
              <div className="flex gap-3 items-center font-bold text-sm"><FileText size={18} /> Minhas Demandas</div>
              {expanded.mine ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
            </div>
            {expanded.mine && (
              <div className="mt-1 space-y-1">
                <SubMenuItem label="Pendentes" view="mine_pending" active={currentView === 'mine_pending'} />
                <SubMenuItem label="Em Tratativa" view="mine_doing" active={currentView === 'mine_doing'} />
                <SubMenuItem label="Finalizadas" view="mine_done" active={currentView === 'mine_done'} />
              </div>
            )}
          </div>

          <div onClick={() => handleNavigate('completed')} className={`p-3 rounded-xl cursor-pointer flex gap-3 font-bold text-sm transition-all ${currentView === 'completed' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <CheckCircle size={18} /> Histórico Geral
          </div>

          <div>
            <div onClick={() => setExpanded({...expanded, info: !expanded.info})} className={`p-3 rounded-xl cursor-pointer flex items-center justify-between transition-all ${currentView.startsWith('dept_') ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
              <div className="flex gap-3 items-center font-bold text-sm"><MessageSquare size={18} /> Informativos</div>
              {expanded.info ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
            </div>
            
            {expanded.info && (
              <div className="mt-1 space-y-1">
                {(isAdmin || isManager) ? (
                  <>
                    <SubMenuItem label="Samsung" view="dept_Samsung" active={currentView === 'dept_Samsung'} />
                    <SubMenuItem label="Tim" view="dept_Tim" active={currentView === 'dept_Tim'} />
                    <SubMenuItem label="Motorola" view="dept_Motorola" active={currentView === 'dept_Motorola'} />
                    <SubMenuItem label="Automação" view="dept_Automação" active={currentView === 'dept_Automação'} />
                    <SubMenuItem label="Financeiro" view="dept_Financeiro" active={currentView === 'dept_Financeiro'} />
                  </>
                ) : (
                  <SubMenuItem 
                    label={user.operation || "Meu Setor"} 
                    view={`dept_${user.operation}`} 
                    active={currentView === `dept_${user.operation}`} 
                  />
                )}
              </div>
            )}
          </div>

          {canViewFinance && (
            <div 
              onClick={() => handleNavigate('finance')} 
              className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'finance' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <DollarSign size={18} /> Controle Financeiro
            </div>
          )}

          {canViewStock && (
            <div 
              onClick={() => handleNavigate('stock')} 
              className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'stock' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              <Package size={18} /> Controle de Estoque
            </div>
          )}

          {canViewSales && (
              <div onClick={() => handleNavigate('sales_dash')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'sales_dash' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
                  <TrendingUp size={18} /> Controle de Vendas
              </div>
          )}

          <div onClick={() => handleNavigate('agenda')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'agenda' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <Calendar size={18} /> Agenda Pessoal
          </div>

          {(isAdmin || isManager) && (
            <>
                <div onClick={() => handleNavigate('manager_dash')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'manager_dash' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
                    <BarChart3 size={18} /> Produtividade Equipe
                </div>
            </>
          )}

          {canViewTeam && (
            <div className="pt-4 mt-4 border-t border-slate-800">
                <p className="px-3 text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Configurações</p>
                <div onClick={() => handleNavigate('team')} className={`p-3 rounded-xl cursor-pointer flex gap-3 font-bold text-sm transition-all ${currentView === 'team' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
                  <Users size={18} /> Equipe
               </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800 flex items-center gap-3 bg-slate-950/20">
            <div className="w-10 h-10 rounded-full bg-orange-600 flex items-center justify-center text-sm font-black border-2 border-slate-700 shadow-inner shrink-0">{user?.name?.charAt(0)}</div>
            <div className="flex-1 overflow-hidden">
              <span className="text-sm font-bold truncate block uppercase tracking-tighter">{user?.name}</span>
              <span className="text-[9px] text-slate-500 font-black uppercase truncate block tracking-widest italic">{user?.role}</span>
            </div>
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-500"><LogOut size={18}/></button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden w-full">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shadow-sm shrink-0">
            <div className="flex items-center gap-3">
                {/* --- BOTÃO HAMBURGUER (SÓ NO CELULAR) --- */}
                <button 
                    onClick={() => setIsMobileMenuOpen(true)} 
                    className="md:hidden text-slate-600 hover:text-orange-600 transition-colors"
                >
                    <Menu size={24} />
                </button>

                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span> 
                    <span className="hidden md:inline">Grupo Telecel •</span> 
                    {currentView.replace(/_/g, ' ').toUpperCase()}
                </div>
            </div>
            <NotificationBell currentUser={user} />
        </header>

        <div className="flex-1 overflow-hidden relative flex flex-col">
            
            {currentView === 'home' ? (
                <Home currentUser={user} />
            ) : currentView === 'finance' ? (
                <FinanceModule />
            ) : currentView === 'stock' ? ( 
                <StockModule />
            ) : currentView.startsWith('dept_') ? (
                <DeptBulletin department={currentView.replace('dept_', '')} currentUser={user} />
            ) : currentView === 'detail' && selectedTask ? (
                <TaskDashboard task={selectedTask} currentUser={user} onBack={() => setCurrentView('home')} />
            ) : currentView === 'agenda' ? ( 
                <Agenda currentUser={user} />
            ) : currentView === 'manager_dash' ? (
                <ManagerDashboard currentUser={user} />
            ) : currentView === 'sales_dash' ? (
                <SalesModule />
            ) : currentView === 'team' ? (
                <div className="flex-1 p-4 md:p-8 overflow-y-auto">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                        <div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">Equipe Telecel</h2>
                            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Gestão de acessos e cargos do sistema.</p>
                        </div>
                        <button onClick={() => setIsUserModalOpen(true)} className="w-full md:w-auto bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase flex gap-2 hover:bg-slate-800 shadow-lg transition-all active:scale-95 justify-center items-center">
                            <Plus size={16} /> Novo Membro
                        </button>
                    </div>
                    <UserList />
                </div>
            ) : (
                <TaskList onOpenTask={(task:any) => { setSelectedTask(task); setCurrentView('detail'); }} viewMode={currentView} currentUser={user} />
            )}
        </div>
      </main>
      
      <NewUserModal isOpen={isUserModalOpen} onClose={() => setIsUserModalOpen(false)} />
      {isNewTaskModalOpen && (
        <NewTaskModal isOpen={isNewTaskModalOpen} onClose={() => setIsNewTaskModalOpen(false)} currentUser={user} onTaskCreated={() => { setIsNewTaskModalOpen(false); window.location.reload(); }} />
      )}
    </div>
  );
}

export default App;