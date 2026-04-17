import { useState } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { formatCurrency } from '../lib/formatters';

export function Balance() {
  const { transactions } = useAppContext();

  // Balance calculation (ignoring drafts)
  const realTransactions = transactions.filter(t => t.Type !== 'draft');

  let totalUzsIncome = 0;
  let totalUzsExpense = 0;
  let totalUsdIncome = 0;
  let totalUsdExpense = 0;

  realTransactions.forEach(tx => {
    if (tx.Currency === 'UZS') {
      if (tx.Type === 'income') totalUzsIncome += Number(tx.Amount_UZS);
      if (tx.Type === 'expense') totalUzsExpense += Number(tx.Amount_UZS);
    } else {
      if (tx.Type === 'income') totalUsdIncome += Number(tx.Amount_USD);
      if (tx.Type === 'expense') totalUsdExpense += Number(tx.Amount_USD);
    }
  });

  const uzsSafe = totalUzsIncome - totalUzsExpense;
  const usdSafe = totalUsdIncome - totalUsdExpense;

  // For total UZS we need to estimate if USD has UZS equivelant, 
  // but "Total UZS balance = SUM(income Amount_UZS) - SUM(expense Amount_UZS)" per spec,
  // the UZS Safe might track physical UZS. We will show them separate.

  return (
    <div className="space-y-6 max-w-lg mt-4">
      <div className="mb-8 p-6 bg-white border border-gray-100 rounded-2xl">
        <div className="flex flex-col mb-10">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
            Общий Баланс / Umumiy Balans
          </span>
          <div className="text-[32px] sm:text-[40px] font-extrabold leading-none tracking-[-1px] text-gray-900">
            {formatCurrency(String(uzsSafe), 'UZS')}
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
            В Сейфе (USD) / Safe (USD)
          </span>
          <div className="text-[32px] sm:text-[40px] font-extrabold leading-none tracking-[-1px] text-gray-900 mb-1">
            {formatCurrency(String(usdSafe), 'USD')}
          </div>
          <div className="text-[16px] text-gray-500 font-medium mt-1">
            ≈ {formatCurrency(String(usdSafe * 12700), 'UZS')} {/* Fixed placeholder estimate or handled differently later */}
          </div>
        </div>
      </div>
{/* Additional buttons like in your layout can be placed here if requested */}
    </div>
  );
}
