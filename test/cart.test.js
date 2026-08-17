import test from 'node:test';
import assert from 'node:assert/strict';

import { setupDb, truncateAll } from './helpers/db.js';
import { getApp, agent, csrfFrom } from './helpers/app.js';

import cart from '../lib/cart.js';
import products from '../models/products.js';

async function sellable(fields) {
  return products.create({ is_published: true, is_placeholder: false, ...fields });
}

test('basket arithmetic', async (t) => {
  await setupDb();
  t.beforeEach(truncateAll);

  await t.test('quantities are clamped to the maximum', () => {
    const session = {};
    cart.add(session, 7, 500);
    assert.equal(cart.read(session)[0].qty, cart.MAX_QTY);
  });

  await t.test('a quantity of zero removes the line', () => {
    const session = {};
    cart.add(session, 7, 3);
    cart.update(session, 7, 0);
    assert.equal(cart.read(session).length, 0);
  });

  await t.test('adding the same product twice accumulates', () => {
    const session = {};
    cart.add(session, 7, 2);
    cart.add(session, 7, 3);
    assert.equal(cart.read(session)[0].qty, 5);
  });

  await t.test('a negative or non-numeric quantity is ignored', () => {
    const session = {};
    cart.add(session, 7, -5);
    cart.add(session, 8, 'banana');
    assert.equal(cart.read(session).length, 0);
  });

  await t.test('count is synchronous and needs no database', () => {
    const session = { cart: [{ product_id: 1, qty: 2 }, { product_id: 2, qty: 3 }] };
    assert.equal(cart.count(session), 5);
  });

  await t.test('hydrate prices from the database, not from the session', async () => {
    const product = await sellable({ slug: 'x', name: 'X', price_pence: 5400 });

    const session = {};
    cart.add(session, product.id, 2);

    // Tamper with the session exactly as a compromised client would.
    session.cart[0].price_pence = 1;
    session.cart[0].name = 'Free Stuff';

    const basket = await cart.hydrate(session);
    assert.equal(basket.subtotal_pence, 10800, 'the database price wins');
    assert.equal(basket.lines[0].product.name, 'X');
  });

  await t.test('an unpublished product is dropped from the basket', async () => {
    const product = await sellable({ slug: 'gone', name: 'Gone', price_pence: 100 });
    const session = {};
    cart.add(session, product.id, 1);

    await products.update(product.id, { is_published: false });

    const basket = await cart.hydrate(session);
    assert.equal(basket.lines.length, 0);
    assert.equal(basket.removed, 1);
    assert.equal(session.cart.length, 0, 'the dead line is pruned from the session');
  });

  await t.test('a placeholder product is dropped from the basket', async () => {
    const product = await products.create({
      slug: 'ph', name: 'PH', price_pence: 100, is_published: true, is_placeholder: true,
    });
    const session = {};
    cart.add(session, product.id, 1);

    assert.equal((await cart.hydrate(session)).lines.length, 0);
  });

  await t.test('shipping is charged below the threshold and free above it', async () => {
    const cheap = await sellable({ slug: 'cheap', name: 'Cheap', price_pence: 1000 });
    const dear = await sellable({ slug: 'dear', name: 'Dear', price_pence: 9000 });

    const small = {};
    cart.add(small, cheap.id, 1);
    const smallBasket = await cart.hydrate(small);
    assert.equal(smallBasket.shipping_pence, 495);
    assert.equal(smallBasket.total_pence, 1495);

    const large = {};
    cart.add(large, dear.id, 1);
    const largeBasket = await cart.hydrate(large);
    assert.equal(largeBasket.shipping_pence, 0);
    assert.equal(largeBasket.total_pence, 9000);
  });

  await t.test('an empty basket is never charged shipping', async () => {
    const basket = await cart.hydrate({});
    assert.equal(basket.shipping_pence, 0);
    assert.equal(basket.total_pence, 0);
  });
});

test('basket routes', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);

  await t.test('a placeholder cannot be added through the route either', async () => {
    const product = await products.create({
      slug: 'ph-route', name: 'PH Route', price_pence: 100,
      is_published: true, is_placeholder: true,
    });

    const client = await agent();
    const token = await csrfFrom(client);

    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 1, _csrf: token });

    const res = await client.get('/cart');
    assert.match(res.text, /Your basket is empty/);
  });

  await t.test('add, update and remove round-trip through the session', async () => {
    const product = await sellable({ slug: 'flow', name: 'Flow Item', price_pence: 2500 });

    const client = await agent();
    const token = await csrfFrom(client);

    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 2, _csrf: token });
    let res = await client.get('/cart');
    assert.match(res.text, /Flow Item/);
    assert.match(res.text, /£50\.00/, 'two at £25.00');

    await client.post('/cart/update').type('form').send({ product_id: product.id, qty: 1, _csrf: token });
    res = await client.get('/cart');
    assert.match(res.text, /£25\.00/);

    await client.post('/cart/remove').type('form').send({ product_id: product.id, _csrf: token });
    res = await client.get('/cart');
    assert.match(res.text, /Your basket is empty/);
  });

  await t.test('the basket badge reflects the item count', async () => {
    const product = await sellable({ slug: 'badge', name: 'Badge', price_pence: 100 });
    const client = await agent();
    const token = await csrfFrom(client);

    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 3, _csrf: token });

    const res = await client.get('/shop');
    assert.match(res.text, /basket-count">3</);
  });

  await t.test('adding a product that does not exist is refused, not crashed', async () => {
    const client = await agent();
    const token = await csrfFrom(client);

    const res = await client
      .post('/cart/add')
      .type('form')
      .send({ product_id: 999999, qty: 1, _csrf: token });

    assert.equal(res.status, 302);
    assert.match((await client.get('/cart')).text, /Your basket is empty/);
  });
});
