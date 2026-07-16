import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Transaction, EditLogEntry } from '../types';
import { useAppContext } from '../contexts/AppContext';
import { api } from '../lib/api';
import { formatFull } from '../lib/formatters';

function toInputDate(str: string): string {
  if (!str) return '';
  const [d, m, y] = str.split('.');
  if (!d || !m || !y) return '';
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function fromInputDate(str: string): string {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}.${m}.${y}`;
}

interface Props {
  tx: Transaction | null;
  onClose: () => void;
  runningBalance?: number;
}

export function TxDrawer({ tx, onClose, runningBalance }: Props) {
  const { currentUser, categories, editTransaction, deleteTransaction } = useAppContext();
  const canEdit = currentUser?.Role === 'editor' || currentUser?.Role === 'finance_director';

  // ── Drag-to-dismiss (handle area only, so content scroll never conflicts) ──
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);

  const onDragStart = (clientY: number) => {
    startYRef.current = clientY;
    setDragging(true);
  };
  const onDragMove = useCallback((clientY: number) => {
    setDragY(Math.max(0, clientY - startYRef.current));
  }, []);
  const onDragEnd = useCallback(() => {
    setDragging(false);
    setDragY(y => {
      if (y > 120) { onClose(); return 0; }
      return 0;
    });
  }, [onClose]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => onDragMove(e.clientY);
    const up = () => onDragEnd();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, onDragMove, onDragEnd]);

  // ── Edit state ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'view' | 'edit' | 'reason'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<EditLogEntry[]>([]);

  const [fType, setFType] = useState<'income' | 'expense'>('expense');
  const [fCategory, setFCategory] = useState('');
  const [fSubcategory, setFSubcategory] = useState('');
  const [fDate, setFDate] = useState('');
  const [fAmount, setFAmount] = useState('');
  const [fRate, setFRate] = useState('');
  const [fNote, setFNote] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!tx) return;
    setMode('view');
    setError('');
    setReason('');
    setDragY(0);
    setFType(tx.Type === 'income' ? 'income' : 'expense');
    setFCategory(tx.Category || '');
    setFSubcategory(tx.Subcategory || '');
    setFDate(toInputDate(tx.Date));
    setFAmount(tx.Currency === 'USD' ? `$${tx.Amount_USD}` : String(tx.Amount_UZS ?? ''));
    setFRate(String(tx.USD_Rate || ''));
    setFNote(tx.Note || '');
    setHistory([]);
    api.getTransactionHistory(tx.ID).then(setHistory).catch(() => setHistory([]));
  }, [tx?.ID]);

  if (!tx) return null;

  const typeCategories = categories.filter(c => c.Type === fType);
  const currentCat = typeCategories.find(c => c.Category === fCategory);
  const subOptions = currentCat?.Subcategories || [];

  const isUSD = fAmount.trim().startsWith('$');

  const buildFields = (): Partial<Transaction> => {
    const raw = parseFloat(fAmount.replace(/[^0-9.]/g, '')) || 0;
    const rate = parseFloat(fRate) || 0;
    return {
      Type: fType,
      Category: fCategory,
      Subcategory: fSubcategory,
      Date: fromInputDate(fDate),
      Amount_UZS: isUSD ? (rate ? raw * rate : 0) : raw,
      Amount_USD: isUSD ? raw : 0,
      USD_Rate: isUSD ? rate : 0,
      Note: fNote,
      Currency: isUSD ? 'USD' : 'UZS',
    };
  };

  const submitEdit = async () => {
    if (reason.trim().length < 3) { setError('Причина обязательна (минимум 3 символа)'); return; }
    setBusy(true);
    setError('');
    try {
      await editTransaction(tx.ID, buildFields(), { reason: reason.trim() });
      onClose();
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Удалить эту операцию безвозвратно?')) return;
    setBusy(true);
    try {
      await deleteTransaction(tx.ID);
      onClose();
    } catch {
      setError('Ошибка удаления');
      setBusy(false);
    }
  };

  const chip = (active: boolean, color: 'green' | 'red') =>
    active
      ? color === 'green'
        ? 'bg-green-100 text-green-700 border-green-200'
        : 'bg-red-100 text-red-700 border-red-200'
      : 'bg-white text-gray-700 border-gray-100';

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-w-md flex flex-col"
        style={{
          maxHeight: '92dvh',
          transform: `translateY(${dragY}px)`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div
          className="pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none select-none flex-shrink-0"
          onTouchStart={e => onDragStart(e.touches[0].clientY)}
          onTouchMove={e => onDragMove(e.touches[0].clientY)}
          onTouchEnd={onDragEnd}
          onMouseDown={e => { e.preventDefault(); onDragStart(e.clientY); }}
        >
          <div className="w-10 h-1.5 bg-gray-300 rounded-full mx-auto" />
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto overscroll-contain px-6 pb-8 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <span className={`text-[10px] font-extrabold uppercase tracking-widest px-2 py-1 rounded-lg ${
                tx.Type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {tx.Type === 'income' ? '▲ Доход' : '▼ Расход'}
              </span>
              <p className="text-[13px] font-extrabold text-gray-900 mt-2 uppercase tracking-wide">
                {tx.Category}
                {tx.Subcategory ? <span className="text-gray-400 font-bold"> · {tx.Subcategory}</span> : null}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 text-[22px] leading-none px-2 py-1">×</button>
          </div>

          {mode === 'view' && (
            <>
              <div className={`rounded-2xl p-4 ${tx.Type === 'income' ? 'bg-green-50' : 'bg-red-50'}`}>
                <p className="text-[11px] text-gray-500 mb-1">Сумма</p>
                {tx.Currency === 'USD' ? (
                  <>
                    <p className="text-[28px] font-extrabold text-gray-900">
                      ${formatFull(parseFloat(String(tx.Amount_USD ?? 0)))}
                    </p>
                    <p className="text-[12px] text-gray-500 mt-1">
                      = {formatFull(parseFloat(String(tx.Amount_UZS ?? 0)))} сум
                      {tx.USD_Rate ? ` (курс ${formatFull(parseFloat(String(tx.USD_Rate)))})` : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-[28px] font-extrabold text-gray-900">
                    {formatFull(parseFloat(String(tx.Amount_UZS ?? 0)))} сум
                  </p>
                )}
              </div>

              {runningBalance !== undefined && (
                <div className="bg-gray-50 rounded-2xl p-4">
                  <p className="text-[11px] text-gray-500 mb-1">Баланс после операции</p>
                  <p className={`text-[22px] font-extrabold ${runningBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                    {formatFull(runningBalance)} сум
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-[12px] text-gray-500">Дата</span>
                  <span className="text-[12px] font-bold text-gray-900">{tx.Date}</span>
                </div>
                {tx.Subcategory && (
                  <div className="flex justify-between">
                    <span className="text-[12px] text-gray-500">Подкатегория</span>
                    <span className="text-[12px] font-bold text-gray-900">{tx.Subcategory}</span>
                  </div>
                )}
                {tx.Note && (
                  <div className="flex justify-between gap-4">
                    <span className="text-[12px] text-gray-500 flex-shrink-0">Комментарий</span>
                    <span className="text-[12px] font-bold text-gray-900 text-right">{tx.Note}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[12px] text-gray-500">Редактор</span>
                  <span className="text-[12px] font-bold text-gray-900">{tx.Editor_Name}</span>
                </div>
                {tx.Timestamp && (
                  <div className="flex justify-between">
                    <span className="text-[12px] text-gray-500">Добавлено</span>
                    <span className="text-[12px] font-bold text-gray-900">{tx.Timestamp}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[12px] text-gray-500">ID</span>
                  <span className="text-[11px] font-mono text-gray-400">{tx.ID}</span>
                </div>
              </div>

              {history.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
                  <p className="text-[11px] font-extrabold text-amber-700 uppercase tracking-widest">
                    История изменений ({history.length})
                  </p>
                  {history.map((h, i) => (
                    <div key={i} className="border-t border-amber-100 pt-2 first:border-0 first:pt-0">
                      <div className="flex justify-between">
                        <span className="text-[11px] font-bold text-gray-900">{h.Editor_Name || h.Editor_ID}</span>
                        <span className="text-[10px] text-gray-400">{h.Timestamp}</span>
                      </div>
                      <p className="text-[11px] text-gray-700 mt-0.5">Причина: {h.Reason}</p>
                      {h.Changes && <p className="text-[10px] text-gray-500 mt-0.5 break-words">{h.Changes}</p>}
                    </div>
                  ))}
                </div>
              )}

              {canEdit && (
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setMode('edit')}
                    className="flex-[2] py-3.5 rounded-xl font-bold bg-gray-900 text-white uppercase tracking-wide text-[11px]">
                    ✏️ Редактировать
                  </button>
                  <button onClick={handleDelete} disabled={busy}
                    className="flex-1 py-3.5 rounded-xl font-bold bg-red-50 text-red-600 border border-red-100 uppercase tracking-wide text-[11px] disabled:opacity-50">
                    Удалить
                  </button>
                </div>
              )}
            </>
          )}

          {mode === 'edit' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button type="button" onClick={() => { setFType('expense'); setFCategory(''); setFSubcategory(''); }}
                  className={`flex-1 py-3 text-[13px] font-bold rounded-xl border ${fType === 'expense' ? 'bg-red-600 text-white border-red-600' : 'bg-gray-50 text-gray-900 border-gray-100'}`}>
                  Расход
                </button>
                <button type="button" onClick={() => { setFType('income'); setFCategory(''); setFSubcategory(''); }}
                  className={`flex-1 py-3 text-[13px] font-bold rounded-xl border ${fType === 'income' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-50 text-gray-900 border-gray-100'}`}>
                  Приход
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Категория</label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                  {typeCategories.map(c => (
                    <button key={c.Category} type="button"
                      onClick={() => { setFCategory(c.Category); setFSubcategory(''); }}
                      className={`py-2.5 px-3 text-xs font-bold rounded-xl text-left truncate border ${chip(fCategory === c.Category, fType === 'income' ? 'green' : 'red')}`}>
                      {c.Category}
                    </button>
                  ))}
                </div>
              </div>

              {subOptions.length > 0 && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Подкатегория</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setFSubcategory('')}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${!fSubcategory ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200'}`}>
                      Без
                    </button>
                    {subOptions.map(s => (
                      <button key={s} type="button" onClick={() => setFSubcategory(s)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${fSubcategory === s ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-600 border-gray-200'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Сумма ($ для USD)</label>
                <input type="text" value={fAmount} onChange={e => setFAmount(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-extrabold text-[16px] outline-none focus:ring-1 focus:ring-gray-900" />
              </div>

              {isUSD && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Курс USD</label>
                  <input type="number" value={fRate} onChange={e => setFRate(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold outline-none focus:ring-1 focus:ring-gray-900" />
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Дата</label>
                <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold outline-none focus:ring-1 focus:ring-gray-900" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Примечание</label>
                <textarea value={fNote} onChange={e => setFNote(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold outline-none focus:ring-1 focus:ring-gray-900 resize-none h-20" />
              </div>

              {error && <p className="text-[12px] font-bold text-red-600">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setMode('view'); setError(''); }}
                  className="flex-1 py-3.5 rounded-xl font-bold bg-gray-100 text-gray-900 uppercase tracking-wide text-[11px]">
                  Отмена
                </button>
                <button type="button" disabled={!fCategory || !fAmount || busy}
                  onClick={() => { setMode('reason'); setError(''); }}
                  className="flex-[2] py-3.5 rounded-xl font-bold bg-gray-900 text-white uppercase tracking-wide text-[11px] disabled:opacity-50">
                  Далее →
                </button>
              </div>
            </div>
          )}

          {mode === 'reason' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                <p className="text-[12px] font-extrabold text-amber-800 uppercase tracking-widest mb-1">
                  Почему вы вносите изменение?
                </p>
                <p className="text-[11px] text-amber-700">
                  Причина обязательна и сохраняется в журнале изменений.
                </p>
              </div>
              <textarea value={reason} onChange={e => setReason(e.target.value)} autoFocus
                placeholder="Например: ошибка в сумме, неверная категория..."
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold text-[13px] outline-none focus:ring-1 focus:ring-gray-900 resize-none h-24" />
              {error && <p className="text-[12px] font-bold text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setMode('edit'); setError(''); }}
                  className="flex-1 py-3.5 rounded-xl font-bold bg-gray-100 text-gray-900 uppercase tracking-wide text-[11px]">
                  ← Назад
                </button>
                <button type="button" onClick={submitEdit} disabled={busy || reason.trim().length < 3}
                  className="flex-[2] py-3.5 rounded-xl font-bold bg-gray-900 text-white uppercase tracking-wide text-[11px] disabled:opacity-50">
                  {busy ? 'Сохранение...' : 'Применить изменение'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
