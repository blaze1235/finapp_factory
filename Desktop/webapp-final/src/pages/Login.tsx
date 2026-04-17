import React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppContext } from '../contexts/AppContext';

export function Login() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const { login, isLoading, accounts, serverErrorType } = useAppContext();
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    
    if (login(username.trim())) {
      navigate('/');
    } else {
      setError('Пользователь не найден или деактивирован / Foydalanuvchi topilmadi');
    }
  };

  if (serverErrorType === 'configure_credentials') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Требуется настройка API</h2>
          <p className="text-gray-700 mb-4">Пожалуйста, добавьте ключи Google Sheets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center p-4">
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-100 max-w-sm w-full">
        <div className="text-center mb-8">
          <h1 className="text-[32px] font-extrabold tracking-tight text-gray-900 leading-none">
            FinApp<br/>Factory
          </h1>
          <p className="text-gray-500 font-medium mt-2">Авторизация</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="username" className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
              Telegram ID или Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              className="w-full bg-[#F5F6F7] border border-gray-100 rounded-xl px-4 py-4 font-bold outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors"
              placeholder="@username или 123456"
              required
            />
          </div>
          
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold mb-6 border border-red-100">
              {error}
            </div>
          )}
          
          <button
            type="submit"
            className="w-full bg-gray-900 text-white rounded-xl py-4 font-bold uppercase tracking-widest text-[13px] hover:bg-gray-800 transition-colors mt-2 disabled:opacity-50"
          >
            {isLoading ? 'Загрузка...' : 'Войти'}
          </button>
        </form>

        {accounts.length === 0 && !isLoading && !serverErrorType && (
          <p className="mt-4 text-xs text-orange-500 text-center font-medium">
            Нет доступных аккаунтов. Проверьте вкладку Accounts в Google Sheets.
          </p>
        )}
      </div>
    </div>
  );
}
