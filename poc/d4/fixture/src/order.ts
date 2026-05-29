/** Order orchestration — calls inventory.ts + pricing.ts (cross-file). */

import { checkStock, reserve } from "./inventory.js";
import { cartTotal, type Item } from "./pricing.js";

export interface OrderResult {
  ok: boolean;
  totals: string[];
}

export function placeOrder(cart: Item[]): OrderResult {
  for (const item of cart) {
    if (!checkStock(item.sku, item.qty)) {
      return { ok: false, totals: [] };
    }
  }
  for (const item of cart) {
    reserve(item.sku, item.qty);
  }
  return { ok: true, totals: cartTotal(cart) };
}
