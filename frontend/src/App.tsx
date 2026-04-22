import { useState, useEffect } from 'react';
import TaskList from "./components/TaskList";
import TaskDashboard from "./components/TaskDashboard";
import UserList from "./components/UserList";
import NewUserModal from "./components/NewUserModal";
import NewTaskModal from "./components/NewTaskModal";
import Login from "./components/Login";
import Agenda from "./components/Agenda";
import ManagerDashboard from "./components/ManagerDashboard";
import SalesDashboard from "./components/SalesDashboard";
import NotificationBell from "./components/NotificationBell";
import Home from "./components/home";
import DeptBulletin from "./components/DeptBulletin";
import FinanceModule from "./components/FinanceModule";
import ControleStone from "./components/ControleStone";
import StockModule from "./components/StockModule";
import PriceTablePage from './components/PriceTablePage';
import { EstoqueVendas } from './components/EstoqueVendas';
import EstoqueInteligente from './components/EstoqueInteligente';
import ComparativoAnual from './components/ComparativoAnual';
import AuditoriaLojas from './components/AuditoriaLojas';
import EstoqueDetalhado from './components/EstoqueDetalhado';
import SolicitacoesModule from './components/SolicitacoesModule';
import Stockout from './components/StockOut';
import ComparativosModule from './components/ComparativosModule';
import ComprasVendas from './components/ComprasVendas'; 
import {
  FileText, CheckCircle, LayoutDashboard, Users, LogOut,
  Calendar, BarChart3, ChevronDown, ChevronRight, ChevronLeft, Circle, Plus,
  TrendingUp, Home as HomeIcon, MessageSquare, DollarSign,
  Package, Menu, X, Tag
} from 'lucide-react';

const DEFAULT_EXPANDED = {
  general: false,
  mine: false,
  info: false,
  stock: false,
  sales: false,
  finance: false,
};

function App() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState('home');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(DEFAULT_EXPANDED);

  useEffect(() => {
    try {
      const savedCollapsed = localStorage.getItem('telefluxo_sidebar_collapsed');
      if (savedCollapsed === 'true') setIsSidebarCollapsed(true);
    } catch (e) {
      console.error(e);
    }

    const savedUser = localStorage.getItem('telefluxo_user');
    if (savedUser && savedUser !== "undefined") {
      try {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
        setCurrentView('home');
        setExpanded(DEFAULT_EXPANDED);
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

  useEffect(() => {
    try {
      localStorage.setItem('telefluxo_sidebar_collapsed', String(isSidebarCollapsed));
    } catch (e) {
      console.error(e);
    }
  }, [isSidebarCollapsed]);

  const userRole = user?.role || '';
  const isAdmin = user?.isAdmin === true || Number(user?.isAdmin) === 1;
  const isManager = user?.role?.toLowerCase().includes('gerente') || user?.role?.toLowerCase().includes('gestor');

  const canViewSales = ['CEO', 'DIRETOR', 'LOJA'].includes(userRole) || isAdmin;
  const canViewStock = ['CEO', 'DIRETOR', 'LOJA'].includes(userRole) || isAdmin;
  const canViewFinance = ['CEO', 'DIRETOR', 'ADM'].includes(userRole) || isAdmin;
  const canViewTeam = ['CEO', 'DIRETOR', 'ADM'].includes(userRole) || isAdmin;
  const canViewComparativos = userRole === 'ADM' || isAdmin;
  const canViewComprasVendas = userRole === 'ADM' || isAdmin;
  const isStoreOnly = userRole === 'LOJA';

  const handleLogout = () => {
    localStorage.clear();
    window.location.reload();
  };

  const handleNavigate = (view: string) => {
    setCurrentView(view);
    setIsMobileMenuOpen(false);
  };

  const resetExpandedMenus = () => setExpanded(DEFAULT_EXPANDED);

  const handleSectionToggle = (key: keyof typeof DEFAULT_EXPANDED) => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      setExpanded({ ...DEFAULT_EXPANDED, [key]: true });
      return;
    }

    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  const viewTitles: Record<string, string> = {
    finance: 'CONTAS A PAGAR E RECEBER',
    controle_stone: 'CONCILIAÇÃO STONE',
    comparativos_pdf: 'COMPARATIVO DE OFERTAS',
    comparativo: 'VENDAS ANUAIS',
    compras_vendas: 'COMPRAS X VENDAS', 
  };

  const currentViewLabel = viewTitles[currentView] || currentView.replace(/_/g, ' ').toUpperCase();

  if (isLoading) {
    return (
      <div className="h-screen bg-slate-900 flex items-center justify-center text-white font-black uppercase tracking-widest animate-pulse">
        Iniciando TeleFluxo...
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onLogin={(data: any) => {
          setUser(data);
          localStorage.setItem('telefluxo_user', JSON.stringify(data));
          setCurrentView('home');
          setExpanded(DEFAULT_EXPANDED);
        }}
      />
    );
  }

  const SubMenuItem = ({ label, view, active }: any) => {
    if (isSidebarCollapsed) return null;

    return (
      <div
        onClick={() => handleNavigate(view)}
        className={`pl-12 pr-4 py-2 cursor-pointer flex items-center gap-2 text-[11px] font-black uppercase tracking-tighter transition-all hover:text-white ${active ? 'text-orange-500' : 'text-slate-500'}`}
      >
        <Circle size={6} fill={active ? "currentColor" : "transparent"} /> {label}
      </div>
    );
  };

  const NavButton = ({
    icon: Icon,
    label,
    active,
    onClick,
    hasChevron = false,
    chevronOpen = false,
    customClass = '',
  }: any) => (
    <div
      onClick={onClick}
      title={label}
      className={`p-3 rounded-xl cursor-pointer flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} transition-all ${active ? customClass : 'text-slate-400 hover:bg-slate-800'}`}
    >
      <div className={`flex items-center gap-3 font-bold text-sm ${isSidebarCollapsed ? 'justify-center' : ''}`}>
        <Icon size={18} />
        {!isSidebarCollapsed && <span>{label}</span>}
      </div>
      {!isSidebarCollapsed && hasChevron && (chevronOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-40 ${isSidebarCollapsed ? 'md:w-[92px]' : 'md:w-64'} w-64 bg-slate-900 text-white flex flex-col shadow-2xl transition-all duration-300 ease-in-out
          md:relative md:translate-x-0
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className={`border-b border-slate-800 flex items-center justify-between ${isSidebarCollapsed ? 'p-4' : 'p-6'}`}>
          <div className={`flex items-center gap-2 ${isSidebarCollapsed ? 'justify-center w-full md:w-auto' : ''}`}>
            <div className="w-8 h-8 bg-orange-600 rounded text-white flex items-center justify-center font-black italic shadow-lg shrink-0">T</div>
            {!isSidebarCollapsed && (
              <span className="tracking-tighter font-black">TELE<span className="text-orange-500">FLUXO</span></span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleSidebarCollapse}
              title={isSidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
              className="hidden md:flex text-slate-400 hover:text-white transition-colors"
            >
              {isSidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            </button>
            <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
              <X size={24} />
            </button>
          </div>
        </div>

        <nav className={`flex-1 ${isSidebarCollapsed ? 'p-3' : 'p-4'} space-y-1 mt-2 overflow-y-auto custom-scrollbar`}>
          <NavButton
            icon={HomeIcon}
            label="Início"
            active={currentView === 'home'}
            onClick={() => handleNavigate('home')}
            customClass="bg-orange-600 text-white shadow-lg"
          />

          {(isAdmin || isManager) && !isStoreOnly && (
            <div>
              <NavButton
                icon={LayoutDashboard}
                label="Visão Geral"
                active={currentView.startsWith('all')}
                onClick={() => handleSectionToggle('general')}
                hasChevron
                chevronOpen={expanded.general}
                customClass="bg-slate-800 text-white"
              />
              {expanded.general && !isSidebarCollapsed && (
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
            <NavButton
              icon={FileText}
              label="Minhas Demandas"
              active={currentView.startsWith('mine_')}
              onClick={() => handleSectionToggle('mine')}
              hasChevron
              chevronOpen={expanded.mine}
              customClass="bg-slate-800 text-white"
            />
            {expanded.mine && !isSidebarCollapsed && (
              <div className="mt-1 space-y-1">
                <SubMenuItem label="Pendentes" view="mine_pending" active={currentView === 'mine_pending'} />
                <SubMenuItem label="Em Tratativa" view="mine_doing" active={currentView === 'mine_doing'} />
                <SubMenuItem label="Finalizadas" view="mine_done" active={currentView === 'mine_done'} />
              </div>
            )}
          </div>

          <NavButton
            icon={CheckCircle}
            label="Histórico Geral"
            active={currentView === 'completed'}
            onClick={() => handleNavigate('completed')}
            customClass="bg-orange-600 text-white shadow-lg"
          />

          <div>
            <NavButton
              icon={MessageSquare}
              label="Informativos"
              active={currentView.startsWith('dept_')}
              onClick={() => handleSectionToggle('info')}
              hasChevron
              chevronOpen={expanded.info}
              customClass="bg-slate-800 text-white"
            />
            {expanded.info && !isSidebarCollapsed && (
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

          {canViewComparativos && (
            <NavButton
              icon={BarChart3}
              label="Comparativos"
              active={currentView === 'comparativos_pdf'}
              onClick={() => handleNavigate('comparativos_pdf')}
              customClass="bg-slate-800 text-white shadow-lg"
            />
          )}

          {canViewFinance && (
            <div>
              <NavButton
                icon={DollarSign}
                label="Controle Financeiro"
                active={['finance', 'controle_stone'].includes(currentView)}
                onClick={() => handleSectionToggle('finance')}
                hasChevron
                chevronOpen={expanded.finance}
                customClass="bg-emerald-600 text-white shadow-lg"
              />
              {expanded.finance && !isSidebarCollapsed && (
                <div className="mt-1 space-y-1">
                  <SubMenuItem label="Contas a pagar e receber" view="finance" active={currentView === 'finance'} />
                  <SubMenuItem label="Conciliação Stone" view="controle_stone" active={currentView === 'controle_stone'} />
                </div>
              )}
            </div>
          )}

          {canViewStock && (
            <div>
              <NavButton
                icon={Package}
                label="Controle de Estoque"
                active={['stock', 'estoque_vendas', 'estoque_inteligente', 'auditoria_lojas', 'estoque_detalhado', 'stockout', 'compras_vendas'].includes(currentView)}
                onClick={() => handleSectionToggle('stock')}
                hasChevron
                chevronOpen={expanded.stock}
                customClass="bg-indigo-600 text-white shadow-lg"
              />
              {expanded.stock && !isSidebarCollapsed && (
                <div className="mt-1 space-y-1">
                  <SubMenuItem label="Visão Geral" view="stock" active={currentView === 'stock'} />
                  <SubMenuItem label="Visão Detalhada" view="estoque_detalhado" active={currentView === 'estoque_detalhado'} />
                  <SubMenuItem label="Estoque x Vendas" view="estoque_vendas" active={currentView === 'estoque_vendas'} />
                  
                  {isAdmin && (
                    <SubMenuItem label="Compras x Vendas" view="compras_vendas" active={currentView === 'compras_vendas'} />
                  )}

                  <SubMenuItem label="Estoque Inteligente" view="estoque_inteligente" active={currentView === 'estoque_inteligente'} />
                  <SubMenuItem label="Stockout" view="stockout" active={currentView === 'stockout'} />
                  <SubMenuItem label="Auditoria Lojas" view="auditoria_lojas" active={currentView === 'auditoria_lojas'} />
                  </div>
              )}
            </div>
          )}

          {canViewSales && (
            <div>
              <NavButton
                icon={TrendingUp}
                label="Controle de Vendas"
                active={['sales_dash', 'comparativo'].includes(currentView)}
                onClick={() => handleSectionToggle('sales')}
                hasChevron
                chevronOpen={expanded.sales}
                customClass="bg-blue-600 text-white shadow-lg"
              />
              {expanded.sales && !isSidebarCollapsed && (
                <div className="mt-1 space-y-1">
                  <SubMenuItem label="Vendas Mensal" view="sales_dash" active={currentView === 'sales_dash'} />
                  <SubMenuItem label="Vendas anuais" view="comparativo" active={currentView === 'comparativo'} />
                </div>
              )}
            </div>
          )}

          {canViewSales && (
            <NavButton
              icon={Tag}
              label="Tabelas de Preço"
              active={currentView === 'price_table'}
              onClick={() => handleNavigate('price_table')}
              customClass="bg-indigo-500 text-white shadow-lg"
            />
          )}

          <NavButton
            icon={Calendar}
            label="Agenda Pessoal"
            active={currentView === 'agenda'}
            onClick={() => handleNavigate('agenda')}
            customClass="bg-orange-600 text-white shadow-lg"
          />

          {(isAdmin || isManager) && (
            <NavButton
              icon={BarChart3}
              label="Produtividade Equipe"
              active={currentView === 'manager_dash'}
              onClick={() => handleNavigate('manager_dash')}
              customClass="bg-orange-600 text-white shadow-lg"
            />
          )}

          <NavButton
            icon={MessageSquare}
            label="Solicitações"
            active={currentView === 'solicitacoes'}
            onClick={() => handleNavigate('solicitacoes')}
            customClass="bg-fuchsia-600 text-white shadow-lg"
          />

          {canViewTeam && (
            <div className={`pt-4 mt-4 border-t border-slate-800 ${isSidebarCollapsed ? 'px-0' : ''}`}>
              {!isSidebarCollapsed && (
                <p className="px-3 text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Configurações</p>
              )}
              <NavButton
                icon={Users}
                label="Equipe"
                active={currentView === 'team'}
                onClick={() => handleNavigate('team')}
                customClass="bg-slate-800 text-white"
              />
            </div>
          )}
        </nav>

        <div className={`border-t border-slate-800 bg-slate-950/20 ${isSidebarCollapsed ? 'p-3 flex justify-center' : 'p-4 flex items-center gap-3'}`}>
          <div className="w-10 h-10 rounded-full bg-orange-600 flex items-center justify-center text-sm font-black border-2 border-slate-700 shadow-inner shrink-0">
            {user?.name?.charAt(0)}
          </div>

          {!isSidebarCollapsed && (
            <div className="flex-1 overflow-hidden">
              <span className="text-sm font-bold truncate block uppercase tracking-tighter">{user?.name}</span>
              <span className="text-[9px] text-slate-500 font-black uppercase truncate block tracking-widest italic">{user?.role}</span>
            </div>
          )}

          <button onClick={handleLogout} title="Sair" className="text-slate-500 hover:text-red-500 shrink-0">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden w-full">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden text-slate-600 hover:text-orange-600 transition-colors"
            >
              <Menu size={24} />
            </button>

            <button
              onClick={toggleSidebarCollapse}
              className="hidden md:flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-colors"
              title={isSidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>

            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
              <span className="hidden md:inline">Grupo Telecel •</span>
              {currentViewLabel}
            </div>
          </div>

          <NotificationBell currentUser={user} />
        </header>

        <div className="flex-1 overflow-hidden relative flex flex-col">
          {currentView === 'home' ? (
            <Home currentUser={user} />
          ) : currentView === 'finance' ? (
            <FinanceModule />
          ) : currentView === 'controle_stone' ? (
            <ControleStone />
          ) : currentView === 'comparativos_pdf' ? (
            <ComparativosModule />
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
            <SalesDashboard />
          ) : currentView === 'comparativo' ? (
            <ComparativoAnual />
          ) : currentView === 'estoque_vendas' ? (
            <EstoqueVendas />
          ) : currentView === 'estoque_inteligente' ? (
            <EstoqueInteligente />
          ) : currentView === 'estoque_detalhado' ? (
            <EstoqueDetalhado />
          ) : currentView === 'stockout' ? (
            <Stockout />
          ) : currentView === 'auditoria_lojas' ? (
            <AuditoriaLojas />
          ) : currentView === 'price_table' ? (
            <PriceTablePage />
          ) : currentView === 'solicitacoes' ? (
            <SolicitacoesModule currentUser={user} />
          ) : currentView === 'compras_vendas' && isAdmin ? (
            <ComprasVendas />
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
            <TaskList onOpenTask={(task: any) => { setSelectedTask(task); setCurrentView('detail'); }} viewMode={currentView} currentUser={user} />
          )}
        </div>
      </main>

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
    </div>
  );
}

export default App;