// Cash on delivery.
//
// The property that matters: a cash order and a card order must never be able
// to become each other. A card order's payment state belongs to Stripe; a cash
// order's belongs to whoever collected the money. Neither may reach across.

import test from 'node:test';
import assert from 'node:assert/strict';

import { setupDb, truncateAll } from './helpers/db.js';
import { getApp, agent, csrfFrom, signIn, request } from './helpers/app.js';

import products from '../models/products.js';
import orders from '../models/orders.js';
import users from '../models/users.js';
import config from '../config.js';

const PASSWORD = 'a-long-enough-password';

const ADDRESS = {
  email: 'cash@example.com',
  ship_name: 'Cash Buyer',
  ship_line1: '1 Harley Street',
  ship_city: 'London',
  ship_postcode: 'W1G 9QD',
};

async function sellable(slug, pence = 5400) {
  return products.create({
    slug, name: `Item ${slug}`, price_pence: pence,
    is_published: true, is_placeholder: false,
  });
}

async function basketWith(product, qty = 1) {
  const client = await agent();
  const token = await csrfFrom(client);
  await client.post('/cart/add').type('form').send({ product_id: product.id, qty, _csrf: token });
  return { client, token };
}

test('cash on delivery — placing an order', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);

  await t.test('the checkout offers a cash option with the fee stated', async () => {
    const product = await sellable('cod-form');
    const { client } = await basketWith(product);

    const res = await client.get('/checkout');
    assert.match(res.text, /value="cod"/);
    assert.match(res.text, /Cash on delivery/i);
    assert.match(res.text, /£4\.25 handling fee/i, 'the fee is disclosed before the customer chooses');
  });

  await t.test('a cash order is created and skips Stripe entirely', async () => {
    const product = await sellable('cod-order', 5400);
    const { client, token } = await basketWith(product);

    const res = await client
      .post('/checkout')
      .type('form')
      .send({ ...ADDRESS, payment_method: 'cod', _csrf: token });

    assert.equal(res.status, 303);
    assert.match(res.headers.location, /^\/order\/[a-f0-9]{32}$/, 'straight to the confirmation, no Stripe');

    const [order] = await orders.listAll({});
    assert.equal(order.payment_method, 'cod');
    assert.equal(order.status, 'pending');
    assert.equal(order.stripe_session_id, null);
    assert.equal(order.subtotal_pence, 5400);
    assert.equal(order.cod_fee_pence, 425);
    // £54.00 is under the £75.00 free-delivery threshold, so all three apply.
    assert.equal(order.shipping_pence, 495);
    assert.equal(order.total_pence, 5400 + 495 + 425);
  });

  await t.test('the fee is added on top of delivery when both apply', async () => {
    const product = await sellable('cod-cheap', 1000);
    const { client, token } = await basketWith(product);

    await client.post('/checkout').type('form').send({ ...ADDRESS, payment_method: 'cod', _csrf: token });

    const [order] = await orders.listAll({});
    assert.equal(order.subtotal_pence, 1000);
    assert.equal(order.shipping_pence, 495);
    assert.equal(order.cod_fee_pence, 425);
    assert.equal(order.total_pence, 1920);
  });

  await t.test('cash checkout works with no Stripe keys configured', async () => {
    // The whole point: the shop can trade before Stripe exists.
    assert.equal(config.stripe.configured, false, 'this suite runs without Stripe keys');

    const product = await sellable('cod-nostripe');
    const { client, token } = await basketWith(product);

    const res = await client.post('/checkout').type('form').send({ ...ADDRESS, payment_method: 'cod', _csrf: token });
    assert.equal(res.status, 303);
    assert.equal((await orders.listAll({})).length, 1);
  });

  await t.test('a card order still carries no cash fee', async () => {
    const product = await sellable('card-order');
    const order = await orders.create({
      email: 'x@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      payment_method: 'card',
      cod_fee_pence: 425, // ignored
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });

    assert.equal(order.cod_fee_pence, 0, 'a card order cannot acquire a cash-handling fee');
    assert.equal(order.total_pence, 5400);
  });

  await t.test('an unknown payment method is refused', async () => {
    const product = await sellable('bad-method');
    await assert.rejects(
      () => orders.create({
        email: 'x@example.com', lines: [{ product, qty: 1 }], shipping_pence: 0,
        payment_method: 'bitcoin',
        ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
      }),
      /Unknown payment method/,
    );
  });

  await t.test('the basket is emptied after a cash order', async () => {
    const product = await sellable('cod-empties');
    const { client, token } = await basketWith(product);
    await client.post('/checkout').type('form').send({ ...ADDRESS, payment_method: 'cod', _csrf: token });
    assert.match((await client.get('/cart')).text, /Your basket is empty/);
  });

  await t.test('the confirmation tells the customer what to hand over', async () => {
    const product = await sellable('cod-confirm', 5400);
    const { client, token } = await basketWith(product);
    await client.post('/checkout').type('form').send({ ...ADDRESS, payment_method: 'cod', _csrf: token });

    const [order] = await orders.listAll({});
    const res = await request(await getApp()).get(`/order/${order.public_token}`);

    assert.match(res.text, /Pay On <span class="gold">Delivery/);
    // £54.00 + £4.95 delivery + £4.25 cash handling
    assert.match(res.text, /£63\.20/, 'the exact cash amount is shown');
    assert.match(res.text, /exact amount/i);
    assert.doesNotMatch(res.text, /payment has been received/i, 'nothing claims the money arrived');
  });
});

test('cash on delivery — collecting the money', async (t) => {
  await setupDb();
  t.beforeEach(truncateAll);

  async function codOrder() {
    const product = await sellable(`c-${Math.floor(Math.random() * 1e9)}`);
    return orders.create({
      email: 'cash@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      payment_method: 'cod',
      cod_fee_pence: 425,
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });
  }

  async function cardOrder() {
    const product = await sellable(`d-${Math.floor(Math.random() * 1e9)}`);
    return orders.create({
      email: 'card@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      payment_method: 'card',
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });
  }

  await t.test('marking cash collected pays the order, once', async () => {
    const order = await codOrder();

    assert.equal(await orders.markCashCollected(order.id), true);
    assert.equal(await orders.markCashCollected(order.id), false, 'not twice');

    const reloaded = await orders.getById(order.id);
    assert.equal(reloaded.status, 'paid');
    assert.ok(reloaded.paid_at);
  });

  await t.test('markCashCollected cannot touch a card order', async () => {
    const order = await cardOrder();
    assert.equal(await orders.markCashCollected(order.id), false);
    assert.equal((await orders.getById(order.id)).status, 'pending');
  });

  await t.test('markPaid still works only for the Stripe path', async () => {
    const card = await cardOrder();
    assert.equal(await orders.markPaid(card.id, { paymentIntent: 'pi_x' }), true);
    assert.equal((await orders.getById(card.id)).status, 'paid');
  });
});

test('cash on delivery — admin', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);

  async function adminClient() {
    await users.create({ email: 'admin@example.com', password: PASSWORD, name: 'Admin', is_admin: true });
    const client = await agent();
    await signIn(client, 'admin@example.com', PASSWORD);
    return client;
  }

  async function makeOrder(method) {
    const product = await sellable(`a-${Math.floor(Math.random() * 1e9)}`);
    return orders.create({
      email: 'x@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      payment_method: method,
      cod_fee_pence: method === 'cod' ? 425 : 0,
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });
  }

  await t.test('a cash order shows the collect button; a card order does not', async () => {
    const cash = await makeOrder('cod');
    const card = await makeOrder('card');
    const client = await adminClient();

    assert.match((await client.get(`/admin/orders/${cash.id}`)).text, /Cash Received/);
    assert.doesNotMatch((await client.get(`/admin/orders/${card.id}`)).text, /Cash Received/);
  });

  await t.test('the admin can confirm cash and the order becomes paid', async () => {
    const order = await makeOrder('cod');
    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/orders/${order.id}`);

    await client.post(`/admin/orders/${order.id}/cash-collected`).type('form').send({ _csrf: token });

    assert.equal((await orders.getById(order.id)).status, 'paid');
  });

  await t.test('the same route refuses to pay a card order', async () => {
    const order = await makeOrder('card');
    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/orders/${order.id}`);

    await client.post(`/admin/orders/${order.id}/cash-collected`).type('form').send({ _csrf: token });

    assert.equal((await orders.getById(order.id)).status, 'pending', 'card payment state is Stripe\'s alone');
  });

  await t.test('a customer cannot mark their own cash order paid', async () => {
    const order = await makeOrder('cod');
    await users.create({ email: 'customer@example.com', password: PASSWORD, name: 'C' });
    const client = await agent();
    await signIn(client, 'customer@example.com', PASSWORD);
    // An empty basket page renders no form, so take the token from a page
    // that always has one.
    const token = await csrfFrom(client, '/account');

    const res = await client.post(`/admin/orders/${order.id}/cash-collected`).type('form').send({ _csrf: token });

    assert.equal(res.status, 403);
    assert.equal((await orders.getById(order.id)).status, 'pending');
  });
});
