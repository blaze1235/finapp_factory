// Shared date + aggregation helpers. Single source of truth for all analytics
// math in the app; the backend mirror of this contract is /api/analytics/summary
// (structured JSON, built for the upcoming AI analysis integration).
import { Transaction } from '../types';

export function parseDate(str: string): Date | null {
  if (!str) return null;
  const [d, m, y] = str.split('.');
  if (!d || !m || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

export function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const months = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

export function uzs(t: Transaction): number {
  return parseFloat(String(t.Amount_UZS ?? 0)) || 0;
}

export function usd(t: Transaction): number {
  return parseFloat(String(t.Amount_USD ?? 0)) || 0;
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  subcategories: { name: string; total: number }[];
}

export interface PeriodSummary {
  income: number;
  expense: number;
  net: number;
  incomeUSD: number;
  expenseUSD: number;
  txCount: number;
  incomeCount: number;
  expenseCount: number;
  avgDailyIncome: number;
  avgDailyExpense: number;
  topIncome: CategoryTotal[];
  topExpense: CategoryTotal[];
}

/** Real (non-draft) transactions only. */
export function realTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter(t => t.Type === 'income' || t.Type === 'expense');
}

/** Months present in the data, newest first. */
export function availableMonths(txs: Transaction[]): string[] {
  const set = new Set<string>();
  txs.forEach(t => {
    const d = parseDate(t.Date);
    if (d) set.add(getMonthKey(d));
  });
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

/** Transactions for one month key, or all when key === 'all'. */
export function forMonth(txs: Transaction[], monthKey: string): Transaction[] {
  if (monthKey === 'all') return txs;
  return txs.filter(t => {
    const d = parseDate(t.Date);
    return d && getMonthKey(d) === monthKey;
  });
}

export function computeSummary(periodTxs: Transaction[], topN = 5): PeriodSummary {
  let income = 0, expense = 0, incomeUSD = 0, expenseUSD = 0;
  const incCats: Record<string, CategoryTotal> = {};
  const expCats: Record<string, CategoryTotal> = {};
  const days = new Set<string>();

  periodTxs.forEach(t => {
    const amount = uzs(t);
    const map = t.Type === 'income' ? incCats : expCats;
    const rec = map[t.Category] ||= { category: t.Category, total: 0, count: 0, subcategories: [] };
    rec.total += amount;
    rec.count += 1;
    const subName = t.Subcategory || '';
    if (subName) {
      const sub = rec.subcategories.find(s => s.name === subName);
      if (sub) sub.total += amount;
      else rec.subcategories.push({ name: subName, total: amount });
    }
    if (t.Type === 'income') { income += amount; incomeUSD += usd(t); }
    else { expense += amount; expenseUSD += usd(t); }
    if (t.Date) days.add(t.Date);
  });

  const rank = (m: Record<string, CategoryTotal>) =>
    Object.values(m)
      .sort((a, b) => b.total - a.total)
      .slice(0, topN)
      .map(c => ({ ...c, subcategories: [...c.subcategories].sort((a, b) => b.total - a.total) }));

  const dayCount = days.size || 1;
  return {
    income, expense, net: income - expense, incomeUSD, expenseUSD,
    txCount: periodTxs.length,
    incomeCount: periodTxs.filter(t => t.Type === 'income').length,
    expenseCount: periodTxs.filter(t => t.Type === 'expense').length,
    avgDailyIncome: income / dayCount,
    avgDailyExpense: expense / dayCount,
    topIncome: rank(incCats),
    topExpense: rank(expCats),
  };
}

export function pctChange(curr: number, prev: number): string {
  if (!prev) return '';
  const diff = ((curr - prev) / Math.abs(prev)) * 100;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%`;
}
