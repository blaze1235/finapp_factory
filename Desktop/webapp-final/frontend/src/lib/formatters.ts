export function formatCurrency(amount: string | number, currency: 'UZS' | 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return currency === 'USD' ? '$0' : '0 сум';
  if (currency === 'USD') {
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(num).toLocaleString('ru-RU')} сум`;
}
