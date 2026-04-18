import { useState } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatCurrency } from '../lib/formatters';

export function Drafts() {
  const { transactions, deleteTransaction, editTransaction, categories } = useAppContext();
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [category, setCategory] = useState('');

  const drafts = transactions.filter(t => t.Type === 'draft');
  const filteredCategories = categories.filter(c => c.Type === type);

  const handleComplete = async (draftId: string) => {
    if (!category) return;
    try {
      await editTransaction(draftId, { Type: type, Category: category });
      setEditingDraftId(null);
    } catch { alert('Ошибка'); }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Удалить черновик?')) {
      try { await deleteTransaction(id); } catch { alert('Ошибка удаления'); }
    }
  };

  return (
    <div className="space-y-6 pb-4">
      <h2 className="text-[28px] font-extrabold tracking-tight leading-tight text-gray-900">
        Черновики <span className="text-[13px] font-normal text-gray-500 ml-1">/ Qoralama</span>
      </h2>
      {drafts.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 border-dashed">
          <p className="text-[13px] font-bold text-gray-400 uppercase tracking-widest">Нет черновиков</p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <div key={draft.ID} className="bg-white p-5 rounded-2xl border border-gray-100 flex flex-col">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="text-[10px] bg-yellow-500 text-white px-2 py-1 rounded inline-block font-bold tracking-wider mb-2">DRAFT</span>
                  <p className="font-bold text-gray-900 text-sm leading-tight">
                    {draft.Currency === 'USD' ? formatCurrency(String(draft.Amount_USD), 'USD') : formatCurrency(String(draft.Amount_UZS), 'UZS')}
                    <span className="text-gray-500 font-normal ml-2">{draft.Note}</span>
                  </p>
                  <p className="text-[10px] uppercase font-bold text-gray-400 mt-2">{draft.Date}</p>
                </div>
                <button onClick={() => handleDelete(draft.ID)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-colors text-sm font-bold">Удалить</button>
              </div>
              {editingDraftId === draft.ID ? (
                <div className="space-y-4 pt-4 border-t border-gray-100 mt-2">
                  <div className="flex gap-2">
                    <button onClick={() => setType('expense')} className={`flex-1 py-3 text-[14px] font-bold rounded-xl border ${type === 'expense' ? 'bg-red-600 text-white border-red-600' : 'bg-gray-50 text-gray-900 border-gray-100'}`}>Расход</button>
                    <button onClick={() => setType('income')} className={`flex-1 py-3 text-[14px] font-bold rounded-xl border ${type === 'income' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-50 text-gray-900 border-gray-100'}`}>Приход</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                    {filteredCategories.map(c => (
                      <button key={c.Category} onClick={() => setCategory(c.Category)}
                        className={`py-2 px-3 text-xs font-bold rounded-xl truncate border ${category === c.Category ? type === 'income' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200' : 'bg-white text-gray-700 border-gray-100'}`}>
                        {c.Category}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setEditingDraftId(null)} className="flex-1 py-3 text-sm font-bold rounded-xl bg-gray-100 text-gray-900 uppercase tracking-wide">Отмена</button>
                    <button onClick={() => handleComplete(draft.ID)} disabled={!category} className="flex-1 py-3 text-sm font-bold rounded-xl bg-gray-900 text-white disabled:opacity-50 uppercase tracking-wide">Сохранить</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setEditingDraftId(draft.ID); setType('expense'); setCategory(''); }}
                  className="mt-2 w-full py-3 rounded-xl border border-gray-100 text-[12px] uppercase tracking-wider font-bold bg-white text-gray-900">
                  Завершить
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
