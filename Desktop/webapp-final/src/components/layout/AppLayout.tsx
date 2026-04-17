import React from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router';
import { useAppContext } from '../../contexts/AppContext';
import { Home, FileBarChart, PlusCircle, CreditCard, LayoutDashboard } from 'lucide-react';

function Navbar() {
  const { currentUser, logout } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Add', path: '/add', icon: PlusCircle, roles: ['editor', 'finance_director'] },
    { name: 'Drafts', path: '/drafts', icon: Home, roles: ['editor', 'finance_director'] },
    { name: 'Reports', path: '/reports', icon: FileBarChart, roles: ['director', 'finance_director'] },
    { name: 'Balance', path: '/balance', icon: CreditCard },
  ];

  const visibleItems = navItems.filter(
    item => !item.roles || item.roles.includes(currentUser?.Role || '')
  );

  return (
    <nav className="fixed bottom-0 w-full bg-white border-t border-gray-100 pb-safe pb-4 pt-2 px-2 z-50">
      <div className="max-w-md mx-auto grid grid-cols-5 px-2 gap-1">
        {visibleItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl transition-colors border ${
                isActive ? 'bg-[#EEEEEE] text-gray-900 border-gray-100' : 'text-gray-500 border-transparent'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} className="mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{item.name}</span>
            </button>
          )
        })}
      </div>
    </nav>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { currentUser, logout, serverErrorType } = useAppContext();

  if (serverErrorType === 'configure_credentials') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 max-w-md w-full">
          <h2 className="text-2xl font-extrabold tracking-tight text-red-600 mb-4">Setup Required</h2>
          <p className="text-gray-900 font-medium mb-4">
            The application needs to be connected to Google Sheets.
          </p>
          <ul className="list-disc pl-5 text-[15px] font-medium text-gray-500 mb-6 space-y-2">
            <li>Open the Secrets panel in AI Studio.</li>
            <li>Add <code className="bg-[#EEEEEE] px-1 rounded font-mono text-gray-900">GOOGLE_SHEET_ID</code></li>
            <li>Add <code className="bg-[#EEEEEE] px-1 rounded font-mono text-gray-900">GOOGLE_SERVICE_ACCOUNT_EMAIL</code></li>
            <li>Add <code className="bg-[#EEEEEE] px-1 rounded font-mono text-gray-900">GOOGLE_PRIVATE_KEY</code></li>
          </ul>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">
            Awaiting configuration...
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-[#F5F6F7] pb-20">
      <header className="bg-white border-b border-gray-100 h-[72px] px-6 sm:px-10 flex justify-between items-center sticky top-0 z-40">
        <div className="text-[20px] font-extrabold tracking-[-0.5px] uppercase flex items-center">
          FinApp Factory
          <span className="text-gray-500 font-normal text-[14px] ml-2 normal-case hidden sm:inline tracking-normal">Web Portal</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold bg-gray-900 text-white px-2 py-1 rounded uppercase tracking-wider hidden sm:inline-block">
              {currentUser.Role.replace('_', ' ')}
            </span>
            <span className="text-[15px] font-bold">{currentUser.Full_Name.split(' ')[0]}</span>
          </div>
          <button 
            onClick={logout}
            className="text-[11px] bg-transparent hover:bg-[#EEEEEE] text-gray-500 uppercase tracking-wider py-1 px-3 rounded font-bold transition-colors ml-1 border border-gray-100"
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="p-4 sm:p-10 max-w-4xl mx-auto">
        {children}
      </main>
      <Navbar />
    </div>
  );
}
