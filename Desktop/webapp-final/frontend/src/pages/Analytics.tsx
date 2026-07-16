import React, { useState, useMemo } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatCompact, formatFull } from '../lib/formatters';
import {
  realTransactions, availableMonths, forMonth, computeSummary,
  getMonthKey, monthLabel, pctChange, CategoryTotal,
} from '../lib/analytics';

// All aggregation lives in lib/analytics.ts; the backend serves the same
// numbers as structured JSON at /api/analytics/summary for AI analysis.

function KpiCard({ label, value, sub, trend, tone }: {
  label: string; value: string; sub: string; trend?: string; tone: 'green' | 'red';
}) {
  const palette = tone === 'green'
    ? { bg: 'bg-green-50 border-green-100', label: 'text-green-600', value: 'text-green-700', sub: 'text-green-500' }
    : { bg: 'bg-red-50 border-red-100', label: 'text-red-500', value: 'text-red-700', sub: 'text-red-400' };
  return (
    <div className={`rounded-2xl p-4 border ${palette.bg}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${palette.label}`}>{label}</p>
      <p className={`text-[22px] font-extrabold ${palette.value}`}>{value}</p>
      <p className={`text-[10px] mt-0.5 ${palette.sub}`}>{sub}</p>
      {trend && (
        <p className={`text-[10px] font-bold mt-1 ${trend.startsWith('+') === (tone === 'green') ? 'text-green-600' : 'text-red-500'}`}>
          {trend} vs пред. месяц
        </p>
      )}
    </div>
  );
}

function CategoryList({ title, items, tone }: {
  title: string; items: CategoryTotal[]; tone: 'green' | 'red';
}) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  if (items.length === 0) return null;
  const max = items[0].total || 1;
  const bar = tone === 'green' ? 'bg-green-400' : 'bg-red-400';
  const amountColor = tone === 'green' ? 'text-green-600' : 'text-red-600';

  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100">
      <h3 className="text-[12px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">{title}</h3>
      <div className="space-y-3">
        {items.map((c, i) => {
          const hasSubs = c.subcategories.length > 0;
          const isOpen = openCat === c.category;
          return (
            <div key={c.category}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => hasSubs && setOpenCat(isOpen ? null : c.category)}
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-extrabold text-gray-400">#{i + 1}</span>
                    <span className="text-[13px] font-bold text-gray-800">
                      {c.category}
                      {hasSubs && <span className="text-gray-400 font-normal ml-1">{isOpen ? '▾' : '▸'}</span>}
                    </span>
                  </div>
                  <span className={`text-[13px] font-extrabold ${amountColor}`}>{formatCompact(c.total)}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${(c.total / max) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{formatFull(c.total)} сум · {c.count} опер.</p>
              </button>

              {hasSubs && isOpen && (
                <div className="mt-2 ml-6 space-y-1.5 border-l-2 border-gray-100 pl-3">
                  {c.subcategories.map(s => (
                    <div key={s.name} className="flex justify-between items-center">
                      <span className="text-[12px] font-medium text-gray-600">{s.name}</span>
                      <span className="text-[12px] font-bold text-gray-800">{formatCompact(s.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Analytics() {
  const { transactions } = useAppContext();
  const [selectedMonth, setSelectedMonth] = useState<string>(getMonthKey(new Date()));

  const realTxs = useMemo(() => realTransactions(transactions), [transactions]);
  const months = useMemo(() => availableMonths(realTxs), [realTxs]);

  const stats = useMemo(
    () => computeSummary(forMonth(realTxs, selectedMonth)),
    [realTxs, selectedMonth],
  );

  const prevStats = useMemo(() => {
    if (selectedMonth === 'all') return null;
    const [y, m] = selectedMonth.split('-').map(Number);
    const prevKey = getMonthKey(new Date(y, m - 2, 1));
    return computeSummary(forMonth(realTxs, prevKey));
  }, [realTxs, selectedMonth]);

  return (
    <div className="space-y-5 pb-8">
      <h2 className="text-[24px] font-extrabold tracking-tight text-gray-900">Аналитика</h2>

      {/* Period selector */}
      <div className="bg-white rounded-2xl border border-gray-100 p-1 flex gap-1 overflow-x-auto">
        {months.map(mk => (
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Доход" tone="green"
          value={formatCompact(stats.income)}
          sub={`сум · ${stats.incomeCount} опер.`}
          trend={prevStats && stats.income > 0 ? pctChange(stats.income, prevStats.income) : undefined} />
        <KpiCard label="Расход" tone="red"
          value={formatCompact(stats.expense)}
          sub={`сум · ${stats.expenseCount} опер.`}
          trend={prevStats && stats.expense > 0 ? pctChange(stats.expense, prevStats.expense) : undefined} />
      </div>

      {/* Net balance */}
      <div className={`rounded-2xl p-4 border ${stats.net >= 0 ? 'bg-gray-900' : 'bg-red-900'}`}>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Чистый баланс</p>
        <p className={`text-[32px] font-extrabold ${stats.net >= 0 ? 'text-white' : 'text-red-300'}`}>
          {stats.net >= 0 ? '+' : ''}{formatCompact(stats.net)}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">{formatFull(stats.net)} сум · {stats.txCount} операций</p>
        {prevStats && (
          <p className={`text-[10px] font-bold mt-1 ${stats.net >= prevStats.net ? 'text-green-400' : 'text-red-400'}`}>
            {pctChange(stats.net, prevStats.net)} vs предыдущий месяц
          </p>
        )}
      </div>

      {/* Daily averages */}
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

      {/* USD summary */}
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

      {/* Top categories — tap a category to see its subcategories */}
      <CategoryList title="Топ доходов" items={stats.topIncome} tone="green" />
      <CategoryList title="Топ расходов" items={stats.topExpense} tone="red" />

      {stats.txCount === 0 && (
        <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200">
          <p className="text-[13px] font-bold text-gray-400 uppercase tracking-widest">Нет данных</p>
        </div>
      )}
    </div>
  );
}
