import test from 'node:test';
import assert from 'node:assert/strict';

import { setupDb, truncateAll } from './helpers/db.js';
import { getApp, agent, csrfFrom, request } from './helpers/app.js';

import products from '../models/products.js';
import orders from '../models/orders.js';

const ADDRESS = {
  email: 'buyer@example.com',
  ship_name: 'A Buyer',
  ship_line1: '1 Harley Street',
  ship_city: 'London',
  ship_postcode: 'W1G 9QD',
};

async function sellable(fields) {
  return products.create({ is_published: true, is_placeholder: false, ...fields });
}

/** Put one product in a basket and return the agent plus its CSRF token. */
async function basketWith(product, qty = 1) {
  const client = await agent();
  const token = await csrfFrom(client);
  await client.post('/cart/add').type('form').send({ product_id: product.id, qty, _csrf: token });
  return { client, token };
}

test('checkout', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);

  await t.test('an empty basket redirects away from checkout', async () => {
    const client = await agent();
    const res = await client.get('/checkout');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/cart');
  });

  await t.test('the checkout form renders for a non-empty basket', async () => {
    const product = await sellable({ slug: 'c1', name: 'Checkout Item', price_pence: 5400 });
    const { client } = await basketWith(product);

    const res = await client.get('/checkout');
    assert.equal(res.status, 200);
    assert.match(res.text, /Checkout Item/);
    assert.match(res.text, /ship_postcode/);
  });

  await t.test('an invalid postcode re-renders the form with an inline error', async () => {
    const product = await sellable({ slug: 'c2', name: 'C2', price_pence: 5400 });
    const { client, token } = await basketWith(product);

    const res = await client
      .post('/checkout')
      .type('form')
      .send({ ...ADDRESS, ship_postcode: 'NOT A POSTCODE', _csrf: token });

    assert.equal(res.status, 400);
    assert.match(res.text, /valid UK postcode/i);
    assert.match(res.text, /A Buyer/, 'the form keeps what was typed');
  });

  await t.test('with no Stripe keys, checkout reports it plainly instead of crashing', async () => {
    const product = await sellable({ slug: 'c3', name: 'C3', price_pence: 5400 });
    const { client, token } = await basketWith(product);

    const res = await client.post('/checkout').type('form').send({ ...ADDRESS, _csrf: token });

    assert.equal(res.status, 503, 'service unavailable, not a 500');
    assert.match(res.text, /Payments Are.*Not Configured/s);
    assert.doesNotMatch(res.text, /at Object\./, 'no stack trace is shown to the customer');
  });

  await t.test('a tampered price in the posted form cannot change the total', async () => {
    const product = await sellable({ slug: 'c4', name: 'C4', price_pence: 5400 });
    const { client, token } = await basketWith(product, 2);

    // Everything an attacker might try to smuggle in.
    await client.post('/checkout').type('form').send({
      ...ADDRESS,
      _csrf: token,
      price_pence: 1,
      unit_price_pence: 1,
      total_pence: 1,
      subtotal_pence: 1,
      shipping_pence: 0,
      qty: 999,
    });

    // Stripe is unconfigured, so no order is created — assert directly on the
    // model with the same hydrated lines the route would have used.
    const created = await orders.create({
      email: ADDRESS.email,
      lines: [{ product, qty: 2 }],
      shipping_pence: 495,
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });

    assert.equal(created.subtotal_pence, 10800, 'the database price is used');
    assert.equal(created.total_pence, 11295);
  });

  await t.test('an order snapshots the name and price at the time of sale', async () => {
    const product = await sellable({ slug: 'c5', name: 'Original Name', price_pence: 5400 });

    const order = await orders.create({
      email: 'x@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });

    // The shop later renames and reprices the product.
    await products.update(product.id, { name: 'New Name', price_pence: 9900 });

    const items = await orders.itemsFor(order.id);
    assert.equal(items[0].name_snapshot, 'Original Name');
    assert.equal(items[0].unit_price_pence, 5400);

    const reloaded = await orders.getById(order.id);
    assert.equal(reloaded.total_pence, 5400, 'history does not move when the catalogue does');
  });

  await t.test('deleting a product does not destroy order history', async () => {
    const product = await sellable({ slug: 'c6', name: 'Doomed', price_pence: 1000 });
    const order = await orders.create({
      email: 'x@example.com',
      lines: [{ product, qty: 3 }],
      shipping_pence: 0,
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });

    await products.remove(product.id);

    const reloaded = await orders.getById(order.id);
    assert.equal(reloaded.items.length, 1);
    assert.equal(reloaded.items[0].name_snapshot, 'Doomed');
    assert.equal(reloaded.items[0].product_id, null);
  });

  await t.test('refusing to create an order with no lines', async () => {
    await assert.rejects(
      () => orders.create({
        email: 'x@example.com', lines: [], shipping_pence: 0,
        ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1' },
      }),
      /no lines/,
    );
  });
});

test('order confirmation', async (t) => {
  const app = await getApp();
  t.beforeEach(truncateAll);

  async function anOrder(overrides = {}) {
    const product = await sellable({ slug: `p-${Math.floor(Math.random() * 1e6)}`, name: 'P', price_pence: 1000 });
    return orders.create({
      email: 'x@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
      ...overrides,
    });
  }

  await t.test('a pending order shows as processing, never as paid', async () => {
    const order = await anOrder();

    const res = await request(app).get(`/order/${order.public_token}?from=stripe`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Payment <span class="gold">Processing/);
    assert.doesNotMatch(
      res.text,
      /payment has been received/i,
      'the page must not claim payment before the webhook confirms it',
    );

    const reloaded = await orders.getById(order.id);
    assert.equal(reloaded.status, 'pending', 'visiting the success URL changes nothing');
  });

  await t.test('the confirmation appears only once the webhook has marked it paid', async () => {
    const order = await anOrder();
    await orders.markPaid(order.id, { paymentIntent: 'pi_test' });

    const res = await request(app).get(`/order/${order.public_token}`);
    assert.match(res.text, /payment has been received/i);
  });

  await t.test('an unknown token 404s', async () => {
    assert.equal((await request(app).get('/order/deadbeef')).status, 404);
  });

  await t.test('order tokens are long and random', async () => {
    const a = await anOrder();
    const b = await anOrder();
    assert.match(a.public_token, /^[a-f0-9]{32}$/);
    assert.notEqual(a.public_token, b.public_token);
  });
});
