import React, { useState, useMemo } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatCurrency } from '../lib/formatters';

type Transaction = {
  ID: string;
  Date: string;
  Type: string;
  Category: string;
  Amount_UZS: string;
  Amount_USD: string;
  USD_Rate: string;
  Note: string;
  Editor_Name: string;
  Currency: string;
  Timestamp: string;
};

function parseDate(str: string): Date | null {
  if (!str) return null;
  const [d, m, y] = str.split('.');
  if (!d || !m || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function formatDate(date: Date): string {
  return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
}

function toInputDate(str: string): string {
  if (!str) return '';
  const [d, m, y] = str.split('.');
  if (!d || !m || !y) return '';
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function fromInputDate(str: string): string {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}.${m}.${y}`;
}

export function Reports() {
  const { transactions, categories } = useAppContext();

  const [search, setSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [singleDate, setSingleDate] = useState('');
  const [dateMode, setDateMode] = useState<'range' | 'single'>('range');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const allCategories = useMemo(() => {
    const cats = new Set(transactions.map(t => t.Category).filter(Boolean));
    return Array.from(cats).sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    let txs = [...transactions].filter(t => t.Type !== 'draft');

    // Date filter
    if (dateMode === 'single' && singleDate) {
      const target = fromInputDate(singleDate);
      txs = txs.filter(t => t.Date === target);
    } else if (dateMode === 'range') {
      if (dateFrom) {
        const from = parseDate(fromInputDate(dateFrom));
        if (from) txs = txs.filter(t => { const d = parseDate(t.Date); return d && d >= from; });
      }
      if (dateTo) {
        const to = parseDate(fromInputDate(dateTo));
        if (to) txs = txs.filter(t => { const d = parseDate(t.Date); return d && d <= to; });
      }
    }

    // Type filter
    if (typeFilter !== 'all') txs = txs.filter(t => t.Type === typeFilter);

    // Category filter
    if (selectedCategories.length > 0) {
      txs = txs.filter(t => selectedCategories.includes(t.Category));
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      txs = txs.filter(t =>
        t.Note?.toLowerCase().includes(q) ||
        t.Category?.toLowerCase().includes(q) ||
        t.Editor_Name?.toLowerCase().includes(q) ||
        t.Amount_UZS?.includes(q)
      );
    }

    // Sort
    txs.sort((a, b) => {
      if (sortBy === 'date') {
        const da = parseDate(a.Date)?.getTime() || 0;
        const db = parseDate(b.Date)?.getTime() || 0;
        return sortDir === 'desc' ? db - da : da - db;
      } else {
        const aa = parseFloat(a.Amount_UZS || '0');
        const bb = parseFloat(b.Amount_UZS || '0');
        return sortDir === 'desc' ? bb - aa : aa - bb;
      }
    });

    return txs;
  }, [transactions, search, selectedCategories, typeFilter, dateFrom, dateTo, singleDate, dateMode, sortBy, sortDir]);

  const summary = useMemo(() => {
    let income = 0, expense = 0;
    let incomeUSD = 0, expenseUSD = 0;
    filtered.forEach(t => {
      const uzs = parseFloat(t.Amount_UZS || '0') || 0;
      const usd = parseFloat(t.Amount_USD || '0') || 0;
      if (t.Type === 'income') { income += uzs; incomeUSD += usd; }
      else { expense += uzs; expenseUSD += usd; }
    });
    return { income, expense, net: income - expense, incomeUSD, expenseUSD };
  }, [filtered]);

  // Category breakdown for filtered
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, { income: number; expense: number; count: number }> = {};
    filtered.forEach(t => {
      if (!map[t.Category]) map[t.Category] = { income: 0, expense: 0, count: 0 };
      const uzs = parseFloat(t.Amount_UZS || '0') || 0;
      if (t.Type === 'income') map[t.Category].income += uzs;
      else map[t.Category].expense += uzs;
      map[t.Category].count++;
    });
    return Object.entries(map)
      .map(([cat, v]) => ({ cat, ...v, net: v.income - v.expense }))
      .sort((a, b) => Math.abs(b.expense + b.income) - Math.abs(a.expense + a.income));
  }, [filtered]);

  const maxBar = Math.max(...categoryBreakdown.map(c => c.income + c.expense), 1);

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedCategories([]);
    setTypeFilter('all');
    setDateFrom('');
    setDateTo('');
    setSingleDate('');
  };

  const hasFilters = search || selectedCategories.length > 0 || typeFilter !== 'all' || dateFrom || dateTo || singleDate;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex justify-between items-center">
        <h2 className="text-[24px] font-extrabold tracking-tight text-gray-900">Отчёты</h2>
        {hasFilters && (
          <button onClick={clearFilters} className="text-[11px] font-bold text-red-500 uppercase tracking-widest border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50">
            Сбросить
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl p-3 border border-gray-100">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Доход</p>
          <p className="text-[14px] font-extrabold text-green-600 leading-tight">
            {(summary.income / 1_000_000).toFixed(1)}M
          </p>
          <p className="text-[9px] text-gray-400">{filtered.filter(t=>t.Type==='income').length} опер.</p>
        </div>
        <div className="bg-white rounded-2xl p-3 border border-gray-100">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Расход</p>
          <p className="text-[14px] font-extrabold text-red-600 leading-tight">
            {(summary.expense / 1_000_000).toFixed(1)}M
          </p>
          <p className="text-[9px] text-gray-400">{filtered.filter(t=>t.Type==='expense').length} опер.</p>
        </div>
        <div className={`rounded-2xl p-3 border ${summary.net >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Итог</p>
          <p className={`text-[14px] font-extrabold leading-tight ${summary.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {summary.net >= 0 ? '+' : ''}{(summary.net / 1_000_000).toFixed(1)}M
          </p>
          <p className="text-[9px] text-gray-400">{filtered.length} всего</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
        {/* Search */}
        <div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по заметке, категории, редактору..."
            className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-2">
          {(['all', 'income', 'expense'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-colors ${
                typeFilter === t ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-100 hover:bg-gray-50'
              }`}>
              {t === 'all' ? 'Все' : t === 'income' ? '▲ Доход' : '▼ Расход'}
            </button>
          ))}
        </div>

        {/* Date mode */}
        <div>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setDateMode('range')}
              className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border ${dateMode === 'range' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-100'}`}>
              Период
            </button>
            <button onClick={() => setDateMode('single')}
              className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border ${dateMode === 'single' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-100'}`}>
              Один день
            </button>
          </div>

          {dateMode === 'range' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">От</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-[12px] outline-none focus:ring-1 focus:ring-gray-900" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">До</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-[12px] outline-none focus:ring-1 focus:ring-gray-900" />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Дата</label>
              <input type="date" value={singleDate} onChange={e => setSingleDate(e.target.value)}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-[12px] outline-none focus:ring-1 focus:ring-gray-900" />
            </div>
          )}
        </div>

        {/* Category filter */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Категории</p>
          <div className="flex flex-wrap gap-1.5">
            {allCategories.map(cat => (
              <button key={cat} onClick={() => toggleCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                  selectedCategories.includes(cat)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div className="flex gap-2 items-center">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Сортировка:</p>
          <button onClick={() => setSortBy('date')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border ${sortBy === 'date' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-200'}`}>
            По дате
          </button>
          <button onClick={() => setSortBy('amount')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border ${sortBy === 'amount' ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-200'}`}>
            По сумме
          </button>
          <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-gray-200 text-gray-500">
            {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      {/* Category breakdown chart */}
      {categoryBreakdown.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-[13px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">По категориям</h3>
          <div className="space-y-3">
            {categoryBreakdown.slice(0, 10).map(({ cat, income, expense, count }) => (
              <div key={cat}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[12px] font-bold text-gray-700">{cat}</span>
                  <span className="text-[10px] text-gray-400">{count} опер.</span>
                </div>
                <div className="flex gap-1 h-4">
                  {income > 0 && (
                    <div className="bg-green-400 rounded-sm" style={{ width: `${(income / maxBar) * 100}%` }} title={`Доход: ${income.toLocaleString()}`} />
                  )}
                  {expense > 0 && (
                    <div className="bg-red-400 rounded-sm" style={{ width: `${(expense / maxBar) * 100}%` }} title={`Расход: ${expense.toLocaleString()}`} />
                  )}
                </div>
                <div className="flex gap-3 mt-0.5">
                  {income > 0 && <span className="text-[10px] text-green-600 font-bold">+{(income/1000).toFixed(0)}K</span>}
                  {expense > 0 && <span className="text-[10px] text-red-500 font-bold">-{(expense/1000).toFixed(0)}K</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[13px] font-extrabold uppercase tracking-widest text-gray-900">
            Операции ({filtered.length})
          </h3>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-[13px] font-bold text-gray-400 uppercase tracking-widest">Ничего не найдено</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(tx => (
              <div key={tx.ID} className="bg-white p-4 rounded-2xl border border-gray-100">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tx.Type === 'income' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-[12px] font-bold text-gray-900 uppercase tracking-widest">{tx.Category}</span>
                  </div>
                  <span className={`text-[14px] font-extrabold ${tx.Type === 'income' ? 'text-green-600' : 'text-gray-900'}`}>
                    {tx.Type === 'income' ? '+' : '-'}
                    {tx.Currency === 'USD'
                      ? `$${parseFloat(tx.Amount_USD || '0').toLocaleString()}`
                      : `${parseFloat(tx.Amount_UZS || '0').toLocaleString()} сум`}
                  </span>
                </div>
                {tx.Note && <p className="text-[12px] text-gray-500 mt-1.5 ml-4">{tx.Note}</p>}
                <div className="flex justify-between mt-2 ml-4">
                  <span className="text-[10px] text-gray-400">{tx.Editor_Name}</span>
                  <span className="text-[10px] font-bold text-gray-400">{tx.Date}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
