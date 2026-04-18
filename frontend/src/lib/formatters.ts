export function formatCurrency(amount: string | number, currency: 'UZS' | 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return currency === 'USD' ? '$0' : '0 сум';
  if (currency === 'USD') {
    return `$${Math.round(num).toLocaleString('en-US')}`;
  }
  return `${Math.round(num).toLocaleString('ru-RU')} сум`;
}

// Smart compact: under 100K → full number | 100K+ → 123K | 1M+ → 1.2M | 1B+ → 1.2B
export function formatCompact(num: number): string {
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 100_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${Math.round(abs).toLocaleString('ru-RU')}`;
}

export function formatFull(num: number): string {
  return Math.round(num).toLocaleString('ru-RU');
}
