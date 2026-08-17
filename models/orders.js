// Orders and order lines.
//
// An order is a permanent record of what a customer was told they were buying
// and what they were charged. Product names and unit prices are SNAPSHOTTED
// onto order_items at creation: editing a product later must never rewrite
// history.

import { randomBytes } from 'node:crypto';

import { query, withTransaction } from '../db/index.js';

export const STATUSES = ['pending', 'paid', 'shipped', 'cancelled', 'refunded'];

function publicToken() {
  return randomBytes(16).toString('hex');
}

async function attachItems(orders) {
  if (orders.length === 0) return orders;

  const ids = orders.map((o) => o.id);
  const { rows: items } = await query(
    `select id, order_id, product_id, name_snapshot, slug_snapshot, unit_price_pence, qty
       from order_items
      where order_id = any($1::int[])
      order by id`,
    [ids],
  );

  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const item of items) byOrder.get(item.order_id)?.push(item);

  return orders.map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
}

async function one(sql, params) {
  const { rows } = await query(sql, params);
  if (rows.length === 0) return null;
  return (await attachItems(rows))[0];
}

const orders = {
  STATUSES,

  /**
   * Create an order from ALREADY-HYDRATED basket lines — that is, from prices
   * that came out of the database, never from the request body.
   *
   * @param {{
   *   email: string,
   *   user_id: number|null,
   *   lines: {product: {id: number, name: string, slug: string, price_pence: number}, qty: number}[],
   *   shipping_pence: number,
   *   ship: object
   * }} input
   */
  async create({
    email,
    user_id = null,
    lines,
    shipping_pence = 0,
    cod_fee_pence = 0,
    payment_method = 'card',
    ship,
  }) {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error('Refusing to create an order with no lines');
    }

    if (!['card', 'cod'].includes(payment_method)) {
      throw new Error(`Unknown payment method: ${payment_method}`);
    }

    // A card order never carries a cash-handling fee.
    const codFee = payment_method === 'cod' ? cod_fee_pence : 0;

    const subtotal = lines.reduce((total, l) => total + l.product.price_pence * l.qty, 0);
    const total = subtotal + shipping_pence + codFee;

    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `insert into orders (
           public_token, user_id, email, status,
           subtotal_pence, shipping_pence, cod_fee_pence, total_pence, payment_method,
           ship_name, ship_line1, ship_line2, ship_city, ship_postcode, ship_country, ship_phone
         ) values ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         returning *`,
        [
          publicToken(),
          user_id,
          String(email).trim().toLowerCase(),
          subtotal,
          shipping_pence,
          codFee,
          total,
          payment_method,
          ship.name,
          ship.line1,
          ship.line2 ?? null,
          ship.city,
          ship.postcode,
          ship.country ?? 'GB',
          ship.phone ?? null,
        ],
      );

      const order = rows[0];

      for (const line of lines) {
        await client.query(
          `insert into order_items
             (order_id, product_id, name_snapshot, slug_snapshot, unit_price_pence, qty)
           values ($1, $2, $3, $4, $5, $6)`,
          [order.id, line.product.id, line.product.name, line.product.slug, line.product.price_pence, line.qty],
        );
      }

      return order;
    });
  },

  getById(id) {
    return one('select * from orders where id = $1', [id]);
  },

  getByToken(token) {
    return one('select * from orders where public_token = $1', [token]);
  },

  getByStripeSession(sessionId) {
    return one('select * from orders where stripe_session_id = $1', [sessionId]);
  },

  async itemsFor(orderId) {
    const { rows } = await query('select * from order_items where order_id = $1 order by id', [orderId]);
    return rows;
  },

  async listForUser(userId) {
    const { rows } = await query('select * from orders where user_id = $1 order by created_at desc', [userId]);
    return attachItems(rows);
  },

  async listAll({ status = null, limit = 200 } = {}) {
    const params = [];
    let sql = 'select * from orders';
    if (status) {
      params.push(status);
      sql += ` where status = $${params.length}`;
    }
    params.push(limit);
    sql += ` order by created_at desc limit $${params.length}`;

    const { rows } = await query(sql, params);
    return attachItems(rows);
  },

  async attachStripeSession(orderId, sessionId) {
    await query('update orders set stripe_session_id = $2 where id = $1', [orderId, sessionId]);
  },

  /**
   * Mark an order paid. This is called ONLY from the verified Stripe webhook.
   *
   * The `status = 'pending'` guard in the WHERE clause makes the write
   * idempotent at the database level, so a webhook Stripe retries — or
   * delivers twice, which it is explicitly allowed to do — cannot apply twice.
   *
   * @returns {Promise<boolean>} true if this call was the one that paid it
   */
  async markPaid(orderId, { paymentIntent = null } = {}) {
    const { rows } = await query(
      `update orders
          set status = 'paid', paid_at = now(), stripe_payment_intent = coalesce($2, stripe_payment_intent)
        where id = $1 and status = 'pending'
        returning id`,
      [orderId, paymentIntent],
    );
    return rows.length > 0;
  },

  /**
   * Record that cash was collected on delivery.
   *
   * Deliberately separate from markPaid(). A card order's payment state is
   * owned by Stripe and nothing else may touch it — that is what stops this
   * shop's records and Stripe's from ever disagreeing. A COD order has no
   * Stripe involvement at all, so a human confirming the cash arrived is the
   * only possible source of truth.
   *
   * The payment_method guard is in the WHERE clause, so this cannot mark a
   * card order paid even if a route calls it by mistake.
   *
   * @returns {Promise<boolean>} true if this call was the one that paid it
   */
  async markCashCollected(orderId) {
    const { rows } = await query(
      `update orders
          set status = 'paid', paid_at = now()
        where id = $1 and status = 'pending' and payment_method = 'cod'
        returning id`,
      [orderId],
    );
    return rows.length > 0;
  },

  async setStatus(orderId, status) {
    if (!STATUSES.includes(status)) throw new Error(`Unknown order status: ${status}`);
    const { rows } = await query(
      'update orders set status = $2 where id = $1 returning *',
      [orderId, status],
    );
    return rows[0] ?? null;
  },

  /** Dashboard counters. */
  async stats() {
    const { rows } = await query(`
      select
        count(*) filter (where status = 'pending')::int  as pending,
        count(*) filter (where status = 'paid')::int     as paid,
        count(*) filter (where status = 'shipped')::int  as shipped,
        count(*)::int                                    as total,
        coalesce(sum(total_pence) filter (where status in ('paid','shipped')), 0)::int as revenue_pence
      from orders
    `);
    return rows[0];
  },
};

export default orders;
