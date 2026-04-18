declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name: string; username?: string } };
        ready: () => void;
        expand: () => void;
      };
    };
  }
}

function getAuthHeaders(): Record<string, string> {
  const twa = window.Telegram?.WebApp;
  if (twa?.initData) {
    return { 'X-Telegram-Init-Data': twa.initData };
  }
  const stored = localStorage.getItem('finapp_tg_id') || '';
  if (stored) {
    return { 'X-TG-ID': stored };
  }
  return {};
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  getMe: () => apiFetch<import('../types').Account>('/api/auth/me'),
  getCategories: () => apiFetch<import('../types').Category[]>('/api/categories'),
  getTransactions: () => apiFetch<import('../types').Transaction[]>('/api/transactions'),
  addTransaction: (data: Partial<import('../types').Transaction>) =>
    apiFetch<{ id: string }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  editTransaction: (id: string, data: Partial<import('../types').Transaction>) =>
    apiFetch<{ ok: boolean }>(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTransaction: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/transactions/${id}`, { method: 'DELETE' }),
};

export function getTelegramUser() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user ?? null;
}

export function initTelegramWebApp() {
  const twa = window.Telegram?.WebApp;
  if (twa) {
    twa.ready();
    twa.expand();
  }
}
