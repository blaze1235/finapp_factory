import React, { useState, useMemo } from 'react';
import { useAppContext } from '../contexts/AppContext';

function parseDate(str: string): Date | null {
  if (!str) return null;
  const [d, m, y] = str.split('.');
  if (!d || !m || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

export function Analytics() {
  const { transactions } = useAppContext();
  const [targetDate, setTargetDate] = useState('');
  const [view, setView] = useState<'overview' | 'daily' | 'balance'>('overview');

  const realTxs = transactions.filter(t => t.Type !== 'draft');

  // Balance as of target date
  const balanceAtDate = useMemo(() => {
    if (!targetDate) return null;
    const [y, m, d] = targetDate.split('-');
    const target = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));

    let income = 0, expense = 0, incomeUSD = 0, expenseUSD = 0;
    realTxs.forEach(t => {
      const date = parseDate(t.Date);
      if (!date || date > target) return;
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      const usd = parseFloat(String(t.Amount_USD ?? 0)) || 0;
      if (t.Type === 'income') { income += uzs; incomeUSD += usd; }
      else { expense += uzs; expenseUSD += usd; }
    });
    return { income, expense, net: income - expense, incomeUSD, expenseUSD };
  }, [targetDate, realTxs]);

  // Daily breakdown — last 30 days
  const dailyData = useMemo(() => {
    const map: Record<string, { income: number; expense: number; count: number }> = {};
    realTxs.forEach(t => {
      if (!t.Date) return;
      if (!map[t.Date]) map[t.Date] = { income: 0, expense: 0, count: 0 };
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      if (t.Type === 'income') map[t.Date].income += uzs;
      else map[t.Date].expense += uzs;
      map[t.Date].count++;
    });

    return Object.entries(map)
      .map(([date, v]) => ({ date, ...v, net: v.income - v.expense }))
      .sort((a, b) => {
        const da = parseDate(a.date)?.getTime() || 0;
        const db = parseDate(b.date)?.getTime() || 0;
        return db - da;
      })
      .slice(0, 30);
  }, [realTxs]);

  // Running balance over time
  const runningBalance = useMemo(() => {
    const sorted = [...realTxs].sort((a, b) => {
      const da = parseDate(a.Date)?.getTime() || 0;
      const db = parseDate(b.Date)?.getTime() || 0;
      return da - db;
    });

    let balance = 0;
    const points: { date: string; balance: number }[] = [];
    const seen = new Set<string>();

    sorted.forEach(t => {
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      balance += t.Type === 'income' ? uzs : -uzs;
      if (!seen.has(t.Date)) {
        seen.add(t.Date);
        points.push({ date: t.Date, balance });
      } else {
        if (points.length > 0) points[points.length - 1].balance = balance;
      }
    });

    return points.slice(-30);
  }, [realTxs]);

  // Overview stats
  const overview = useMemo(() => {
    let totalIncome = 0, totalExpense = 0;
    const categoryTotals: Record<string, number> = {};
    realTxs.forEach(t => {
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      if (t.Type === 'income') totalIncome += uzs;
      else {
        totalExpense += uzs;
        categoryTotals[t.Category] = (categoryTotals[t.Category] || 0) + uzs;
      }
    });

    const topExpenses = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const avgDailyExpense = totalExpense / Math.max(dailyData.length, 1);

    return { totalIncome, totalExpense, net: totalIncome - totalExpense, topExpenses, avgDailyExpense };
  }, [realTxs, dailyData]);

  const maxDaily = Math.max(...dailyData.map(d => Math.max(d.income, d.expense)), 1);
  const minBalance = Math.min(...runningBalance.map(p => p.balance));
  const maxBalance = Math.max(...runningBalance.map(p => p.balance));
  const balanceRange = maxBalance - minBalance || 1;

  return (
    <div className="space-y-5 pb-8">
      <h2 className="text-[24px] font-extrabold tracking-tight text-gray-900">Аналитика</h2>

      {/* View switcher */}
      <div className="flex gap-2">
        {(['overview', 'daily', 'balance'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-colors ${
              view === v ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-100 hover:bg-gray-50'
            }`}>
            {v === 'overview' ? 'Обзор' : v === 'daily' ? 'По дням' : 'Баланс'}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {view === 'overview' && (
        <div className="space-y-4">
          {/* Total stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
              <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-1">Всего доходов</p>
              <p className="text-[20px] font-extrabold text-green-700">{(overview.totalIncome/1_000_000).toFixed(2)}M</p>
              <p className="text-[10px] text-green-500 mt-1">сум</p>
            </div>
            <div className="bg-red-50 rounded-2xl p-4 border border-red-100">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Всего расходов</p>
              <p className="text-[20px] font-extrabold text-red-700">{(overview.totalExpense/1_000_000).toFixed(2)}M</p>
              <p className="text-[10px] text-red-400 mt-1">сум</p>
            </div>
          </div>

          <div className={`rounded-2xl p-4 border ${overview.net >= 0 ? 'bg-gray-900' : 'bg-red-900'}`}>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Чистый баланс</p>
            <p className={`text-[28px] font-extrabold ${overview.net >= 0 ? 'text-white' : 'text-red-300'}`}>
              {overview.net >= 0 ? '+' : ''}{(overview.net/1_000_000).toFixed(2)}M
            </p>
            <p className="text-[10px] text-gray-500 mt-1">{realTxs.length} операций всего</p>
          </div>

          {/* Avg daily expense */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Средний расход в день</p>
            <p className="text-[22px] font-extrabold text-gray-900">{(overview.avgDailyExpense/1000).toFixed(0)}K</p>
            <p className="text-[10px] text-gray-400">сум / день</p>
          </div>

          {/* Top expense categories */}
          {overview.topExpenses.length > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-[12px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">Топ расходов</h3>
              <div className="space-y-3">
                {overview.topExpenses.map(([cat, amt], i) => (
                  <div key={cat}>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold text-gray-400">#{i+1}</span>
                        <span className="text-[13px] font-bold text-gray-800">{cat}</span>
                      </div>
                      <span className="text-[13px] font-extrabold text-red-600">
                        {(amt/1_000_000).toFixed(2)}M
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="bg-red-400 h-1.5 rounded-full"
                        style={{ width: `${(amt / overview.topExpenses[0][1]) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* DAILY VIEW */}
      {view === 'daily' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <h3 className="text-[12px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">Последние 30 дней</h3>
            <div className="flex items-end gap-1 h-32 mb-3">
              {dailyData.slice().reverse().map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end" title={`${d.date}: +${d.income.toLocaleString()} / -${d.expense.toLocaleString()}`}>
                  {d.income > 0 && (
                    <div className="w-full bg-green-400 rounded-sm"
                      style={{ height: `${(d.income / maxDaily) * 100}%` }} />
                  )}
                  {d.expense > 0 && (
                    <div className="w-full bg-red-400 rounded-sm"
                      style={{ height: `${(d.expense / maxDaily) * 100}%` }} />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-400 rounded-sm"/><span className="text-[10px] text-gray-500">Доход</span></div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-400 rounded-sm"/><span className="text-[10px] text-gray-500">Расход</span></div>
            </div>
          </div>

          <div className="space-y-2">
            {dailyData.map(d => (
              <div key={d.date} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[13px] font-extrabold text-gray-900">{d.date}</span>
                  <span className={`text-[13px] font-extrabold ${d.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {d.net >= 0 ? '+' : ''}{(d.net/1000).toFixed(0)}K
                  </span>
                </div>
                <div className="flex gap-4">
                  {d.income > 0 && <span className="text-[11px] text-green-600">+{(d.income/1000).toFixed(0)}K</span>}
                  {d.expense > 0 && <span className="text-[11px] text-red-500">-{(d.expense/1000).toFixed(0)}K</span>}
                  <span className="text-[11px] text-gray-400 ml-auto">{d.count} опер.</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BALANCE VIEW */}
      {view === 'balance' && (
        <div className="space-y-4">
          {/* Target date balance */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <h3 className="text-[12px] font-extrabold uppercase tracking-widest text-gray-900 mb-3">Баланс на дату</h3>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-[13px] outline-none focus:ring-1 focus:ring-gray-900 mb-4" />

            {balanceAtDate ? (
              <div className="space-y-3">
                <div className={`rounded-xl p-4 ${balanceAtDate.net >= 0 ? 'bg-gray-900' : 'bg-red-900'}`}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Баланс на {targetDate.split('-').reverse().join('.')}</p>
                  <p className={`text-[28px] font-extrabold ${balanceAtDate.net >= 0 ? 'text-white' : 'text-red-300'}`}>
                    {balanceAtDate.net >= 0 ? '+' : ''}{(balanceAtDate.net/1_000_000).toFixed(2)}M сум
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                    <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Доход</p>
                    <p className="text-[16px] font-extrabold text-green-700">{(balanceAtDate.income/1_000_000).toFixed(2)}M</p>
                    {balanceAtDate.incomeUSD > 0 && <p className="text-[10px] text-green-500">${balanceAtDate.incomeUSD.toLocaleString()}</p>}
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Расход</p>
                    <p className="text-[16px] font-extrabold text-red-700">{(balanceAtDate.expense/1_000_000).toFixed(2)}M</p>
                    {balanceAtDate.expenseUSD > 0 && <p className="text-[10px] text-red-400">${balanceAtDate.expenseUSD.toLocaleString()}</p>}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-gray-400 text-center py-4">Выберите дату для просмотра баланса</p>
            )}
          </div>

          {/* Running balance chart */}
          {runningBalance.length > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <h3 className="text-[12px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">Динамика баланса</h3>
              <div className="relative h-32">
                <svg viewBox={`0 0 ${runningBalance.length * 10} 100`} className="w-full h-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={minBalance >= 0 ? '#22c55e' : '#ef4444'} stopOpacity="0.3"/>
                      <stop offset="100%" stopColor={minBalance >= 0 ? '#22c55e' : '#ef4444'} stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  <polyline
                    points={runningBalance.map((p, i) => `${i * 10 + 5},${100 - ((p.balance - minBalance) / balanceRange) * 90}`).join(' ')}
                    fill="none"
                    stroke={minBalance >= 0 ? '#22c55e' : '#ef4444'}
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-gray-400">{runningBalance[0]?.date}</span>
                <span className="text-[10px] text-gray-400">{runningBalance[runningBalance.length-1]?.date}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] font-bold text-gray-500">Min: {(minBalance/1000).toFixed(0)}K</span>
                <span className="text-[10px] font-bold text-gray-500">Max: {(maxBalance/1000).toFixed(0)}K</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
