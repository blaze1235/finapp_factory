import React, { createContext, useContext, useState, useEffect } from 'react';
import { Account, Transaction, Category } from '../types';
import { api, getTelegramUser, initTelegramWebApp } from '../lib/api';

interface AppState {
  currentUser: Account | null;
  categories: Category[];
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  needsLogin: boolean;
}

interface AppContextType extends AppState {
  login: (tgId: string) => Promise<boolean>;
  logout: () => void;
  refreshData: () => Promise<void>;
  addTransaction: (tx: Partial<Transaction>) => Promise<void>;
  editTransaction: (id: string, tx: Partial<Transaction>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    currentUser: null,
    categories: [],
    transactions: [],
    isLoading: true,
    error: null,
    needsLogin: false,
  });

  const loadUser = async () => {
    try {
      return await api.getMe();
    } catch {
      return null;
    }
  };

  const loadData = async (user: Account) => {
    const [categories, transactions] = await Promise.all([
      api.getCategories(),
      api.getTransactions(),
    ]);
    setState(s => ({
      ...s,
      currentUser: user,
      categories,
      transactions,
      isLoading: false,
      error: null,
      needsLogin: false,
    }));
  };

  useEffect(() => {
    initTelegramWebApp();
    const init = async () => {
      const tgUser = getTelegramUser();
      if (tgUser?.id) {
        localStorage.setItem('finapp_tg_id', String(tgUser.id));
      }
      const storedId = localStorage.getItem('finapp_tg_id');
      if (!storedId && !tgUser?.id) {
        setState(s => ({ ...s, isLoading: false, needsLogin: true }));
        return;
      }
      const user = await loadUser();
      if (!user) {
        setState(s => ({ ...s, isLoading: false, needsLogin: true }));
        return;
      }
      await loadData(user);
    };
    init();
  }, []);

  const login = async (tgId: string): Promise<boolean> => {
    setState(s => ({ ...s, isLoading: true, error: null }));
    localStorage.setItem('finapp_tg_id', tgId.trim());
    const user = await loadUser();
    if (!user) {
      localStorage.removeItem('finapp_tg_id');
      setState(s => ({ ...s, isLoading: false, error: 'Пользователь не найден или нет доступа' }));
      return false;
    }
    await loadData(user);
    return true;
  };

  const logout = () => {
    localStorage.removeItem('finapp_tg_id');
    setState(s => ({ ...s, currentUser: null, needsLogin: true, transactions: [], categories: [] }));
  };

  const refreshData = async () => {
    if (!state.currentUser) return;
    setState(s => ({ ...s, isLoading: true }));
    await loadData(state.currentUser);
  };

  const addTransaction = async (tx: Partial<Transaction>) => {
    await api.addTransaction(tx);
    const transactions = await api.getTransactions();
    setState(s => ({ ...s, transactions }));
  };

  const editTransaction = async (id: string, tx: Partial<Transaction>) => {
    await api.editTransaction(id, tx);
    const transactions = await api.getTransactions();
    setState(s => ({ ...s, transactions }));
  };

  const deleteTransaction = async (id: string) => {
    await api.deleteTransaction(id);
    setState(s => ({ ...s, transactions: s.transactions.filter(t => t.ID !== id) }));
  };

  return (
    <AppContext.Provider value={{
      ...state,
      login, logout, refreshData, addTransaction, editTransaction, deleteTransaction,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
};
