export function formatCurrency(value: string | number, type: 'UZS' | 'USD'): string {
  const num = Number(value);
  if (isNaN(num)) return typeof value === 'string' ? value : '0';

  if (type === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(num);
  } else {
    return new Intl.NumberFormat('ru-RU', {
      style: 'decimal',
      minimumFractionDigits: 0,
    }).format(num).replace(/,/g, ' ') + ' сум';
  }
}
