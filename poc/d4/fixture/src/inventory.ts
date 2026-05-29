/** Inventory helpers (called by order.ts). */

const stock: Record<string, number> = { "sku-1": 10, "sku-2": 3 };

export function checkStock(sku: string, qty: number): boolean {
  return (stock[sku] ?? 0) >= qty;
}

export function reserve(sku: string, qty: number): void {
  stock[sku] = (stock[sku] ?? 0) - qty;
}
