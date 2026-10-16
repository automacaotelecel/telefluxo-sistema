import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Shield, UserCog, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function EditUserModal({ isOpen, onClose, userToEdit }: any) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: '',
    department: '',
    operation: '',
    isAdmin: false,
    managerId: '',
    allowedStores: [] as string[],
  });
  const [managers, setManagers] = useState<any[]>([]);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !userToEdit) return;

    const allowedStores = Array.isArray(userToEdit.allowedStores)
      ? userToEdit.allowedStores
      : String(userToEdit.allowedStores || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    setFormData({
      name: userToEdit.name || '',
      email: userToEdit.email || '',
      password: '',
      role: userToEdit.role || '',
      department: userToEdit.department || '',
      operation: userToEdit.operation || 'Geral',
      isAdmin: Boolean(userToEdit.isAdmin),
      managerId: userToEdit.managerId || '',
      allowedStores,
    });
    setShowNewPassword(false);

    fetch(`${API_URL}/users`)
      .then((response) => response.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setManagers(
          list.filter(
            (user: any) =>
              user.id !== userToEdit.id &&
              (user.isAdmin || String(user.role || '').toLowerCase().includes('gerente'))
          )
        );
      })
      .catch((error) => console.error('Erro ao carregar gestores:', error));
  }, [isOpen, userToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      setSaving(true);
      const response = await fetch(`${API_URL}/users/${userToEdit.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data?.error || 'Erro ao atualizar usuário.');
        return;
      }

      alert('Dados atualizados com sucesso!');
      onClose();
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert('Erro de conexão com o servidor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between bg-slate-900 p-6 text-white">
          <div className="flex items-center gap-3">
            <UserCog className="text-orange-500" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Equipe</p>
              <h2 className="font-black uppercase tracking-tight">Editar membro</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="transition hover:rotate-90">
            <X />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto p-7">
          <div>
            <label className="ml-2 text-[10px] font-black uppercase text-slate-400">Nome</label>
            <input
              required
              value={formData.name}
              className="w-full rounded-2xl border bg-slate-50 p-4 text-sm font-bold outline-none focus:border-orange-500"
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
            />
          </div>

          <div>
            <label className="ml-2 text-[10px] font-black uppercase text-slate-400">E-mail</label>
            <input
              required
              type="email"
              value={formData.email}
              className="w-full rounded-2xl border bg-slate-50 p-4 text-sm font-bold outline-none focus:border-orange-500"
              onChange={(event) => setFormData({ ...formData, email: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="ml-2 text-[10px] font-black uppercase text-slate-400">Cargo</label>
              <input
                required
                value={formData.role}
                className="w-full rounded-2xl border bg-slate-50 p-4 text-sm font-bold outline-none focus:border-orange-500"
                onChange={(event) => setFormData({ ...formData, role: event.target.value })}
              />
            </div>
            <div>
              <label className="ml-2 text-[10px] font-black uppercase text-slate-400">Setor</label>
              <input
                required
                value={formData.department}
                className="w-full rounded-2xl border bg-slate-50 p-4 text-sm font-bold outline-none focus:border-orange-500"
                onChange={(event) => setFormData({ ...formData, department: event.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="ml-2 text-[10px] font-black uppercase text-slate-400">Operação</label>
            <select
              required
              value={formData.operation}
              className="w-full rounded-2xl border bg-slate-50 p-4 text-sm font-bold outline-none focus:border-orange-500"
              onChange={(event) => setFormData({ ...formData, operation: event.target.value })}
            >
              <option value="Geral">Geral / Gestão</option>
              <option value="Samsung">Samsung</option>
              <option value="Tim">TIM</option>
              <option value="Financeiro">Financeiro</option>
              <option value="Automação">Automação</option>
              <option value="Outros">Outros</option>
            </select>
          </div>

          <div>
            <label className="ml-2 text-[10px] font-black uppercase text-slate-400">Gestor direto</label>
            <select
              value={formData.managerId}
              className="w-full rounded-2xl border bg-slate-50 p-4 text-sm font-bold outline-none focus:border-orange-500"
              onChange={(event) => setFormData({ ...formData, managerId: event.target.value })}
            >
              <option value="">Sem gestor direto</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.name}</option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-white p-2 text-slate-500 shadow-sm">
                <KeyRound size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-slate-800">Senha atual protegida</p>
                <p className="mt-1 text-[10px] font-medium leading-relaxed text-slate-500">
                  A senha atual não pode ser exibida porque o backend armazena somente o hash criptográfico. Você pode definir uma nova senha abaixo e visualizá-la antes de salvar.
                </p>

                <div className="relative mt-3">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={formData.password}
                    placeholder="Nova senha — deixe vazio para manter a atual"
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 pr-11 text-sm font-bold outline-none focus:border-orange-500"
                    onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    title={showNewPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'}
                  >
                    {showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50 p-4">
            <input
              type="checkbox"
              className="h-5 w-5 accent-orange-600"
              checked={formData.isAdmin}
              onChange={(event) => setFormData({ ...formData, isAdmin: event.target.checked })}
            />
            <span className="flex items-center gap-2 text-[10px] font-black uppercase text-orange-800">
              <Shield size={14} /> Acesso de administrador
            </span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-[22px] bg-slate-900 py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-lg transition hover:bg-orange-600 disabled:opacity-60"
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </form>
      </div>
    </div>
  );
}
