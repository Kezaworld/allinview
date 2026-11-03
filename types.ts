export interface MoneyEntry {
  id: string;
  label: string;
  amount: number;
  paid?: boolean;
  recurring?: boolean;
}

export interface SavingsGoal {
  id: string;
  label: string;
  target: number;
  saved: number;
}

export interface Debt {
  id: string;
  label: string;
  balance: number;
  aprPercent: number;
  monthlyPayment: number;
  paid?: boolean;
}

export interface AppState {
  version: 1;
  income: MoneyEntry[];
  essentials: MoneyEntry[];
  savingsGoals: SavingsGoal[];
  emergencyFundTarget: number;
  emergencyFundSaved: number;
  debts: Debt[];
  premium: 'free' | 'monthly' | 'yearly';
  savedAt: string | null;
}

export const EXAMPLE_STATE: AppState = {
  version: 1,
  // Example numbers ONLY (the approved demo numbers) — a fresh install starts blank.
  income: [
    { id: 'inc-1', label: 'Paycheck', amount: 3200 },
    { id: 'inc-2', label: 'Extra income', amount: 450 },
  ],
  essentials: [
    { id: 'ess-1', label: 'Rent', amount: 1350 },
    { id: 'ess-2', label: 'Utilities', amount: 165 },
    { id: 'ess-3', label: 'Groceries', amount: 480 },
    { id: 'ess-4', label: 'Transport', amount: 140 },
    { id: 'ess-5', label: 'Phone', amount: 55 },
    { id: 'ess-6', label: 'Other essentials', amount: 120 },
  ],
  savingsGoals: [
    { id: 'sav-1', label: 'Holiday', target: 2400, saved: 600 },
    { id: 'sav-2', label: 'New car', target: 6000, saved: 1200 },
  ],
  emergencyFundTarget: 4800,
  emergencyFundSaved: 1200,
  debts: [{ id: 'debt-1', label: 'Credit card', balance: 7600, aprPercent: 24, monthlyPayment: 200 }],
  premium: 'free',
  savedAt: null,
};

export const BLANK_STATE: AppState = {
  version: 1,
  income: [],
  essentials: [],
  savingsGoals: [],
  emergencyFundTarget: 0,
  emergencyFundSaved: 0,
  debts: [],
  premium: 'free',
  savedAt: null,
};

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
