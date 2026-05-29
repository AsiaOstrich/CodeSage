/** Money helpers (leaf functions; called by pricing.ts). */

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function addTax(cents: number, rate: number): number {
  return Math.round(cents * (1 + rate));
}
