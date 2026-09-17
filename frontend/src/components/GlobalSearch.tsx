import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Boxes,
  Building2,
  FileText,
  Loader2,
  Search,
  ShoppingBag,
  UserRound,
  X,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type SearchResult = {
  id: string;
  kind: 'store' | 'seller' | 'product';
  label: string;
  subtitle?: string;
  store?: string;
};

type Props = {
  currentUser: any;
  onNavigate: (view: string) => void;
  onOpenStore: (store: string) => void;
};

const modules = [
  { id: 'home', label: 'Início', keywords: 'home painel indicadores', icon: BarChart3, permission: 'all' },
  { id: 'sales_dash', label: 'Vendas Mensal', keywords: 'vendas faturamento conversao vendedores', icon: ShoppingBag, permission: 'sales' },
  { id: 'stock', label: 'Controle de Estoque', keywords: 'estoque produtos imei', icon: Boxes, permission: 'stock' },
  { id: 'estoque_detalhado', label: 'Previsão Estoque', keywords: 'estoque previsao cobertura vendas', icon: Boxes, permission: 'stock' },
  { id: 'alertas_inteligentes', label: 'Alertas', keywords: 'alertas inteligência riscos ruptura queda', icon: BarChart3, permission: 'stock' },
  { id: 'comparativo', label: 'Vendas Anuais', keywords: 'comparativo anual vendas', icon: BarChart3, permission: 'sales' },
  { id: 'agenda', label: 'Agenda Pessoal', keywords: 'agenda calendario', icon: FileText, permission: 'all' },
  { id: 'rh', label: 'RH', keywords: 'recursos humanos colaborador', icon: UserRound, permission: 'all' },
  { id: 'online_prices', label: 'Clark • Preços Online', keywords: 'clark preços online pesquisa', icon: Search, permission: 'director' },
  { id: 'contract_analyzer', label: 'Clark • Contratos', keywords: 'clark contratos jurídico', icon: FileText, permission: 'director' },
  { id: 'finance', label: 'Controle Financeiro', keywords: 'financeiro contas pagar receber', icon: FileText, permission: 'finance' },
  { id: 'team', label: 'Equipe', keywords: 'usuários acessos equipe', icon: UserRound, permission: 'team' },
];

function normalize(value: any) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export default function GlobalSearch({ currentUser, onNavigate, onOpenStore }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const role = String(currentUser?.role || '').trim().toUpperCase();
  const isStore = role === 'LOJA';
  const isDirector = ['CEO', 'DIRETOR', 'DIRETORIA'].includes(role);
  const isAdmin = currentUser?.isAdmin === true || Number(currentUser?.isAdmin) === 1;
  const canViewSales = ['CEO', 'DIRETOR', 'LOJA'].includes(role) || (isAdmin && !isStore);
  const canViewStock = ['CEO', 'DIRETOR', 'LOJA'].includes(role) || (isAdmin && !isStore);
  const canViewFinance = ['CEO', 'DIRETOR', 'ADM'].includes(role) || (isAdmin && !isStore);
  const canViewTeam = ['CEO', 'DIRETOR', 'ADM'].includes(role) || (isAdmin && !isStore);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
    else {
      setQuery('');
      setRemote([]);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2 || !currentUser?.id) {
      setRemote([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/api/global-search?userId=${encodeURIComponent(currentUser.id)}&q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Busca indisponível');
        setRemote(Array.isArray(data?.results) ? data.results : []);
      } catch (error: any) {
        if (error?.name !== 'AbortError') setRemote([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, currentUser?.id]);

  const localModules = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    return modules.filter((item) => {
      if (item.permission === 'director' && !isDirector) return false;
      if (item.permission === 'sales' && !canViewSales) return false;
      if (item.permission === 'stock' && !canViewStock) return false;
      if (item.permission === 'finance' && !canViewFinance) return false;
      if (item.permission === 'team' && !canViewTeam) return false;
      return normalize(`${item.label} ${item.keywords}`).includes(q);
    }).slice(0, 6);
  }, [query, isDirector, canViewSales, canViewStock, canViewFinance, canViewTeam]);

  const chooseModule = (view: string) => {
    setOpen(false);
    onNavigate(view);
  };

  const chooseRemote = (item: SearchResult) => {
    setOpen(false);
    if (item.kind === 'store' && item.store) {
      onOpenStore(item.store);
      return;
    }
    if (item.kind === 'seller' && item.store) {
      onOpenStore(item.store);
      return;
    }
    onNavigate('stock');
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 sm:flex"
        title="Busca global (Ctrl + K)"
      >
        <Search size={15} />
        <span className="hidden lg:inline">Buscar no TeleFluxo</span>
        <kbd className="hidden rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-slate-400 lg:inline">Ctrl K</kbd>
      </button>

      <button
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-900 sm:hidden"
        title="Busca global"
      >
        <Search size={19} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[11000] flex items-start justify-center bg-slate-950/35 px-4 pt-[10vh] backdrop-blur-[3px]" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-[680px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
              <Search size={19} className="text-orange-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busque loja, vendedor, produto ou módulo..."
                className="h-11 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
              {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
              <button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"><X size={17} /></button>
            </div>

            <div className="max-h-[62vh] overflow-y-auto p-2">
              {!query.trim() ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-black text-slate-800">Busca global do TeleFluxo</p>
                  <p className="mt-1 text-xs font-medium text-slate-400">Digite para localizar módulos, lojas, vendedores e produtos dentro do seu escopo de acesso.</p>
                </div>
              ) : (
                <>
                  {localModules.length > 0 && (
                    <div className="mb-2">
                      <p className="px-3 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Módulos</p>
                      {localModules.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button key={item.id} onClick={() => chooseModule(item.id)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-slate-50">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon size={16} /></span>
                            <div className="flex-1"><p className="text-xs font-black text-slate-800">{item.label}</p><p className="mt-0.5 text-[9px] font-semibold text-slate-400">Abrir módulo</p></div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {remote.length > 0 && (
                    <div>
                      <p className="px-3 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Dados</p>
                      {remote.map((item) => {
                        const Icon = item.kind === 'store' ? Building2 : item.kind === 'seller' ? UserRound : Boxes;
                        return (
                          <button key={item.id} onClick={() => chooseRemote(item)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-orange-50">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Icon size={16} /></span>
                            <div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-slate-800">{item.label}</p><p className="mt-0.5 truncate text-[9px] font-semibold text-slate-400">{item.subtitle}</p></div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!loading && localModules.length === 0 && remote.length === 0 && query.trim().length >= 2 && (
                    <div className="px-4 py-10 text-center text-xs font-bold text-slate-400">Nenhum resultado encontrado no seu escopo.</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
