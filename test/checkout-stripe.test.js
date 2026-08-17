// The full purchase path, with Stripe stood in for.
//
// This is the one seam the rest of the suite cannot reach: what the shop
// actually asks Stripe to charge. If these figures can drift from the
// database, everything else is decoration.

import test from 'node:test';
import assert from 'node:assert/strict';

import { truncateAll } from './helpers/db.js';
import { getApp, agent, csrfFrom, request } from './helpers/app.js';

import products from '../models/products.js';
import orders from '../models/orders.js';
import { _setClientForTests } from '../lib/stripe.js';

const ADDRESS = {
  email: 'buyer@example.com',
  ship_name: 'A Buyer',
  ship_line1: '1 Harley Street',
  ship_city: 'London',
  ship_postcode: 'w1g 9qd',
};

/** Records what it was asked to charge, and charges nobody. */
function fakeStripe() {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        create: async (params) => {
          calls.push(params);
          return { id: `cs_test_${calls.length}`, url: 'https://checkout.stripe.test/session' };
        },
      },
    },
  };
}

async function sellable(fields) {
  return products.create({ is_published: true, is_placeholder: false, ...fields });
}

test('the full purchase path', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);
  t.after(() => _setClientForTests(null));

  await t.test('checkout creates a pending order and hands off to Stripe', async () => {
    const stripe = fakeStripe();
    _setClientForTests(stripe);

    const product = await sellable({ slug: 'buy-me', name: 'Buy Me', price_pence: 5400 });

    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 2, _csrf: token });

    const res = await client.post('/checkout').type('form').send({ ...ADDRESS, _csrf: token });

    assert.equal(res.status, 303);
    assert.equal(res.headers.location, 'https://checkout.stripe.test/session');

    const [order] = await orders.listAll({});
    assert.equal(order.status, 'pending', 'not paid — Stripe has not confirmed anything yet');
    assert.equal(order.subtotal_pence, 10800);
    assert.equal(order.shipping_pence, 0, 'over the free-delivery threshold');
    assert.equal(order.total_pence, 10800);
    assert.equal(order.email, 'buyer@example.com');
    assert.equal(order.ship_postcode, 'W1G 9QD', 'the postcode is normalised');
    assert.equal(order.stripe_session_id, 'cs_test_1');
  });

  await t.test('the amount sent to Stripe is the amount in the database', async () => {
    const stripe = fakeStripe();
    _setClientForTests(stripe);

    const product = await sellable({ slug: 'exact', name: 'Exact Item', price_pence: 2500 });

    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 1, _csrf: token });

    // Every figure an attacker might try to substitute.
    await client.post('/checkout').type('form').send({
      ...ADDRESS, _csrf: token,
      price_pence: 1, unit_price_pence: 1, total_pence: 1, amount: 1, qty: 99,
    });

    const [params] = stripe.calls;
    const [line, shipping] = params.line_items;

    assert.equal(line.price_data.unit_amount, 2500, 'the database price, not the posted one');
    assert.equal(line.price_data.product_data.name, 'Exact Item');
    assert.equal(line.quantity, 1, 'the basket quantity, not the posted one');
    assert.equal(line.price_data.currency, 'gbp');

    assert.equal(shipping.price_data.unit_amount, 495, 'delivery is charged below the threshold');

    const [order] = await orders.listAll({});
    const stripeTotal = params.line_items.reduce(
      (sum, item) => sum + item.price_data.unit_amount * item.quantity,
      0,
    );
    assert.equal(stripeTotal, order.total_pence, 'Stripe and the database agree exactly');
  });

  await t.test('the order id travels with the session so the webhook can find it', async () => {
    const stripe = fakeStripe();
    _setClientForTests(stripe);

    const product = await sellable({ slug: 'meta', name: 'Meta', price_pence: 1000 });
    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 1, _csrf: token });
    await client.post('/checkout').type('form').send({ ...ADDRESS, _csrf: token });

    const [order] = await orders.listAll({});
    const [params] = stripe.calls;

    assert.equal(params.metadata.order_id, String(order.id));
    assert.equal(params.client_reference_id, String(order.id));
    assert.equal(params.metadata.public_token, order.public_token);
    assert.match(params.success_url, new RegExp(order.public_token));
  });

  await t.test('the basket is emptied once the order exists', async () => {
    _setClientForTests(fakeStripe());

    const product = await sellable({ slug: 'empty-after', name: 'Empty After', price_pence: 1000 });
    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 1, _csrf: token });
    await client.post('/checkout').type('form').send({ ...ADDRESS, _csrf: token });

    assert.match((await client.get('/cart')).text, /Your basket is empty/);
  });

  await t.test('a guest can find their order again by its token', async () => {
    const app = await getApp();
    _setClientForTests(fakeStripe());

    const product = await sellable({ slug: 'guest-find', name: 'Guest Find', price_pence: 1000 });
    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 1, _csrf: token });
    await client.post('/checkout').type('form').send({ ...ADDRESS, _csrf: token });

    const [order] = await orders.listAll({});

    const res = await request(app).get(`/order/${order.public_token}`);
    assert.equal(res.status, 200, 'no account needed');
    assert.match(res.text, /Guest Find/);
  });

  await t.test('a signed-out visitor cannot pay for a placeholder by racing the flag', async () => {
    _setClientForTests(fakeStripe());

    const product = await sellable({ slug: 'race', name: 'Race', price_pence: 1000 });

    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 1, _csrf: token });

    // The operator flags it as a placeholder after it was added to the basket.
    await products.update(product.id, { is_placeholder: true });

    const res = await client.post('/checkout').type('form').send({ ...ADDRESS, _csrf: token });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/cart', 'sent back to review, not to payment');
    assert.equal((await orders.listAll({})).length, 0, 'no order was created');
  });

  await t.test('a webhook then marks that order paid, and only then', async () => {
    _setClientForTests(fakeStripe());

    const product = await sellable({ slug: 'end-to-end', name: 'End To End', price_pence: 1000 });
    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 1, _csrf: token });
    await client.post('/checkout').type('form').send({ ...ADDRESS, _csrf: token });

    const [order] = await orders.listAll({});
    assert.equal(order.status, 'pending');

    // Stand in for the verified webhook handler's effect.
    assert.equal(await orders.markPaid(order.id, { paymentIntent: 'pi_end_to_end' }), true);

    const app = await getApp();
    const res = await request(app).get(`/order/${order.public_token}`);
    assert.match(res.text, /payment has been received/i);
    assert.equal((await orders.getById(order.id)).status, 'paid');
  });
});
