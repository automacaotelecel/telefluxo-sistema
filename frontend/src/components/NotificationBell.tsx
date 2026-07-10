import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Check, BellOff } from 'lucide-react';

type NotificationItem = {
  id: string | number;
  text?: string;
  content?: string;
  read?: boolean;
  createdAt?: string;
};

const getHiddenStorageKey = (userId: string) => `telefluxo_hidden_notifications_${userId}`;

function loadHiddenNotifications(userId: string): Set<string> {
  if (!userId) return new Set();

  try {
    const raw = localStorage.getItem(getHiddenStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch (error) {
    console.error('Erro ao ler notificações ocultadas localmente:', error);
    return new Set();
  }
}

function saveHiddenNotifications(userId: string, hiddenIds: Set<string>) {
  if (!userId) return;

  try {
    localStorage.setItem(getHiddenStorageKey(userId), JSON.stringify(Array.from(hiddenIds)));
  } catch (error) {
    console.error('Erro ao salvar notificações ocultadas localmente:', error);
  }
}

function normalizeNotifications(data: any, hiddenIds: Set<string>): NotificationItem[] {
  if (!Array.isArray(data)) return [];

  const unique = new Map<string, NotificationItem>();

  data.forEach((item) => {
    if (!item || item.id === undefined || item.id === null) return;

    const id = String(item.id);
    if (hiddenIds.has(id)) return;
    if (item.read === true) return;

    unique.set(id, item);
  });

  return Array.from(unique.values()).sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
}

export default function NotificationBell({ currentUser }: any) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const userId = currentUser?.id ? String(currentUser.id) : '';

  const fetchNotes = useCallback(async (signal?: AbortSignal) => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/notifications?userId=${encodeURIComponent(userId)}`, {
        signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Erro HTTP ${response.status}`);
      }

      const data = await response.json();
      const hiddenIds = loadHiddenNotifications(userId);
      setNotifications(normalizeNotifications(data, hiddenIds));
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Erro ao buscar notificações:', error);
        setNotifications([]);
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [API_URL, userId]);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    const controller = new AbortController();
    fetchNotes(controller.signal);

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchNotes();
      }
    }, 60000);

    const refreshOnFocus = () => fetchNotes();
    window.addEventListener('focus', refreshOnFocus);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [fetchNotes, userId]);

  const markAsRead = async (id: string | number) => {
    if (!userId) return;

    const noteId = String(id);
    const hiddenIds = loadHiddenNotifications(userId);
    hiddenIds.add(noteId);
    saveHiddenNotifications(userId, hiddenIds);

    setNotifications((prev) => prev.filter((notification) => String(notification.id) !== noteId));

    try {
      const response = await fetch(`${API_URL}/notifications/${encodeURIComponent(noteId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true, userId }),
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Erro HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Erro ao marcar notificação como lida:', error);
    }
  };

  const markAllAsRead = async () => {
    const ids = notifications.map((notification) => notification.id);
    setIsOpen(false);
    await Promise.allSettled(ids.map((id) => markAsRead(id)));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 text-slate-400 hover:text-orange-600 transition-all"
        title="Notificações"
      >
        <Bell size={22} />
        {notifications.length > 0 && (
          <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-black w-4 h-4 flex items-center justify-center rounded-full border-2 border-white">
            {notifications.length > 9 ? '9+' : notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center text-xs font-black uppercase tracking-widest font-sans">
              <span>Notificações</span>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded-full transition-colors"
                  >
                    Limpar
                  </button>
                )}
                <span className="bg-orange-600 px-2 py-0.5 rounded-full">{notifications.length}</span>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isLoading && notifications.length === 0 ? (
                <div className="p-10 text-center text-slate-400 italic text-sm flex flex-col items-center gap-2">
                  Carregando...
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-10 text-center text-slate-400 italic text-sm flex flex-col items-center gap-2">
                  <BellOff size={24} className="opacity-20" /> Sem novidades
                </div>
              ) : (
                notifications.map((notification) => (
                  <div key={notification.id} className="p-4 border-b border-slate-50 hover:bg-orange-50/30 flex gap-3 items-start group">
                    <div className="flex-1 font-sans text-sm font-semibold text-slate-700 leading-snug">
                      {notification.text || notification.content || 'Atualização no sistema'}
                    </div>
                    <button
                      onClick={() => markAsRead(notification.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 bg-green-50 text-green-600 rounded-lg"
                      title="Marcar como lida"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
