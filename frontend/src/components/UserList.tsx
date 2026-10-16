import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Mail,
  Pencil,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import EditUserModal from './EditUserModal';
import ProductMasterIssuesPanel from './ProductMasterIssuesPanel';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function operationKey(value: unknown) {
  const normalized = String(value || 'Outros')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (normalized === 'TIM') return 'TIM';
  if (normalized === 'SAMSUNG') return 'SAMSUNG';
  if (normalized === 'FINANCEIRO') return 'FINANCEIRO';
  if (normalized === 'AUTOMACAO') return 'AUTOMAÇÃO';
  if (normalized === 'GERAL' || normalized === 'GESTAO') return 'GERAL';
  return normalized || 'OUTROS';
}

function operationBadge(operation: string) {
  if (operation === 'SAMSUNG') return 'border-blue-100 bg-blue-50 text-blue-700';
  if (operation === 'TIM') return 'border-violet-100 bg-violet-50 text-violet-700';
  if (operation === 'FINANCEIRO') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (operation === 'AUTOMAÇÃO') return 'border-cyan-100 bg-cyan-50 text-cyan-700';
  if (operation === 'GERAL') return 'border-orange-100 bg-orange-50 text-orange-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function UserList() {
  const [users, setUsers] = useState<any[]>([]);
  const [userToEdit, setUserToEdit] = useState<any>(null);
  const [activeOperation, setActiveOperation] = useState('TODOS');
  const [loading, setLoading] = useState(true);

  const currentUser = JSON.parse(localStorage.getItem('telefluxo_user') || '{}');
  const isAdmin = Boolean(currentUser?.isAdmin);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/users`, { cache: 'no-store' });
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Erro ao carregar equipe:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const operations = useMemo(() => {
    const counts = new Map<string, number>();
    users.forEach((user) => {
      const key = operationKey(user.operation);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const preferred = ['SAMSUNG', 'TIM', 'GERAL', 'FINANCEIRO', 'AUTOMAÇÃO'];
    const remaining = Array.from(counts.keys())
      .filter((key) => !preferred.includes(key))
      .sort((a, b) => a.localeCompare(b));

    return [
      { key: 'TODOS', label: 'Todos', count: users.length },
      ...[...preferred, ...remaining]
        .filter((key) => counts.has(key))
        .map((key) => ({ key, label: key, count: counts.get(key) || 0 })),
    ];
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (activeOperation === 'TODOS') return users;
    return users.filter((user) => operationKey(user.operation) === activeOperation);
  }, [users, activeOperation]);

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja remover este membro da equipe?')) return;

    const response = await fetch(`${API_URL}/users/${id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(data?.error || 'Não foi possível remover o membro.');
      return;
    }

    setUsers((current) => current.filter((user) => user.id !== id));
  };

  return (
    <div className="space-y-5">
      {isAdmin && <ProductMasterIssuesPanel />}

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-orange-600">
                <Users size={16} />
                <span className="text-[10px] font-black uppercase tracking-[0.18em]">Gestão de acessos</span>
              </div>
              <h2 className="mt-1 text-xl font-black text-slate-900">Equipe por operação</h2>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Separe visualmente Samsung, TIM, áreas corporativas e demais operações.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {operations.map((operation) => {
                const active = activeOperation === operation.key;
                return (
                  <button
                    key={operation.key}
                    type="button"
                    onClick={() => setActiveOperation(operation.key)}
                    className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wide transition ${
                      active
                        ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'
                    }`}
                  >
                    {operation.label} <span className={active ? 'text-orange-300' : 'text-slate-400'}>{operation.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-5">
          {loading ? (
            <div className="py-12 text-center text-sm font-bold text-slate-400">Carregando equipe...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-sm font-bold text-slate-400">Nenhum usuário nesta operação.</div>
          ) : (
            <div className="space-y-3">
              {filteredUsers.map((user) => {
                const operation = operationKey(user.operation);
                return (
                  <article
                    key={user.id}
                    className="group flex flex-col gap-4 rounded-[22px] border border-slate-100 bg-white p-4 transition hover:border-slate-200 hover:shadow-sm md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-black ${user.isAdmin ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
                        {String(user.name || '?').charAt(0).toUpperCase()}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-black text-slate-800">{user.name}</h3>
                          {user.isAdmin && (
                            <span title="Administrador" className="rounded-md bg-orange-50 p-1 text-orange-500">
                              <Shield size={12} />
                            </span>
                          )}
                          <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${operationBadge(operation)}`}>
                            {operation}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <Briefcase size={10} /> {user.role || '-'}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                            <Mail size={10} /> {user.email}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 md:justify-end">
                      <div className="text-left md:text-right">
                        <span className="block text-[9px] font-black uppercase tracking-widest text-slate-300">Setor</span>
                        <span className="text-xs font-bold text-slate-500">{user.department || '-'}</span>
                      </div>

                      {isAdmin && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setUserToEdit(user)}
                            className="rounded-xl bg-slate-100 p-2.5 text-slate-600 hover:bg-slate-200"
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(user.id)}
                            className="rounded-xl bg-red-50 p-2.5 text-red-500 hover:bg-red-100"
                            title="Remover"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {userToEdit && (
        <EditUserModal
          isOpen={Boolean(userToEdit)}
          userToEdit={userToEdit}
          onClose={() => setUserToEdit(null)}
        />
      )}
    </div>
  );
}
