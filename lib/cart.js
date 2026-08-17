// The basket.
//
// The session holds product ids and quantities and NOTHING ELSE. No names, no
// prices, no totals. Every figure the customer sees, and every figure that
// reaches an order, is recomputed here from the database.
//
// This is the single most important security property of the shop: a customer
// who edits their session, their cookies or the form cannot change what they
// are charged, because the price they submit is never read.

import config from '../config.js';
import products from '../models/products.js';

export const MAX_QTY = 99;

function lines(session) {
  if (!session) return [];
  if (!Array.isArray(session.cart)) session.cart = [];
  return session.cart;
}

function clampQty(qty) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(n, MAX_QTY);
}

const cart = {
  MAX_QTY,

  /** @returns {{product_id: number, qty: number}[]} */
  read(session) {
    return lines(session).map(({ product_id, qty }) => ({ product_id, qty }));
  },

  /** Total item count, for the basket badge. Synchronous — no database hit. */
  count(session) {
    return lines(session).reduce((total, line) => total + line.qty, 0);
  },

  add(session, productId, qty = 1) {
    const id = Number(productId);
    const amount = clampQty(qty);
    if (!Number.isInteger(id) || amount === 0) return;

    const existing = lines(session).find((line) => line.product_id === id);
    if (existing) {
      existing.qty = clampQty(existing.qty + amount) || MAX_QTY;
    } else {
      session.cart.push({ product_id: id, qty: amount });
    }
  },

  /** Setting a quantity of zero removes the line. */
  update(session, productId, qty) {
    const id = Number(productId);
    const amount = clampQty(qty);
    if (amount === 0) return this.remove(session, id);

    const existing = lines(session).find((line) => line.product_id === id);
    if (existing) existing.qty = amount;
  },

  remove(session, productId) {
    const id = Number(productId);
    session.cart = lines(session).filter((line) => line.product_id !== id);
  },

  clear(session) {
    if (session) session.cart = [];
  },

  /**
   * Turn the session's ids into a priced basket, reading everything from the
   * database. Lines whose product has been unpublished, deleted, or is still
   * flagged as a placeholder are dropped — a customer must never be able to
   * buy something that is not for sale.
   *
   * @returns {Promise<{
   *   lines: {product: object, qty: number, line_pence: number}[],
   *   removed: number,
   *   subtotal_pence: number,
   *   shipping_pence: number,
   *   total_pence: number,
   *   count: number,
   *   free_shipping_remaining_pence: number
   * }>}
   */
  async hydrate(session) {
    const raw = lines(session);
    const priced = await products.priceMap(raw.map((line) => line.product_id));

    const kept = [];
    let removed = 0;

    for (const line of raw) {
      const product = priced.get(line.product_id);
      if (!product || !product.is_published || product.is_placeholder) {
        removed += 1;
        continue;
      }
      kept.push({
        product,
        qty: line.qty,
        line_pence: product.price_pence * line.qty,
      });
    }

    // Prune anything that has gone away so it is not re-checked every request.
    if (removed > 0) {
      session.cart = kept.map(({ product, qty }) => ({ product_id: product.id, qty }));
    }

    const subtotal = kept.reduce((total, line) => total + line.line_pence, 0);
    const shipping =
      kept.length === 0 || subtotal >= config.freeShippingOverPence ? 0 : config.shippingPence;

    return {
      lines: kept,
      removed,
      subtotal_pence: subtotal,
      shipping_pence: shipping,
      total_pence: subtotal + shipping,
      count: kept.reduce((total, line) => total + line.qty, 0),
      free_shipping_remaining_pence: Math.max(0, config.freeShippingOverPence - subtotal),
    };
  },
};

export default cart;
