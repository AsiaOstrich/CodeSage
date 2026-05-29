import { describe, it, expect } from "vitest";
import { placeOrder } from "../src/order.js";
import { lineTotal, cartTotal } from "../src/pricing.js";
import { formatMoney, addTax } from "../src/money.js";
import { checkStock } from "../src/inventory.js";

describe("order fixture (baseline behaviour)", () => {
  it("formats money", () => {
    expect(formatMoney(1050)).toBe("$10.50");
  });

  it("adds tax", () => {
    expect(addTax(1000, 0.05)).toBe(1050);
  });

  it("computes a line total with tax", () => {
    expect(lineTotal({ sku: "sku-1", price: 1000, qty: 1 })).toBe("$10.50");
  });

  it("computes a cart total", () => {
    expect(cartTotal([{ sku: "sku-1", price: 1000, qty: 1 }])).toEqual(["$10.50"]);
  });

  it("checks stock", () => {
    expect(checkStock("sku-1", 5)).toBe(true);
    expect(checkStock("sku-2", 5)).toBe(false);
  });

  it("places an order when in stock", () => {
    const result = placeOrder([{ sku: "sku-1", price: 1000, qty: 1 }]);
    expect(result.ok).toBe(true);
    expect(result.totals).toEqual(["$10.50"]);
  });

  it("rejects an order when out of stock", () => {
    const result = placeOrder([{ sku: "sku-2", price: 1000, qty: 99 }]);
    expect(result.ok).toBe(false);
  });
});
