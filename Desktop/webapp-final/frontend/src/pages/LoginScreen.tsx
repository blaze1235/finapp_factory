import React, { useState } from 'react';
import { useAppContext } from '../contexts/AppContext';

export function LoginScreen() {
  const { login, error, isLoading } = useAppContext();
  const [tgId, setTgId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tgId.trim()) return;
    setSubmitting(true);
    setLocalError('');
    const ok = await login(tgId.trim());
    if (!ok) setLocalError('Нет доступа. Проверьте ваш Telegram ID.');
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-[24px] font-extrabold tracking-tight text-gray-900 uppercase">FinApp Factory</h1>
          <p className="text-gray-500 text-sm mt-2">Введите ваш Telegram ID для входа</p>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-gray-100">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                Telegram ID
              </label>
              <input
                type="number"
                value={tgId}
                onChange={e => setTgId(e.target.value)}
                className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 font-bold text-lg outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900"
                placeholder="123456789"
                required
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Узнать ID: напишите @userinfobot в Telegram
              </p>
            </div>
            {(localError || error) && (
              <p className="text-red-600 text-sm font-bold">{localError || error}</p>
            )}
            <button
              type="submit"
              disabled={submitting || isLoading || !tgId}
              className="w-full py-4 rounded-xl font-bold bg-gray-900 text-white disabled:opacity-50 uppercase tracking-wide text-[12px]"
            >
              {submitting ? 'Проверка...' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
