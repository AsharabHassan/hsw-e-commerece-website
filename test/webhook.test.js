// Webhook behaviour.
//
// The webhook is the only route that can move money, so it gets the most
// paranoid tests in the suite. Two things must hold absolutely:
//
//   1. An unsigned or wrongly-signed payload changes nothing.
//   2. A valid payload delivered twice applies once.

import test from 'node:test';
import assert from 'node:assert/strict';

import { setupDb, truncateAll } from './helpers/db.js';
import { getApp, request } from './helpers/app.js';

import products from '../models/products.js';
import orders from '../models/orders.js';

async function anOrder() {
  const product = await products.create({
    slug: `w-${Math.floor(Math.random() * 1e9)}`,
    name: 'Webhook Item',
    price_pence: 5400,
    is_published: true,
    is_placeholder: false,
  });

  return orders.create({
    email: 'buyer@example.com',
    lines: [{ product, qty: 1 }],
    shipping_pence: 495,
    ship: { name: 'A Buyer', line1: '1 Harley Street', city: 'London', postcode: 'W1G 9QD' },
  });
}

test('stripe webhook endpoint', async (t) => {
  const app = await getApp();
  t.beforeEach(truncateAll);

  await t.test('a request with no signature header is rejected', async () => {
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ type: 'checkout.session.completed' }));

    assert.equal(res.status, 400);
    assert.match(res.text, /signature/i);
  });

  await t.test('a forged signature is rejected', async () => {
    const order = await anOrder();

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1700000000,v1=deadbeefdeadbeefdeadbeefdeadbeef')
      .send(
        JSON.stringify({
          type: 'checkout.session.completed',
          data: { object: { payment_status: 'paid', metadata: { order_id: String(order.id) } } },
        }),
      );

    assert.equal(res.status, 400);

    const reloaded = await orders.getById(order.id);
    assert.equal(reloaded.status, 'pending', 'a forged webhook cannot mark an order paid');
    assert.equal(reloaded.paid_at, null);
  });

  await t.test('the webhook route is exempt from CSRF but not from signature checking', async () => {
    // No CSRF token is supplied. The request must fail on the SIGNATURE, which
    // is the stronger check, rather than being waved through or 403'd.
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=nope')
      .send('{}');

    assert.equal(res.status, 400);
    assert.doesNotMatch(res.text, /could not be verified/, 'not the CSRF failure page');
  });
});

test('marking an order paid', async (t) => {
  await setupDb();
  t.beforeEach(truncateAll);

  await t.test('the first call pays the order and records the payment intent', async () => {
    const order = await anOrder();

    assert.equal(await orders.markPaid(order.id, { paymentIntent: 'pi_abc' }), true);

    const reloaded = await orders.getById(order.id);
    assert.equal(reloaded.status, 'paid');
    assert.equal(reloaded.stripe_payment_intent, 'pi_abc');
    assert.ok(reloaded.paid_at, 'paid_at is stamped');
  });

  await t.test('a repeated delivery does not apply twice', async () => {
    const order = await anOrder();

    assert.equal(await orders.markPaid(order.id, { paymentIntent: 'pi_abc' }), true);
    assert.equal(await orders.markPaid(order.id, { paymentIntent: 'pi_abc' }), false);
    assert.equal(await orders.markPaid(order.id, { paymentIntent: 'pi_different' }), false);

    const reloaded = await orders.getById(order.id);
    assert.equal(reloaded.stripe_payment_intent, 'pi_abc', 'the first intent is not overwritten');
  });

  await t.test('a cancelled order cannot be resurrected by a late webhook', async () => {
    const order = await anOrder();
    await orders.setStatus(order.id, 'cancelled');

    assert.equal(await orders.markPaid(order.id), false);
    assert.equal((await orders.getById(order.id)).status, 'cancelled');
  });

  await t.test('an unknown status is refused', async () => {
    const order = await anOrder();
    await assert.rejects(() => orders.setStatus(order.id, 'definitely-paid'), /Unknown order status/);
  });

  await t.test('order stats count only real revenue', async () => {
    const paid = await anOrder();
    const pending = await anOrder();
    const cancelled = await anOrder();

    await orders.markPaid(paid.id);
    await orders.setStatus(cancelled.id, 'cancelled');

    const stats = await orders.stats();
    assert.equal(stats.paid, 1);
    assert.equal(stats.pending, 1);
    assert.equal(stats.total, 3);
    assert.equal(stats.revenue_pence, paid.total_pence, 'pending and cancelled orders earn nothing');
    assert.notEqual(pending.id, cancelled.id);
  });
});
