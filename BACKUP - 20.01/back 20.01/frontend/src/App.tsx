import { useState, useEffect } from 'react';
import TaskList from "./components/TaskList";
import TaskDashboard from "./components/TaskDashboard";
import UserList from "./components/UserList";
import NewUserModal from "./components/NewUserModal";
import NewTaskModal from "./components/NewTaskModal";
import Login from "./components/Login";
import Agenda from "./components/Agenda"; 
import ManagerDashboard from "./components/ManagerDashboard"; // Produtividade (Antigo)
import SalesDashboard from "./components/SalesDashboard";     // Vendas (Novo)
import NotificationBell from "./components/NotificationBell";
import { 
  FileText, CheckCircle, LayoutDashboard, Users, LogOut, 
  Calendar, BarChart3, ChevronDown, ChevronRight, Circle, Plus,
  TrendingUp // Ícone novo para Vendas
} from 'lucide-react';

function App() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState('all');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  
  const [expanded, setExpanded] = useState({ general: true, mine: false });

  useEffect(() => {
    const savedUser = localStorage.getItem('telefluxo_user');
    if (savedUser && savedUser !== "undefined") {
      try { setUser(JSON.parse(savedUser)); } catch (e) { localStorage.removeItem('telefluxo_user'); }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handleOpenModal = () => setIsNewTaskModalOpen(true);
    window.addEventListener('openNewTaskModal', handleOpenModal);
    return () => window.removeEventListener('openNewTaskModal', handleOpenModal);
  }, []);

  const handleLogout = () => { localStorage.clear(); window.location.reload(); };

  if (isLoading) return <div className="h-screen bg-slate-900 flex items-center justify-center text-white font-black uppercase tracking-widest animate-pulse">Iniciando TeleFluxo...</div>;
  if (!user) return <Login onLogin={(data:any) => { setUser(data); localStorage.setItem('telefluxo_user', JSON.stringify(data)); }} />;

  const isAdmin = user?.isAdmin === true;
  const isManager = user?.role?.toLowerCase().includes('gerente') || user?.role?.toLowerCase().includes('gestor');

  const SubMenuItem = ({ label, view, active }: any) => (
    <div onClick={() => setCurrentView(view)} className={`pl-12 pr-4 py-2 cursor-pointer flex items-center gap-2 text-[11px] font-black uppercase tracking-tighter transition-all hover:text-white ${active ? 'text-orange-500' : 'text-slate-500'}`}>
      <Circle size={6} fill={active ? "currentColor" : "transparent"} /> {label}
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800">
      <aside className="w-64 bg-slate-900 text-white flex flex-col shadow-xl z-20">
        <div className="p-6 text-xl font-bold border-b border-slate-800 flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-600 rounded text-white flex items-center justify-center font-black italic shadow-lg">T</div>
          <span className="tracking-tighter font-black">TELE<span className="text-orange-500">FLUXO</span></span>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 mt-2 overflow-y-auto">
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

          <div onClick={() => setCurrentView('completed')} className={`p-3 rounded-xl cursor-pointer flex gap-3 font-bold text-sm transition-all ${currentView === 'completed' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <CheckCircle size={18} /> Histórico Geral
          </div>

          <div onClick={() => setCurrentView('agenda')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'agenda' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <Calendar size={18} /> Agenda Pessoal
          </div>

          {(isAdmin || isManager) && (
            <>
                <div onClick={() => setCurrentView('manager_dash')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'manager_dash' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
                    <BarChart3 size={18} /> Produtividade Equipe
                </div>
                
                {/* BOTÃO NOVO PARA O BI DE VENDAS (SEPARADO) */}
                <div onClick={() => setCurrentView('sales_dash')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 font-bold text-sm transition-all ${currentView === 'sales_dash' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
                    <TrendingUp size={18} /> BI Vendas (Beta)
                </div>
            </>
          )}

          {isAdmin && (
            <div className="pt-4 mt-4 border-t border-slate-800">
               <p className="px-3 text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Configurações</p>
               <div onClick={() => setCurrentView('team')} className={`p-3 rounded-xl cursor-pointer flex gap-3 font-bold text-sm transition-all ${currentView === 'team' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
                <Users size={18} /> Equipe
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800 flex items-center gap-3 bg-slate-950/20">
            <div className="w-10 h-10 rounded-full bg-orange-600 flex items-center justify-center text-sm font-black border-2 border-slate-700 shadow-inner">{user?.name?.charAt(0)}</div>
            <div className="flex-1 overflow-hidden">
              <span className="text-sm font-bold truncate block uppercase tracking-tighter">{user?.name}</span>
              <span className="text-[9px] text-slate-500 font-black uppercase truncate block tracking-widest italic">{user?.role}</span>
            </div>
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-500"><LogOut size={18}/></button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span> Grupo Telecel • {currentView.replace(/_/g, ' ').toUpperCase()}
            </div>
            <NotificationBell currentUser={user} />
        </header>

        <div className="flex-1 overflow-hidden relative flex flex-col">
            {currentView === 'detail' && selectedTask ? (
                <TaskDashboard task={selectedTask} currentUser={user} onBack={() => setCurrentView('all')} />
            ) : currentView === 'agenda' ? ( 
                <Agenda currentUser={user} />
            ) : currentView === 'manager_dash' ? (
                <ManagerDashboard currentUser={user} />
            ) : currentView === 'sales_dash' ? (
                <SalesDashboard />
            ) : currentView === 'team' ? (
                <div className="flex-1 p-8 overflow-y-auto">
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">Equipe Telecel</h2>
                            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Gestão de acessos e cargos do sistema.</p>
                        </div>
                        <button onClick={() => setIsUserModalOpen(true)} className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase flex gap-2 hover:bg-slate-800 shadow-lg transition-all active:scale-95">
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