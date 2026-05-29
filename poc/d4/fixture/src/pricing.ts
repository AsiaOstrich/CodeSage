/** Pricing — calls money.ts (cross-file), called by order.ts. */

import { addTax, formatMoney } from "./money.js";

export interface Item {
  sku: string;
  price: number;
  qty: number;
}

export function lineTotal(item: Item): string {
  const subtotal = item.price * item.qty;
  return formatMoney(addTax(subtotal, 0.05));
}

export function cartTotal(items: Item[]): string[] {
  return items.map((item) => lineTotal(item));
}
