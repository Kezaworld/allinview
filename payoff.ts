import type { Debt } from './types';

/**
 * Payoff simulation, agreed rule: monthly debt payments ONLY.
 * Debts are paid smallest-first (snowball). Returns months to debt-free and the date.
 * A debt whose payment does not cover its monthly interest never pays off -> Infinity.
 */
export function monthsToDebtFree(debts: Debt[], fromDate = new Date()): number {
  const open = debts
    .filter((d) => !d.paid && d.balance > 0)
    .map((d) => ({ ...d }))
    .sort((a, b) => a.balance - b.balance);
  if (open.length === 0) return 0;
  const totalPayment = open.reduce((s, d) => s + d.monthlyPayment, 0);
  if (totalPayment <= 0) return Infinity;
  let months = 0;
  let guard = 0;
  while (open.some((d) => d.balance > 0) && guard < 1200) {
    guard += 1;
    months += 1;
    // Interest accrues, then the month's payments are applied smallest-first,
    // with freed payments rolling to the next smallest debt (snowball).
    let pool = totalPayment;
    for (const d of open) {
      if (d.balance <= 0) continue;
      d.balance += (d.balance * d.aprPercent) / 100 / 12;
    }
    for (const d of open) {
      if (pool <= 0) break;
      if (d.balance <= 0) continue;
      const pay = Math.min(pool, d.balance);
      d.balance -= pay;
      pool -= pay;
    }
    // If no progress was made in a month (payments < interest), it never pays off.
    if (open.every((d) => d.balance > 0) && months > 1) {
      // progress check is handled by the guard; a true stall keeps balances growing
    }
  }
  return guard >= 1200 ? Infinity : months;
}

export function debtFreeDate(months: number, fromDate = new Date()): string {
  if (!Number.isFinite(months)) return '—';
  if (months === 0) return 'Debt free';
  const d = new Date(fromDate.getFullYear(), fromDate.getMonth() + months, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
