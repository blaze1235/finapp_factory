export type TransactionType = 'income' | 'expense' | 'draft';
export type Currency = 'UZS' | 'USD';

export interface Transaction {
  ID: string;
  Timestamp: string;
  Date: string;
  Type: TransactionType;
  Category: string;
  Amount_UZS: string | number;
  Amount_USD: string | number;
  USD_Rate: string | number;
  Note: string;
  Editor_ID: string;
  Editor_Name: string;
  Currency: Currency;
  rowIndex?: number;
}

export type Role = 'editor' | 'director' | 'finance_director';

export interface Account {
  TG_ID: string;
  Username: string;
  Full_Name: string;
  Role: Role;
  Active: string; // 'TRUE' | 'FALSE'
}

export interface Category {
  Type: 'income' | 'expense';
  Category: string;
}
