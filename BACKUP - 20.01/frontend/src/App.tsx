import { useState, useEffect } from 'react';
import TaskList from "./components/TaskList";
import TaskDashboard from "./components/TaskDashboard";
import UserList from "./components/UserList";
import NewUserModal from "./components/NewUserModal";
import NewTaskModal from "./components/NewTaskModal";
import Login from "./components/Login";
import Agenda from "./components/Agenda"; 
import ManagerDashboard from "./components/ManagerDashboard";
import NotificationBell from "./components/NotificationBell";
import { FileText, CheckCircle, LayoutDashboard, Users, LogOut, Calendar, BarChart3 } from 'lucide-react';

function App() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem('telefluxo_user');
    const savedView = localStorage.getItem('telefluxo_view');
    
    if (savedUser && savedUser !== "undefined") {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed && parsed.name) {
          setUser(parsed);
        }
      } catch (e) {
        console.error("Erro ao ler usuário do cache");
        localStorage.removeItem('telefluxo_user');
      }
    }
    if (savedView) setCurrentView(savedView);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handleOpenModal = () => setIsNewTaskModalOpen(true);
    window.addEventListener('openNewTaskModal', handleOpenModal);
    return () => window.removeEventListener('openNewTaskModal', handleOpenModal);
  }, []);

  useEffect(() => {
    if (user) localStorage.setItem('telefluxo_view', currentView);
  }, [currentView, user]);

  const handleLogin = (userData: any) => {
    setUser(userData);
    localStorage.setItem('telefluxo_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    localStorage.clear();
    setUser(null);
    setCurrentView('dashboard');
    window.location.reload(); // Garante limpeza total
  };

  if (isLoading) return <div className="h-screen bg-slate-900 flex items-center justify-center text-white font-bold uppercase tracking-widest animate-pulse">Iniciando TeleFluxo...</div>;

  if (!user) return <Login onLogin={handleLogin} />;

  // VERIFICAÇÕES DE SEGURANÇA PARA EVITAR TELA BRANCA
  const isAdmin = user?.isAdmin === true;
  const isManager = user?.role?.toLowerCase().includes('gerente') || user?.role?.toLowerCase().includes('gestor');

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800">
      <aside className="w-64 bg-slate-900 text-white flex flex-col shadow-xl z-20">
        <div className="p-6 text-xl font-bold border-b border-slate-800 flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-600 rounded text-white flex items-center justify-center font-black">T</div>
          <span className="tracking-tighter">TELE<span className="text-orange-500">FLUXO</span></span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 mt-2 font-medium text-sm">
          <div onClick={() => setCurrentView('dashboard')} className={`p-3 rounded-xl cursor-pointer flex gap-3 transition-all ${currentView === 'dashboard' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <LayoutDashboard size={18} /> Visão Geral
          </div>
          <div onClick={() => setCurrentView('my_requests')} className={`p-3 rounded-xl cursor-pointer flex gap-3 transition-all ${currentView === 'my_requests' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <FileText size={18} /> Minhas Demandas
          </div>
          <div onClick={() => setCurrentView('completed')} className={`p-3 rounded-xl cursor-pointer flex gap-3 transition-all ${currentView === 'completed' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <CheckCircle size={18} /> Finalizadas
          </div>
          <div onClick={() => setCurrentView('agenda')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 transition-all ${currentView === 'agenda' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
            <Calendar size={18} /> Agenda Pessoal
          </div>

          {(isAdmin || isManager) && (
            <div onClick={() => setCurrentView('manager_dash')} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 transition-all ${currentView === 'manager_dash' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
              <BarChart3 size={18} /> BI da Gestão
            </div>
          )}

          {isAdmin && (
            <div className="pt-4 mt-4 border-t border-slate-800">
               <p className="px-3 text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Admin</p>
               <div onClick={() => setCurrentView('team')} className={`p-3 rounded-xl cursor-pointer flex gap-3 transition-all ${currentView === 'team' ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>
                <Users size={18} /> Equipe
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-600 flex items-center justify-center text-sm font-black border-2 border-slate-700 shadow-inner">
                {user?.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 overflow-hidden">
              <span className="text-sm font-bold truncate block">{user?.name || 'Usuário'}</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase truncate block tracking-tighter italic">
                {user?.role || 'Colaborador'} • TELECEL
              </span>
            </div>
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-500 p-1"><LogOut size={18}/></button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                GRUPO TELECEL • {currentView.replace('_', ' ').toUpperCase()}
            </div>
            <NotificationBell currentUser={user} />
        </header>

        <div className="flex-1 flex overflow-hidden relative">
            <NewUserModal isOpen={isUserModalOpen} onClose={() => setIsUserModalOpen(false)} />
            
            {isNewTaskModalOpen && (
              <NewTaskModal 
                  isOpen={isNewTaskModalOpen} 
                  onClose={() => setIsNewTaskModalOpen(false)} 
                  currentUser={user} 
                  onTaskCreated={() => {
                    setIsNewTaskModalOpen(false);
                    window.location.reload();
                  }}
              />
            )}

            {currentView === 'detail' && selectedTask ? (
                <TaskDashboard task={selectedTask} currentUser={user} onBack={() => setCurrentView('dashboard')} />
            ) : currentView === 'agenda' ? ( 
                <Agenda currentUser={user} />
            ) : currentView === 'manager_dash' ? (
                <ManagerDashboard currentUser={user} />
            ) : currentView === 'team' ? (
                <div className="flex-1 p-8 overflow-y-auto">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-black uppercase tracking-tight">Equipe</h2>
                        <button onClick={() => setIsUserModalOpen(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase flex gap-2 hover:bg-slate-800 shadow-lg">
                            <Users size={16} /> Novo Membro
                        </button>
                    </div>
                    <UserList />
                </div>
            ) : (
                <TaskList 
                    onOpenTask={(task:any) => { setSelectedTask(task); setCurrentView('detail'); }} 
                    viewMode={currentView === 'dashboard' ? 'all' : currentView === 'my_requests' ? 'mine' : 'completed'} 
                    currentUser={user} 
                />
            )}
        </div>
      </main>
    </div>
  );
}

export default App;