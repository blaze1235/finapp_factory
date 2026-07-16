import React, { useState, useMemo } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatCompact, formatFull } from '../lib/formatters';

function parseDate(str: string): Date | null {
  if (!str) return null;
  const [d, m, y] = str.split('.');
  if (!d || !m || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function fromInputDate(str: string): string {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}.${m}.${y}`;
}

type TxDetail = {
  ID: string; Date: string; Type: string; Category: string;
  Amount_UZS: string | number; Amount_USD: string | number;
  USD_Rate: string | number; Note: string; Editor_Name: string;
  Currency: string; Timestamp: string;
};

export function Reports() {
  const { transactions, categories } = useAppContext();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [singleDate, setSingleDate] = useState('');
  const [dateMode, setDateMode] = useState<'range' | 'single'>('range');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTx, setSelectedTx] = useState<TxDetail | null>(null);

  // Separate category lists from sheet
  const incomeCategories = useMemo(() =>
    Array.from(new Set(
      (categories || []).filter((c: any) => c.Type === 'income').map((c: any) => c.Category)
    )).sort(),
    [categories]
  );
  const expenseCategories = useMemo(() =>
    Array.from(new Set(
      (categories || []).filter((c: any) => c.Type === 'expense').map((c: any) => c.Category)
    )).sort(),
    [categories]
  );
  // fallback: derive from transactions if categories not loaded
  const allCategoriesByType = useMemo(() => {
    const inc = new Set<string>();
    const exp = new Set<string>();
    transactions.forEach(t => {
      if (t.Type === 'income') inc.add(t.Category);
      else if (t.Type === 'expense') exp.add(t.Category);
    });
    return {
      income: incomeCategories.length > 0 ? incomeCategories : Array.from(inc).sort(),
      expense: expenseCategories.length > 0 ? expenseCategories : Array.from(exp).sort(),
    };
  }, [transactions, incomeCategories, expenseCategories]);

  const visibleCategories = useMemo(() => {
    if (typeFilter === 'income') return allCategoriesByType.income;
    if (typeFilter === 'expense') return allCategoriesByType.expense;
    return [...allCategoriesByType.income, ...allCategoriesByType.expense].sort();
  }, [typeFilter, allCategoriesByType]);

  const filtered = useMemo(() => {
    let txs = [...transactions].filter(t => t.Type !== 'draft');

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

    if (typeFilter !== 'all') txs = txs.filter(t => t.Type === typeFilter);
    if (selectedCategories.length > 0) txs = txs.filter(t => selectedCategories.includes(t.Category));

    if (search.trim()) {
      const q = search.toLowerCase();
      txs = txs.filter(t =>
        t.Note?.toLowerCase().includes(q) ||
        t.Category?.toLowerCase().includes(q) ||
        t.Editor_Name?.toLowerCase().includes(q) ||
        String(t.Amount_UZS ?? '').includes(q)
      );
    }

    txs.sort((a, b) => {
      if (sortBy === 'date') {
        const da = parseDate(a.Date)?.getTime() || 0;
        const db = parseDate(b.Date)?.getTime() || 0;
        return sortDir === 'desc' ? db - da : da - db;
      } else {
        const aa = parseFloat(String(a.Amount_UZS ?? 0));
        const bb = parseFloat(String(b.Amount_UZS ?? 0));
        return sortDir === 'desc' ? bb - aa : aa - bb;
      }
    });

    return txs;
  }, [transactions, search, selectedCategories, typeFilter, dateFrom, dateTo, singleDate, dateMode, sortBy, sortDir]);

  const summary = useMemo(() => {
    let income = 0, expense = 0, incomeUSD = 0, expenseUSD = 0;
    filtered.forEach(t => {
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      const usd = parseFloat(String(t.Amount_USD ?? 0)) || 0;
      if (t.Type === 'income') { income += uzs; incomeUSD += usd; }
      else { expense += uzs; expenseUSD += usd; }
    });
    return { income, expense, net: income - expense, incomeUSD, expenseUSD };
  }, [filtered]);

  // Category breakdown split by type
  const categoryBreakdown = useMemo(() => {
    const incMap: Record<string, number> = {};
    const expMap: Record<string, number> = {};
    filtered.forEach(t => {
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      if (t.Type === 'income') incMap[t.Category] = (incMap[t.Category] || 0) + uzs;
      else expMap[t.Category] = (expMap[t.Category] || 0) + uzs;
    });
    const incList = Object.entries(incMap).sort((a,b) => b[1]-a[1]);
    const expList = Object.entries(expMap).sort((a,b) => b[1]-a[1]);
    return { incList, expList };
  }, [filtered]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const clearFilters = () => {
    setSearch(''); setSelectedCategories([]); setTypeFilter('all');
    setDateFrom(''); setDateTo(''); setSingleDate('');
  };

  const hasFilters = search || selectedCategories.length > 0 || typeFilter !== 'all' || dateFrom || dateTo || singleDate;

  // Running balance for transaction detail modal
  const runningBalances = useMemo(() => {
    const sorted = [...transactions]
      .filter(t => t.Type !== 'draft')
      .sort((a, b) => {
        const da = parseDate(a.Date)?.getTime() || 0;
        const db = parseDate(b.Date)?.getTime() || 0;
        if (da !== db) return da - db;
        return (a.Timestamp || '').localeCompare(b.Timestamp || '');
      });
    let bal = 0;
    const map: Record<string, number> = {};
    sorted.forEach(t => {
      const uzs = parseFloat(String(t.Amount_UZS ?? 0)) || 0;
      bal += t.Type === 'income' ? uzs : -uzs;
      map[t.ID] = bal;
    });
    return map;
  }, [transactions]);

  return (
    <div className="space-y-5 pb-8">
      {/* Transaction detail modal */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setSelectedTx(null)}>
          <div className="bg-white rounded-t-3xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <div>
                <span className={`text-[10px] font-extrabold uppercase tracking-widest px-2 py-1 rounded-lg ${
                  selectedTx.Type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {selectedTx.Type === 'income' ? '▲ Доход' : '▼ Расход'}
                </span>
                <p className="text-[13px] font-extrabold text-gray-900 mt-2 uppercase tracking-wide">{selectedTx.Category}</p>
              </div>
              <button onClick={() => setSelectedTx(null)} className="text-gray-400 text-[20px] leading-none">×</button>
            </div>

            {/* Amount */}
            <div className={`rounded-2xl p-4 ${selectedTx.Type === 'income' ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className="text-[11px] text-gray-500 mb-1">Сумма</p>
              {selectedTx.Currency === 'USD' ? (
                <>
                  <p className="text-[28px] font-extrabold text-gray-900">
                    ${formatFull(parseFloat(String(selectedTx.Amount_USD ?? 0)))}
                  </p>
                  <p className="text-[12px] text-gray-500 mt-1">
                    = {formatFull(parseFloat(String(selectedTx.Amount_UZS ?? 0)))} сум
                    {selectedTx.USD_Rate ? ` (курс ${formatFull(parseFloat(String(selectedTx.USD_Rate)))})` : ''}
                  </p>
                </>
              ) : (
                <p className="text-[28px] font-extrabold text-gray-900">
                  {formatFull(parseFloat(String(selectedTx.Amount_UZS ?? 0)))} сум
                </p>
              )}
            </div>

            {/* Balance after */}
            {runningBalances[selectedTx.ID] !== undefined && (
              <div className="bg-gray-50 rounded-2xl p-4">
                <p className="text-[11px] text-gray-500 mb-1">Баланс после операции</p>
                <p className={`text-[22px] font-extrabold ${runningBalances[selectedTx.ID] >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                  {formatFull(runningBalances[selectedTx.ID])} сум
                </p>
              </div>
            )}

            {/* Details */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-[12px] text-gray-500">Дата</span>
                <span className="text-[12px] font-bold text-gray-900">{selectedTx.Date}</span>
              </div>
              {selectedTx.Note && (
                <div className="flex justify-between gap-4">
                  <span className="text-[12px] text-gray-500 flex-shrink-0">Комментарий</span>
                  <span className="text-[12px] font-bold text-gray-900 text-right">{selectedTx.Note}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[12px] text-gray-500">Редактор</span>
                <span className="text-[12px] font-bold text-gray-900">{selectedTx.Editor_Name}</span>
              </div>
              {selectedTx.Timestamp && (
                <div className="flex justify-between">
                  <span className="text-[12px] text-gray-500">Добавлено</span>
                  <span className="text-[12px] font-bold text-gray-900">{selectedTx.Timestamp}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[12px] text-gray-500">ID</span>
                <span className="text-[11px] font-mono text-gray-400">{selectedTx.ID}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-[24px] font-extrabold tracking-tight text-gray-900">Отчёты</h2>
        {hasFilters && (
          <button onClick={clearFilters} className="text-[11px] font-bold text-red-500 uppercase tracking-widest border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50">
            Сбросить
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl p-3 border border-gray-100">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Доход</p>
          <p className="text-[15px] font-extrabold text-green-600">{formatCompact(summary.income)}</p>
          {summary.incomeUSD > 0 && <p className="text-[9px] text-green-500">${formatCompact(summary.incomeUSD)}</p>}
          <p className="text-[9px] text-gray-400">{filtered.filter(t=>t.Type==='income').length} опер.</p>
        </div>
        <div className="bg-white rounded-2xl p-3 border border-gray-100">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Расход</p>
          <p className="text-[15px] font-extrabold text-red-600">{formatCompact(summary.expense)}</p>
          {summary.expenseUSD > 0 && <p className="text-[9px] text-red-400">${formatCompact(summary.expenseUSD)}</p>}
          <p className="text-[9px] text-gray-400">{filtered.filter(t=>t.Type==='expense').length} опер.</p>
        </div>
        <div className={`rounded-2xl p-3 border ${summary.net >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Итог</p>
          <p className={`text-[15px] font-extrabold ${summary.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {summary.net >= 0 ? '+' : ''}{formatCompact(summary.net)}
          </p>
          <p className="text-[9px] text-gray-400">{filtered.length} всего</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по заметке, категории..."
          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-gray-900" />

        <div className="flex gap-2">
          {(['all', 'income', 'expense'] as const).map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setSelectedCategories([]); }}
              className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-colors ${
                typeFilter === t ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-100 hover:bg-gray-50'
              }`}>
              {t === 'all' ? 'Все' : t === 'income' ? '▲ Доход' : '▼ Расход'}
            </button>
          ))}
        </div>

        {/* Date */}
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
            <input type="date" value={singleDate} onChange={e => setSingleDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-[12px] outline-none focus:ring-1 focus:ring-gray-900" />
          )}
        </div>

        {/* Category filter — separated by type */}
        {visibleCategories.length > 0 && (
          <div>
            {typeFilter === 'all' && (
              <>
                <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-2">Доходы</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {allCategoriesByType.income.map(cat => (
                    <button key={cat} onClick={() => toggleCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        selectedCategories.includes(cat) ? 'bg-green-700 text-white border-green-700' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}>{cat}</button>
                  ))}
                </div>
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">Расходы</p>
                <div className="flex flex-wrap gap-1.5">
                  {allCategoriesByType.expense.map(cat => (
                    <button key={cat} onClick={() => toggleCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        selectedCategories.includes(cat) ? 'bg-red-700 text-white border-red-700' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}>{cat}</button>
                  ))}
                </div>
              </>
            )}
            {typeFilter === 'income' && (
              <>
                <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-2">Категории доходов</p>
                <div className="flex flex-wrap gap-1.5">
                  {allCategoriesByType.income.map(cat => (
                    <button key={cat} onClick={() => toggleCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        selectedCategories.includes(cat) ? 'bg-green-700 text-white border-green-700' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}>{cat}</button>
                  ))}
                </div>
              </>
            )}
            {typeFilter === 'expense' && (
              <>
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">Категории расходов</p>
                <div className="flex flex-wrap gap-1.5">
                  {allCategoriesByType.expense.map(cat => (
                    <button key={cat} onClick={() => toggleCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        selectedCategories.includes(cat) ? 'bg-red-700 text-white border-red-700' : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}>{cat}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

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

      {/* Category breakdown */}
      {(categoryBreakdown.incList.length > 0 || categoryBreakdown.expList.length > 0) && typeFilter !== 'all' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-[13px] font-extrabold uppercase tracking-widest text-gray-900 mb-4">По категориям</h3>
          <div className="space-y-3">
            {(typeFilter === 'income' ? categoryBreakdown.incList : categoryBreakdown.expList).map(([cat, amt]) => (
              <div key={cat}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[12px] font-bold text-gray-700">{cat}</span>
                  <span className={`text-[12px] font-extrabold ${typeFilter === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCompact(amt)}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${typeFilter === 'income' ? 'bg-green-400' : 'bg-red-400'}`}
                    style={{ width: `${(amt / (typeFilter === 'income' ? categoryBreakdown.incList[0][1] : categoryBreakdown.expList[0][1])) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{formatFull(amt)} сум</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div>
        <h3 className="text-[13px] font-extrabold uppercase tracking-widest text-gray-900 mb-3">
          Операции ({filtered.length})
        </h3>

        {filtered.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-[13px] font-bold text-gray-400 uppercase tracking-widest">Ничего не найдено</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(tx => (
              <button key={tx.ID} onClick={() => setSelectedTx(tx as TxDetail)}
                className="w-full text-left bg-white p-4 rounded-2xl border border-gray-100 hover:border-gray-300 transition-colors active:scale-[0.99]">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tx.Type === 'income' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-[12px] font-bold text-gray-900 uppercase tracking-widest">{tx.Category}</span>
                  </div>
                  <span className={`text-[14px] font-extrabold ${tx.Type === 'income' ? 'text-green-600' : 'text-gray-900'}`}>
                    {tx.Type === 'income' ? '+' : '-'}
                    {tx.Currency === 'USD'
                      ? `$${formatFull(parseFloat(String(tx.Amount_USD ?? 0)))}`
                      : `${formatCompact(parseFloat(String(tx.Amount_UZS ?? 0)))} сум`}
                  </span>
                </div>
                {tx.Note && <p className="text-[12px] text-gray-500 mt-1.5 ml-4 truncate">{tx.Note}</p>}
                <div className="flex justify-between mt-2 ml-4">
                  <span className="text-[10px] text-gray-400">{tx.Editor_Name}</span>
                  <span className="text-[10px] font-bold text-gray-400">{tx.Date}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
