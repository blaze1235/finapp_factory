import { useState } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatCurrency } from '../lib/formatters';
import { isToday, isThisWeek, isThisMonth, parse, isWithinInterval, startOfDay, endOfDay } from 'date-fns';

type Period = 'today' | 'week' | 'month' | 'all' | 'custom';

export function Reports() {
  const { transactions } = useAppContext();
  const [period, setPeriod] = useState<Period>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [currency, setCurrency] = useState<'UZS'|'USD'>('UZS');

  const realTransactions = transactions.filter(t => t.Type !== 'draft');

  const filtered = realTransactions.filter(tx => {
    if (tx.Currency !== currency) return false;
    try {
      const date = parse(tx.Date, 'dd.MM.yyyy', new Date());
      if (isNaN(date.getTime())) return false;
      if (period === 'today') return isToday(date);
      if (period === 'week') return isThisWeek(date, { weekStartsOn: 1 });
      if (period === 'month') return isThisMonth(date);
      if (period === 'custom' && customStart && customEnd) {
        return isWithinInterval(date, { start: startOfDay(new Date(customStart)), end: endOfDay(new Date(customEnd)) });
      }
      return true;
    } catch { return false; }
  });

  const incomeTxs = filtered.filter(t => t.Type === 'income');
  const expenseTxs = filtered.filter(t => t.Type === 'expense');
  const totalIncome = incomeTxs.reduce((acc, t) => acc + Number(t.Currency === 'UZS' ? t.Amount_UZS : t.Amount_USD), 0);
  const totalExpense = expenseTxs.reduce((acc, t) => acc + Number(t.Currency === 'UZS' ? t.Amount_UZS : t.Amount_USD), 0);
  const netResult = totalIncome - totalExpense;

  const incomeByCat = incomeTxs.reduce((acc, t) => { acc[t.Category] = (acc[t.Category] || 0) + Number(t.Currency === 'UZS' ? t.Amount_UZS : t.Amount_USD); return acc; }, {} as Record<string, number>);
  const expenseByCat = expenseTxs.reduce((acc, t) => { acc[t.Category] = (acc[t.Category] || 0) + Number(t.Currency === 'UZS' ? t.Amount_UZS : t.Amount_USD); return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-6 pb-4">
      <h2 className="text-2xl font-extrabold tracking-tight text-gray-900 mb-6">
        Отчеты <span className="text-[13px] font-normal text-gray-500 ml-1">/ Hisobotlar</span>
      </h2>
      <div className="flex bg-white rounded-xl p-1 border border-gray-100">
        <button onClick={() => setCurrency('UZS')} className={`flex-1 py-2 text-xs font-bold rounded-lg uppercase tracking-wider ${currency === 'UZS' ? 'bg-[#EEEEEE] text-gray-900' : 'text-gray-500'}`}>UZS</button>
        <button onClick={() => setCurrency('USD')} className={`flex-1 py-2 text-xs font-bold rounded-lg uppercase tracking-wider ${currency === 'USD' ? 'bg-[#EEEEEE] text-gray-900' : 'text-gray-500'}`}>USD</button>
      </div>
      <div className="flex overflow-x-auto pb-2 gap-2 hide-scrollbar">
        {[{id:'today',label:'Сегодня'},{id:'week',label:'Неделя'},{id:'month',label:'Месяц'},{id:'all',label:'Все время'},{id:'custom',label:'Свой...'}].map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id as Period)}
            className={`whitespace-nowrap px-4 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider ${period === p.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 border border-gray-200'}`}>
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex gap-2">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="flex-1 bg-white border border-gray-100 rounded-xl px-4 py-3 font-bold" />
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="flex-1 bg-white border border-gray-100 rounded-xl px-4 py-3 font-bold" />
        </div>
      )}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 space-y-6">
        <div>
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Итого (Чистая прибыль)</h3>
          <p className={`text-[32px] font-extrabold tracking-[-1px] leading-none ${netResult >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {netResult > 0 ? '+' : ''}{formatCurrency(String(netResult), currency)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
          <div>
            <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Приход ▲</h3>
            <p className="text-xl font-bold text-green-600">{formatCurrency(String(totalIncome), currency)}</p>
          </div>
          <div>
            <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Расход ▼</h3>
            <p className="text-xl font-bold text-red-600">{formatCurrency(String(totalExpense), currency)}</p>
          </div>
        </div>
      </div>
      {Object.keys(incomeByCat).length > 0 && (
        <div className="mt-8">
          <h3 className="text-[14px] font-bold uppercase tracking-widest text-gray-900 mb-4 ml-1">Детализация Прихода</h3>
          <div className="space-y-2">
            {Object.entries(incomeByCat).sort((a,b)=>Number(b[1])-Number(a[1])).map(([cat,amount]) => (
              <div key={cat} className="flex justify-between items-center bg-white p-4 rounded-xl border border-green-100">
                <span className="text-sm font-bold text-gray-700">{cat}</span>
                <span className="text-[15px] font-extrabold text-green-600">{formatCurrency(String(amount), currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {Object.keys(expenseByCat).length > 0 && (
        <div className="mt-8">
          <h3 className="text-[14px] font-bold uppercase tracking-widest text-gray-900 mb-4 ml-1">Детализация Расхода</h3>
          <div className="space-y-2">
            {Object.entries(expenseByCat).sort((a,b)=>Number(b[1])-Number(a[1])).map(([cat,amount]) => (
              <div key={cat} className="flex justify-between items-center bg-white p-4 rounded-xl border border-red-100">
                <span className="text-sm font-bold text-gray-700">{cat}</span>
                <span className="text-[15px] font-extrabold text-red-600">{formatCurrency(String(amount), currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
