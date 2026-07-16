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

type CatBody = { Type: string; Category: string };

export const api = {
  getMe: () => apiFetch<import('../types').Account>('/api/auth/me'),
  getCategories: () => apiFetch<import('../types').Category[]>('/api/categories'),
  getTransactions: () => apiFetch<import('../types').Transaction[]>('/api/transactions'),
  addTransaction: (data: Partial<import('../types').Transaction>) =>
    apiFetch<{ id: string }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  // Reason is mandatory for edits (audited server-side); draft completion is exempt.
  editTransaction: (
    id: string,
    data: Partial<import('../types').Transaction>,
    opts: { reason?: string; editorName?: string; draftCompletion?: boolean } = {},
  ) =>
    apiFetch<{ ok: boolean; changed: string[] }>(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...data,
        Reason: opts.reason || '',
        Editor_Name: opts.editorName || '',
        DraftCompletion: opts.draftCompletion || false,
      }),
    }),
  deleteTransaction: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/transactions/${id}`, { method: 'DELETE' }),
  getTransactionHistory: (id: string) =>
    apiFetch<import('../types').EditLogEntry[]>(`/api/transactions/${id}/history`),

  addCategory: (body: CatBody) =>
    apiFetch<{ ok: boolean }>('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
  renameCategory: (body: CatBody & { NewName: string }) =>
    apiFetch<{ ok: boolean }>('/api/categories', { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (body: CatBody) =>
    apiFetch<{ ok: boolean }>('/api/categories', { method: 'DELETE', body: JSON.stringify(body) }),
  addSubcategory: (body: CatBody & { Subcategory: string }) =>
    apiFetch<{ ok: boolean }>('/api/subcategories', { method: 'POST', body: JSON.stringify(body) }),
  renameSubcategory: (body: CatBody & { Subcategory: string; NewName: string }) =>
    apiFetch<{ ok: boolean }>('/api/subcategories', { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSubcategory: (body: CatBody & { Subcategory: string }) =>
    apiFetch<{ ok: boolean }>('/api/subcategories', { method: 'DELETE', body: JSON.stringify(body) }),
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
