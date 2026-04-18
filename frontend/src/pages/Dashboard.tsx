import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../contexts/AppContext';
import { formatCurrency } from '../lib/formatters';
import { Trash2 } from 'lucide-react';

export function Dashboard() {
  const { transactions, currentUser, deleteTransaction } = useAppContext();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const canEdit = currentUser?.Role === 'editor' || currentUser?.Role === 'finance_director';

  const recentTransactions = [...transactions]
    .filter(t => t.Type !== 'draft')
    .slice(0, 15);

  const handleDelete = async (id: string) => {
    if (confirm('Вы уверены, что хотите удалить эту операцию?')) {
      setDeletingId(id);
      try {
        await deleteTransaction(id);
      } catch {
        alert('Ошибка удаления');
      } finally {
        setDeletingId(null);
      }
    }
  };

  return (
    <div className="space-y-6 pb-4">
      <div>
        <h2 className="text-[28px] font-extrabold tracking-tight leading-tight text-gray-900">
          Добрый день,
          <br className="sm:hidden" />
          <span className="sm:ml-2 text-gray-500">{currentUser?.Full_Name?.split(' ')[0]}!</span>
        </h2>
        <div className="mt-4 flex gap-2">
          <span className="text-[10px] font-bold bg-green-100 text-green-800 px-2.5 py-1 rounded-md uppercase tracking-widest">
          {currentUser?.Role?.replace('_', ' ')}
          </span>
          <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md uppercase tracking-widest">
            {currentUser?.TG_ID && `TG: ${currentUser.TG_ID}`}
          </span>
        </div>
      </div>

      {canEdit && (
        <div className="pt-2">
          <button
            onClick={() => navigate('/add')}
            className="w-full bg-gray-900 text-white rounded-2xl p-4 font-bold uppercase tracking-widest text-[13px] hover:bg-gray-800 transition-colors"
          >
            + Новая операция
          </button>
        </div>
      )}

      <div className="pt-8">
        <div className="flex justify-between items-end mb-6">
          <h3 className="text-[18px] font-extrabold tracking-tight text-gray-900">Последние операции</h3>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-gray-100 border-dashed">
            <p className="text-[13px] font-bold text-gray-400 uppercase tracking-widest">Нет операций</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentTransactions.map((tx) => (
              <div key={tx.ID} className="bg-white p-4 rounded-2xl border border-gray-100 group relative">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${tx.Type === 'income' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className="text-[13px] font-bold text-gray-900 uppercase tracking-widest">{tx.Category}</span>
                  </div>
                  <span className={`text-[15px] font-extrabold ${tx.Type === 'income' ? 'text-green-600' : 'text-gray-900'}`}>
                    {tx.Type === 'income' ? '+' : '-'}{tx.Currency === 'USD'
                      ? formatCurrency(String(tx.Amount_USD), 'USD')
                      : formatCurrency(String(tx.Amount_UZS), 'UZS')}
                  </span>
                </div>
                <div className="flex justify-between items-end mt-3">
                  <p className="text-[14px] text-gray-500 font-medium leading-tight max-w-[70%]">{tx.Note || 'Нет описания'}</p>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">{tx.Date}</p>
                </div>
                {canEdit && (
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/90 backdrop-blur-sm p-1 rounded-lg">
                    <button
                      onClick={() => handleDelete(tx.ID)}
                      disabled={deletingId === tx.ID}
                      className="p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-md transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
