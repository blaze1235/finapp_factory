import React, { createContext, useContext, useState, useEffect } from 'react';
import { Account, Transaction, Category } from '../types';

interface AppState {
  currentUser: Account | null;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  serverErrorType: 'configure_credentials' | 'network' | 'unknown' | null;
}

interface AppContextType extends AppState {
  login: (usernameOrTGID: string) => boolean;
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
    accounts: [],
    categories: [],
    transactions: [],
    isLoading: true,
    error: null,
    serverErrorType: null,
  });

  const loadInitData = async () => {
    try {
      const res = await fetch('/api/init');
      if (res.status === 503) {
        setState(s => ({ ...s, serverErrorType: 'configure_credentials', isLoading: false }));
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch initial data');
      const data = await res.json();
      
      const defaultUser = data.accounts[0] || null;
      setState(s => ({ 
        ...s, 
        accounts: data.accounts, 
        categories: data.categories, 
        currentUser: defaultUser, // Automatically log in default user to bypass login
        isLoading: false, 
        serverErrorType: null 
      }));
      
      // Initial load transactions if bypassing login
      loadTransactions();
    } catch (error: any) {
      console.error(error);
      setState(s => ({ ...s, error: error.message, isLoading: false, serverErrorType: 'network' }));
    }
  };

  const loadTransactions = async () => {
    try {
      const res = await fetch('/api/transactions');
      if (!res.ok) throw new Error('Failed to fetch transactions');
      const data = await res.json();
      setState(s => ({ ...s, transactions: data }));
    } catch (error: any) {
      console.error(error);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('finapp_user');
    if (savedUser) {
      try { setState(s => ({ ...s, currentUser: JSON.parse(savedUser) })); }
      catch { localStorage.removeItem('finapp_user'); }
    }
    loadInitData().then(() => { if (savedUser) loadTransactions(); });
  }, []);

  const login = (usernameOrTGID: string) => {
    const user = state.accounts.find(
      a => a.Username === usernameOrTGID || a.TG_ID === usernameOrTGID
    );
    if (user && (user.Active === 'TRUE' || (user.Active as any) === true)) {
      setState(s => ({ ...s, currentUser: user }));
      localStorage.setItem('finapp_user', JSON.stringify(user));
      loadTransactions();
      return true;
    }
    return false;
  };

  const logout = () => {
    setState(s => ({ ...s, currentUser: null }));
    localStorage.removeItem('finapp_user');
  };

  const refreshData = async () => {
    setState(s => ({ ...s, isLoading: true }));
    await loadTransactions();
    setState(s => ({ ...s, isLoading: false }));
  };

  const addTransaction = async (tx: Partial<Transaction>) => {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx)
    });
    if (!res.ok) throw new Error('Failed to save transaction');
    const newTx = await res.json();
    setState(s => ({ ...s, transactions: [...s.transactions, newTx] }));
  };

  const editTransaction = async (id: string, tx: Partial<Transaction>) => {
    const res = await fetch(`/api/transactions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx)
    });
    if (!res.ok) throw new Error('Failed to edit transaction');
    const updatedTx = await res.json();
    setState(s => ({
      ...s,
      transactions: s.transactions.map(t => t.ID === id ? { ...t, ...updatedTx } : t)
    }));
  };

  const deleteTransaction = async (id: string) => {
    const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete transaction');
    setState(s => ({
      ...s,
      transactions: s.transactions.filter(t => t.ID !== id)
    }));
  };

  return (
    <AppContext.Provider value={{
      ...state,
      login, logout, refreshData, addTransaction, editTransaction, deleteTransaction
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
