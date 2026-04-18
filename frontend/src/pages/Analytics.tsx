import React, { useState, useMemo } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatCompact, formatFull } from '../lib/formatters';

function parseDate(str: string): Date | null {
  if (!str) return null;
  const [d, m, y] = str.split('.');
  if (!d || !m || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const months = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

export function Analytics() {
  const { transactions } = useAppContext();

  const now = new Date();
  const currentMonthKey = getMonthKey(now);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey);

  const realTxs = useMemo(() =>
    transactions.filter(t => t.Type !== 'draft'),
    [transactions]
  );

  // All available months sorted desc
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    realTxs.forEach(t => {
      const d = parseDate(t.Date);
      if (d) set.add(getMonthKey(d));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [realTxs]);

  // Filtered transactions for selected period
  const periodTxs = useMemo(() => {
    if (selectedMonth === 'all') return realTxs;
    return realTxs.filter(t => {
      const d = parseDate(t.Date);
      return d && getMonthKey(d) === selectedMonth;
    });
  }, [realTxs, selectedMonth]);

  // Main stats
  const stats = useMemo(() => {
    let income = 0, expense = 0, incomeUSD = 0, expenseUSD = 0;
    const incomeByCategory: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};

    periodTxs.forEach(t => {
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      const usd = parseFloat(String(t.Amount_USD ?? 0)) || 0;
      if (t.Type === 'income') {
        income += uzs; incomeUSD += usd;
        incomeByCategory[t.Category] = (incomeByCategory[t.Category] || 0) + uzs;
      } else {
        expense += uzs; expenseUSD += usd;
        expenseByCategory[t.Category] = (expenseByCategory[t.Category] || 0) + uzs;
      }
    });

    const topIncome = Object.entries(incomeByCategory).sort((a,b) => b[1]-a[1]).slice(0,5);
    const topExpense = Object.entries(expenseByCategory).sort((a,b) => b[1]-a[1]).slice(0,5);

    // Daily breakdown
    const dailyMap: Record<string, { income: number; expense: number }> = {};
    periodTxs.forEach(t => {
      if (!t.Date) return;
      if (!dailyMap[t.Date]) dailyMap[t.Date] = { income: 0, expense: 0 };
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      if (t.Type === 'income') dailyMap[t.Date].income += uzs;
      else dailyMap[t.Date].expense += uzs;
    });
    const daysCount = Object.keys(dailyMap).length || 1;
    const avgDailyExpense = expense / daysCount;
    const avgDailyIncome = income / daysCount;

    return {
      income, expense, incomeUSD, expenseUSD,
      net: income - expense,
      topIncome, topExpense,
      avgDailyExpense, avgDailyIncome,
      txCount: periodTxs.length,
      incomeCount: periodTxs.filter(t => t.Type === 'income').length,
      expenseCount: periodTxs.filter(t => t.Type === 'expense').length,
    };
  }, [periodTxs]);

  // Month-over-month comparison (only when specific month selected)
  const prevMonthStats = useMemo(() => {
    if (selectedMonth === 'all') return null;
    const [y, m] = selectedMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevKey = getMonthKey(prevDate);
    const prevTxs = realTxs.filter(t => {
      const d = parseDate(t.Date);
      return d && getMonthKey(d) === prevKey;
    });
    let income = 0, expense = 0;
    prevTxs.forEach(t => {
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      if (t.Type === 'income') income += uzs;
      else expense += uzs;
    });
    return { income, expense, net: income - expense };
  }, [realTxs, selectedMonth]);

  function pct(curr: number, prev: number): string {
    if (!prev) return '';
    const diff = ((curr - prev) / prev) * 100;
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%`;
  }

  return (
    <div className="space-y-5 pb-8">
      <h2 className="text-[24px] font-extrabold tracking-tight text-gray-900">Аналитика</h2>

      {/* Period selector */}
      <div className="bg-white rounded-2xl border border-gray-100 p-1 flex gap-1 overflow-x-auto">
        {availableMonths.map(mk => (
          <button key={mk} onClick={() => setSelectedMonth(mk)}
            className={`flex-shrink-0 px-3 py-2 rounded-xl text-[11px] font-bold transition-colors ${
              selectedMonth === mk ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}>
            {monthLabel(mk)}
          </button>
        ))}
        <button onClick={() => setSelectedMonth('all')}
          className={`flex-shrink-0 px-3 py-2 rounded-xl text-[11px] font-bold transition-colors ${
            selectedMonth === 'all' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
          }`}>
          Всё время
        </button>
      </div>

      {/* Main KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
          <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-1">Доход</p>
          <p className="text-[22px] font-extrabold text-green-700">{formatCompact(stats.income)}</p>
          <p className="text-[10px] text-green-500 mt-0.5">сум · {stats.incomeCount} опер.</p>
          {prevMonthStats && stats.income > 0 && (
            <p className={`text-[10px] font-bold mt-1 ${stats.income >= prevMonthStats.income ? 'text-green-600' : 'text-red-500'}`}>
              {pct(stats.income, prevMonthStats.income)} vs пред. месяц
            </p>
          )}
        </div>
        <div className="bg-red-50 rounded-2xl p-4 border border-red-100">
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Расход</p>
          <p className="text-[22px] font-extrabold text-red-700">{formatCompact(stats.expense)}</p>
          <p className="text-[10px] text-red-400 mt-0.5">сум · {stats.expenseCount} опер.</p>
          {prevMonthStats && stats.expense > 0 && (
            <p className={`text-[10px] font-bold mt-1 ${stats.expense <= prevMonthStats.expense ? 'text-green-600' : 'text-red-500'}`}>
              {pct(stats.expense, prevMonthStats.expense)} vs пред. месяц
            </p>
          )}
        </div>
      </div>

      {/* Net balance */}
      <div className={`rounded-2xl p-4 border ${stats.net >= 0 ? 'bg-gray-900' : 'bg-red-900'}`}>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Чистый баланс</p>
        <p className={`text-[32px] font-extrabold ${stats.net >= 0 ? 'text-white' : 'text-red-300'}`}>
          {stats.net >= 0 ? '+' : ''}{formatCompact(stats.net)}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">{formatFull(stats.net)} сум · {stats.txCount} операций</p>
        {prevMonthStats && (
          <p className={`text-[10px] font-bold mt-1 ${stats.net >= prevMonthStats.net ? 'text-green-400' : 'text-red-400'}`}>
            {pct(stats.net, prevMonthStats.net)} vs предыдущий месяц
          </p>
        )}
      </div>

      {/* Avg daily */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Ср. доход / день</p>
          <p className="text-[20px] font-extrabold text-gray-900">{formatCompact(stats.avgDailyIncome)}</p>
          <p className="text-[10px] text-gray-400">сум</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Ср. расход / день</p>
          <p className="text-[20px] font-extrabold text-gray-900">{formatCompact(stats.avgDailyExpense)}</p>
          <p className="text-[10px] text-gray-400">сум</p>
        </div>
      </div>

      {/* USD summary if any */}
      {(stats.incomeUSD > 0 || stats.expenseUSD > 0) && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">В долларах</p>
          <div className="flex gap-6">
            {stats.incomeUSD > 0 && (
              <div>
                <p className="text-[10px] text-green-600 font-bold">Доход</p>
                <p className="text-[18px] font-extrabold text-green-700">${formatCompact(stats.incomeUSD)}</p>
              </div>
            )}
            {stats.expenseUSD > 0 && (
              <div>
                <p className="text-[10px] text-red-500 font-bold">Расход</p>
                <p className="text-[18px] font-extrabold text-red-700">${formatCompact(stats.expenseUSD)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top income categories */}
      {stats.topIncome.length > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <h3 className="text-[12px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">Топ доходов</h3>
          <div className="space-y-3">
            {stats.topIncome.map(([cat, amt], i) => (
              <div key={cat}>
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-extrabold text-gray-400">#{i+1}</span>
                    <span className="text-[13px] font-bold text-gray-800">{cat}</span>
                  </div>
                  <span className="text-[13px] font-extrabold text-green-600">{formatCompact(amt)}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className="bg-green-400 h-1.5 rounded-full"
                    style={{ width: `${(amt / stats.topIncome[0][1]) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{formatFull(amt)} сум</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top expense categories */}
      {stats.topExpense.length > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <h3 className="text-[12px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">Топ расходов</h3>
          <div className="space-y-3">
            {stats.topExpense.map(([cat, amt], i) => (
              <div key={cat}>
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-extrabold text-gray-400">#{i+1}</span>
                    <span className="text-[13px] font-bold text-gray-800">{cat}</span>
                  </div>
                  <span className="text-[13px] font-extrabold text-red-600">{formatCompact(amt)}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className="bg-red-400 h-1.5 rounded-full"
                    style={{ width: `${(amt / stats.topExpense[0][1]) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{formatFull(amt)} сум</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {periodTxs.length === 0 && (
        <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200">
          <p className="text-[13px] font-bold text-gray-400 uppercase tracking-widest">Нет данных</p>
        </div>
      )}
    </div>
  );
}
