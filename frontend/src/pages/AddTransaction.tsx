import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useAppContext } from '../contexts/AppContext';

export function AddTransaction() {
  const { categories, addTransaction, currentUser } = useAppContext();
  const navigate = useNavigate();
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rate, setRate] = useState('');

  const filteredCategories = categories.filter(c => c.Type === type);
  const isUSD = amount.startsWith('$');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category || !note) return;
    setIsSubmitting(true);
    let amountUzs = 0;
    let amountUsd = 0;
    const rawAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));
    if (isUSD) {
      amountUsd = rawAmount;
      if (rate) amountUzs = rawAmount * parseFloat(rate);
    } else {
      amountUzs = rawAmount;
    }
    try {
      await addTransaction({
        Timestamp: format(new Date(), 'dd.MM.yyyy HH:mm:ss'),
        Date: format(new Date(date), 'dd.MM.yyyy'),
        Type: type,
        Category: category,
        Amount_UZS: amountUzs,
        Amount_USD: amountUsd,
        USD_Rate: rate ? parseFloat(rate) : 0,
        Note: note,
        Editor_ID: currentUser!.TG_ID,
        Editor_Name: currentUser!.Full_Name,
        Currency: isUSD ? 'USD' : 'UZS',
      });
      navigate('/');
    } catch (e) {
      alert('Ошибка сохранения');
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDraft = async () => {
    if (!amount || !note) { alert('Для черновика нужны сумма и описание'); return; }
    setIsSubmitting(true);
    const rawAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));
    const amountUsd = isUSD ? rawAmount : 0;
    const amountUzs = isUSD ? 0 : rawAmount;
    try {
      await addTransaction({
        Timestamp: format(new Date(), 'dd.MM.yyyy HH:mm:ss'),
        Date: format(new Date(), 'dd.MM.yyyy'),
        Type: 'draft',
        Category: 'ЧЕРНОВИК',
        Amount_UZS: amountUzs,
        Amount_USD: amountUsd,
        USD_Rate: 0,
        Note: note,
        Editor_ID: currentUser!.TG_ID,
        Editor_Name: currentUser!.Full_Name,
        Currency: isUSD ? 'USD' : 'UZS',
      });
      navigate('/drafts');
    } catch { alert('Ошибка'); }
    finally { setIsSubmitting(false); }
  };

  if (currentUser?.Role === 'director' || currentUser?.Role === 'viewer') {
    return <div className="p-4 text-center">Нет доступа</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold tracking-tight text-gray-900 mb-6">
        Новая операция <span className="text-[13px] font-normal text-gray-500 ml-1">/ Yangi ...</span>
      </h2>
      <div className="bg-white rounded-2xl p-6 border border-gray-100">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex gap-2">
            <button type="button" onClick={() => { setType('expense'); setCategory(''); }}
              className={`flex-1 py-3 text-[14px] font-bold rounded-xl border ${type === 'expense' ? 'bg-red-600 text-white border-red-600' : 'bg-gray-50 text-gray-900 border-gray-100'}`}>
              Расход
            </button>
            <button type="button" onClick={() => { setType('income'); setCategory(''); }}
              className={`flex-1 py-3 text-[14px] font-bold rounded-xl border ${type === 'income' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-50 text-gray-900 border-gray-100'}`}>
              Приход
            </button>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Сумма (начните с $ для USD)</label>
            <input type="text" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full bg-white border border-gray-100 rounded-xl px-4 py-4 font-extrabold text-[20px] outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="100 000 или $150" required />
          </div>
          {isUSD && (
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Курс USD (необязательно)</label>
              <input type="number" value={rate} onChange={e => setRate(e.target.value)}
                className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 font-bold outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="Например: 12700" />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Категория</label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2">
              {filteredCategories.map(c => (
                <button key={c.Category} type="button" onClick={() => setCategory(c.Category)}
                  className={`py-3 px-3 text-xs font-bold rounded-xl text-left truncate border ${category === c.Category
                    ? type === 'income' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'
                    : 'bg-white text-gray-900 border-gray-100'}`}>
                  {c.Category}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Дата</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 font-bold outline-none focus:ring-1 focus:ring-gray-900" required />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Примечание</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 font-bold outline-none focus:ring-1 focus:ring-gray-900 resize-none h-24"
              placeholder="Комментарий..." required></textarea>
          </div>
          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={handleDraft} disabled={isSubmitting}
              className="flex-[1] py-4 px-4 rounded-xl font-bold bg-[#EEEEEE] text-gray-900 uppercase tracking-wide text-[11px]">
              Черновик
            </button>
            <button type="submit" disabled={isSubmitting || !category}
              className="flex-[2] py-4 px-4 rounded-xl font-bold bg-gray-900 text-white disabled:opacity-50 uppercase tracking-wide text-[11px]">
              {isSubmitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
