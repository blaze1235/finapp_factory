import React, { useState } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { api } from '../lib/api';
import { Pencil, Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';

type Kind = 'income' | 'expense';

export function CategoriesManager() {
  const { categories, currentUser, refreshCategories } = useAppContext();
  const canEdit = currentUser?.Role === 'editor' || currentUser?.Role === 'finance_director';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCatName, setNewCatName] = useState<Record<Kind, string>>({ income: '', expense: '' });
  const [newSubName, setNewSubName] = useState('');
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null); // `${type}|${cat}`
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!canEdit) {
    return <div className="p-4 text-center text-[13px] font-bold text-gray-400 uppercase tracking-widest">Нет доступа</div>;
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refreshCategories();
    } catch (e: any) {
      setError(e.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const addCategory = (type: Kind) => {
    const name = newCatName[type].trim();
    if (!name) return;
    run(async () => {
      await api.addCategory({ Type: type, Category: name });
      setNewCatName(v => ({ ...v, [type]: '' }));
    });
  };

  const renameCategory = (type: Kind, cat: string) => {
    const name = prompt(`Новое название категории «${cat}»:`, cat);
    if (!name || name.trim() === cat) return;
    run(() => api.renameCategory({ Type: type, Category: cat, NewName: name.trim() }));
  };

  const removeCategory = (type: Kind, cat: string) => {
    if (!confirm(`Удалить категорию «${cat}» и все её подкатегории?\n\nСтарые операции сохранят свой текст.`)) return;
    run(() => api.deleteCategory({ Type: type, Category: cat }));
  };

  const addSub = (type: Kind, cat: string) => {
    const name = newSubName.trim();
    if (!name) return;
    run(async () => {
      await api.addSubcategory({ Type: type, Category: cat, Subcategory: name });
      setNewSubName('');
      setAddingSubFor(null);
      setExpanded(v => ({ ...v, [`${type}|${cat}`]: true }));
    });
  };

  const renameSub = (type: Kind, cat: string, sub: string) => {
    const name = prompt(`Новое название подкатегории «${sub}»:`, sub);
    if (!name || name.trim() === sub) return;
    run(() => api.renameSubcategory({ Type: type, Category: cat, Subcategory: sub, NewName: name.trim() }));
  };

  const removeSub = (type: Kind, cat: string, sub: string) => {
    if (!confirm(`Удалить подкатегорию «${sub}»?`)) return;
    run(() => api.deleteSubcategory({ Type: type, Category: cat, Subcategory: sub }));
  };

  const section = (type: Kind) => {
    const list = categories.filter(c => c.Type === type);
    const isIncome = type === 'income';
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className={`text-[12px] font-extrabold uppercase tracking-widest mb-4 ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
          {isIncome ? 'Категории доходов' : 'Категории расходов'} ({list.length})
        </h3>

        <div className="space-y-2">
          {list.map(c => {
            const key = `${type}|${c.Category}`;
            const isOpen = expanded[key] ?? c.Subcategories.length > 0;
            return (
              <div key={c.Category} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center gap-1 p-3 bg-gray-50/50">
                  <button onClick={() => setExpanded(v => ({ ...v, [key]: !isOpen }))}
                    className="p-1 text-gray-400">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <span className="flex-1 text-[13px] font-bold text-gray-900 truncate">{c.Category}</span>
                  {c.Subcategories.length > 0 && (
                    <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      {c.Subcategories.length}
                    </span>
                  )}
                  <button onClick={() => renameCategory(type, c.Category)} disabled={busy}
                    className="p-1.5 text-gray-400 hover:text-gray-900 rounded-lg"><Pencil size={14} /></button>
                  <button onClick={() => removeCategory(type, c.Category)} disabled={busy}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"><Trash2 size={14} /></button>
                </div>

                {isOpen && (
                  <div className="p-3 space-y-1.5">
                    {c.Subcategories.length === 0 && addingSubFor !== key && (
                      <p className="text-[11px] text-gray-400">Нет подкатегорий</p>
                    )}
                    {c.Subcategories.map(s => (
                      <div key={s} className="flex items-center gap-1 pl-2">
                        <span className="text-gray-300 text-[11px]">└</span>
                        <span className="flex-1 text-[12px] font-medium text-gray-700 truncate">{s}</span>
                        <button onClick={() => renameSub(type, c.Category, s)} disabled={busy}
                          className="p-1 text-gray-300 hover:text-gray-900 rounded"><Pencil size={13} /></button>
                        <button onClick={() => removeSub(type, c.Category, s)} disabled={busy}
                          className="p-1 text-gray-300 hover:text-red-600 rounded"><Trash2 size={13} /></button>
                      </div>
                    ))}

                    {addingSubFor === key ? (
                      <div className="flex gap-2 pt-1">
                        <input autoFocus value={newSubName} onChange={e => setNewSubName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addSub(type, c.Category)}
                          placeholder="Название (напр. Исмат)"
                          className="flex-1 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-[12px] font-bold outline-none focus:ring-1 focus:ring-gray-900" />
                        <button onClick={() => addSub(type, c.Category)} disabled={busy || !newSubName.trim()}
                          className="px-3 py-2 rounded-lg bg-gray-900 text-white text-[11px] font-bold disabled:opacity-50">OK</button>
                        <button onClick={() => { setAddingSubFor(null); setNewSubName(''); }}
                          className="px-2 py-2 rounded-lg text-gray-400 text-[11px] font-bold">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setAddingSubFor(key); setNewSubName(''); }}
                        className="flex items-center gap-1 text-[11px] font-bold text-gray-500 hover:text-gray-900 pt-1">
                        <Plus size={13} /> Подкатегория
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
          <input value={newCatName[type]} onChange={e => setNewCatName(v => ({ ...v, [type]: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && addCategory(type)}
            placeholder="Новая категория..."
            className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-[12px] font-bold outline-none focus:ring-1 focus:ring-gray-900" />
          <button onClick={() => addCategory(type)} disabled={busy || !newCatName[type].trim()}
            className={`px-4 py-2.5 rounded-xl text-white text-[11px] font-bold uppercase tracking-wide disabled:opacity-50 ${isIncome ? 'bg-green-600' : 'bg-red-600'}`}>
            <Plus size={15} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h2 className="text-[24px] font-extrabold tracking-tight text-gray-900">Категории</h2>
        <p className="text-[12px] text-gray-500 mt-1">
          Подкатегории уточняют направление операции — например, Логистика → Исмат, Косим, Тошполат.
        </p>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-[12px] font-bold text-red-600">
          {error}
        </div>
      )}
      {section('expense')}
      {section('income')}
    </div>
  );
}
