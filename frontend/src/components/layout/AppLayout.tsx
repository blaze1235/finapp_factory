import React from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAppContext } from '../../contexts/AppContext';
import { LoginScreen } from '../../pages/LoginScreen';
import { Dashboard } from '../../pages/Dashboard';
import { AddTransaction } from '../../pages/AddTransaction';
import { Drafts } from '../../pages/Drafts';
import { Reports } from '../../pages/Reports';
import { Balance } from '../../pages/Balance';
import { Analytics } from '../../pages/Analytics';
import { Home, FileBarChart, PlusCircle, CreditCard, LayoutDashboard, BarChart2 } from 'lucide-react';

function Navbar() {
  const { currentUser } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Add', path: '/add', icon: PlusCircle, roles: ['editor', 'finance_director'] },
    { name: 'Drafts', path: '/drafts', icon: Home, roles: ['editor', 'finance_director'] },
    { name: 'Analytics', path: '/analytics', icon: BarChart2, roles: ['director', 'finance_director'] },
    { name: 'Reports', path: '/reports', icon: FileBarChart, roles: ['director', 'finance_director'] },
    { name: 'Balance', path: '/balance', icon: CreditCard },
  ];

  const visibleItems = navItems.filter(
    item => !item.roles || item.roles.includes(currentUser?.Role || '')
  );

  return (
    <nav className="fixed bottom-0 w-full bg-white border-t border-gray-100 pb-4 pt-2 px-2 z-50">
      <div className="max-w-md mx-auto grid px-2 gap-1" style={{ gridTemplateColumns: `repeat(${visibleItems.length}, 1fr)` }}>
        {visibleItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <button key={item.path} onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-colors border ${isActive ? 'bg-[#EEEEEE] text-gray-900 border-gray-100' : 'text-gray-500 border-transparent'}`}>
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} className="mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{item.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function AppLayout() {
  const { currentUser, isLoading, needsLogin, logout, refreshData } = useAppContext();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (needsLogin || !currentUser) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-[#F5F6F7] pb-20">
      <header className="bg-white border-b border-gray-100 h-[72px] px-6 sm:px-10 flex justify-between items-center sticky top-0 z-40">
        <div className="text-[20px] font-extrabold tracking-[-0.5px] uppercase flex items-center">
          FinApp Factory
          <span className="text-gray-500 font-normal text-[14px] ml-2 normal-case hidden sm:inline tracking-normal">Web Portal</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={refreshData} className="text-[11px] hover:bg-[#EEEEEE] text-gray-500 uppercase tracking-wider py-1 px-3 rounded font-bold border border-gray-100">↻</button>
          <span className="text-[11px] font-bold bg-gray-900 text-white px-2 py-1 rounded uppercase tracking-wider hidden sm:inline-block">
            {currentUser.Role?.replace('_', ' ')}
          </span>
          <span className="text-[15px] font-bold">{currentUser.Full_Name?.split(' ')?.[0]}</span>
          <button onClick={logout} className="text-[11px] hover:bg-[#EEEEEE] text-gray-500 uppercase tracking-wider py-1 px-3 rounded font-bold border border-gray-100">Выйти</button>
        </div>
      </header>
      <main className="p-4 sm:p-10 max-w-4xl mx-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddTransaction />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/balance" element={<Balance />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Navbar />
    </div>
  );
}
