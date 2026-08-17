import test from 'node:test';
import assert from 'node:assert/strict';

import { setupDb, truncateAll } from './helpers/db.js';
import { getApp, agent, csrfFrom, signIn, request } from './helpers/app.js';

import users from '../models/users.js';
import products from '../models/products.js';
import orders from '../models/orders.js';

const PASSWORD = 'a-long-enough-password';

async function sellable(slug) {
  return products.create({
    slug, name: `Item ${slug}`, price_pence: 1000,
    is_published: true, is_placeholder: false,
  });
}

async function guestOrderFor(email) {
  const product = await sellable(`g-${Math.floor(Math.random() * 1e9)}`);
  return orders.create({
    email,
    user_id: null,
    lines: [{ product, qty: 1 }],
    shipping_pence: 0,
    ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
  });
}

test('password hashing', async (t) => {
  await setupDb();

  await t.test('a hash is not the password, and verifies', async () => {
    const user = await users.create({ email: 'h@example.com', password: PASSWORD, name: 'H' });
    assert.equal(user.password_hash, undefined, 'the hash never leaves the model');

    assert.ok(await users.verify('h@example.com', PASSWORD));
    assert.equal(await users.verify('h@example.com', 'wrong'), null);
  });

  await t.test('the same password hashes differently each time', async () => {
    const { rows } = await (await setupDb()).query('select password_hash from users limit 1');
    const stored = rows[0].password_hash;
    assert.match(stored, /^scrypt\$/);
    assert.ok(!stored.includes(PASSWORD));
  });

  await t.test('an unknown email returns null without throwing', async () => {
    assert.equal(await users.verify('nobody@example.com', PASSWORD), null);
  });

  await t.test('email is matched case-insensitively', async () => {
    await users.create({ email: 'Case@Example.COM', password: PASSWORD, name: 'C' });
    assert.ok(await users.verify('case@example.com', PASSWORD));
  });
});

test('registration and sign-in', async (t) => {
  const app = await getApp();
  t.beforeEach(truncateAll);

  await t.test('registering creates an account and signs the user in', async () => {
    const client = await agent();
    const token = await csrfFrom(client, '/account/register');

    const res = await client.post('/account/register').type('form').send({
      name: 'New Customer',
      email: 'new@example.com',
      password: PASSWORD,
      password_confirm: PASSWORD,
      _csrf: token,
    });

    assert.equal(res.status, 302);
    assert.match((await client.get('/account')).text, /new@example\.com/);
  });

  await t.test('mismatched passwords are rejected', async () => {
    const client = await agent();
    const token = await csrfFrom(client, '/account/register');

    const res = await client.post('/account/register').type('form').send({
      name: 'X', email: 'x@example.com',
      password: PASSWORD, password_confirm: 'something-else', _csrf: token,
    });

    assert.equal(res.status, 400);
    assert.match(res.text, /do not match/i);
  });

  await t.test('a short password is rejected', async () => {
    const client = await agent();
    const token = await csrfFrom(client, '/account/register');

    const res = await client.post('/account/register').type('form').send({
      name: 'X', email: 'short@example.com',
      password: 'short', password_confirm: 'short', _csrf: token,
    });

    assert.equal(res.status, 400);
    assert.match(res.text, /at least 10 characters/i);
  });

  await t.test('a duplicate email is refused', async () => {
    await users.create({ email: 'dupe@example.com', password: PASSWORD, name: 'D' });

    const client = await agent();
    const token = await csrfFrom(client, '/account/register');

    const res = await client.post('/account/register').type('form').send({
      name: 'D2', email: 'dupe@example.com',
      password: PASSWORD, password_confirm: PASSWORD, _csrf: token,
    });

    assert.equal(res.status, 409);
    assert.match(res.text, /already exists/i);
  });

  await t.test('a failed sign-in does not reveal whether the email exists', async () => {
    await users.create({ email: 'real@example.com', password: PASSWORD, name: 'R' });

    const clientA = await agent();
    const wrongPassword = await signIn(clientA, 'real@example.com', 'wrong-password');

    const clientB = await agent();
    const noSuchUser = await signIn(clientB, 'ghost@example.com', 'wrong-password');

    assert.equal(wrongPassword.status, 401);
    assert.equal(noSuchUser.status, 401);
    assert.match(wrongPassword.text, /were not recognised/);
    assert.match(noSuchUser.text, /were not recognised/);
  });

  await t.test('signing in keeps the basket', async () => {
    await users.create({ email: 'basket@example.com', password: PASSWORD, name: 'B' });
    const product = await sellable('keep-basket');

    const client = await agent();
    const token = await csrfFrom(client);
    await client.post('/cart/add').type('form').send({ product_id: product.id, qty: 2, _csrf: token });

    await signIn(client, 'basket@example.com', PASSWORD);

    const res = await client.get('/cart');
    assert.match(res.text, /Item keep-basket/);
    assert.match(res.text, /£20\.00/, 'two at £10.00 survived the session regeneration');
  });

  await t.test('the session id is regenerated on sign-in', async () => {
    await users.create({ email: 'fix@example.com', password: PASSWORD, name: 'F' });

    const client = await agent();
    await client.get('/account/login');
    const before = client.jar.getCookie('hsw.sid', { path: '/', domain: '127.0.0.1', secure: false, script: false })?.value;

    await signIn(client, 'fix@example.com', PASSWORD);
    const after = client.jar.getCookie('hsw.sid', { path: '/', domain: '127.0.0.1', secure: false, script: false })?.value;

    assert.notEqual(before, after, 'a pre-login session id cannot be reused after login');
  });

  await t.test('signing out ends the session', async () => {
    await users.create({ email: 'out@example.com', password: PASSWORD, name: 'O' });

    const client = await agent();
    await signIn(client, 'out@example.com', PASSWORD);
    assert.equal((await client.get('/account')).status, 200);

    // /account/login redirects away once signed in, so take the token from the
    // sign-out form on the account page itself.
    const token = await csrfFrom(client, '/account');
    await client.post('/account/logout').type('form').send({ _csrf: token });

    assert.equal((await client.get('/account')).status, 302, 'back to the login redirect');
  });
});

test('order history', async (t) => {
  const app = await getApp();
  t.beforeEach(truncateAll);

  await t.test('registering claims past guest orders with the same email', async () => {
    const order = await guestOrderFor('claim@example.com');
    assert.equal(order.user_id, null);

    const client = await agent();
    const token = await csrfFrom(client, '/account/register');
    await client.post('/account/register').type('form').send({
      name: 'Claimer', email: 'claim@example.com',
      password: PASSWORD, password_confirm: PASSWORD, _csrf: token,
    });

    const reloaded = await orders.getById(order.id);
    assert.ok(reloaded.user_id, 'the guest order now belongs to the account');

    const res = await client.get('/account');
    assert.match(res.text, new RegExp(order.public_token.slice(0, 8).toUpperCase()));
  });

  await t.test('guest orders for a different email are not claimed', async () => {
    const other = await guestOrderFor('someone-else@example.com');

    const user = await users.create({ email: 'me@example.com', password: PASSWORD, name: 'M' });
    await users.linkGuestOrders(user.id, 'me@example.com');

    assert.equal((await orders.getById(other.id)).user_id, null);
  });

  await t.test('a customer cannot read another customer\'s order', async () => {
    const alice = await users.create({ email: 'alice@example.com', password: PASSWORD, name: 'A' });
    await users.create({ email: 'bob@example.com', password: PASSWORD, name: 'B' });

    const product = await sellable('alices-thing');
    const aliceOrder = await orders.create({
      email: 'alice@example.com', user_id: alice.id,
      lines: [{ product, qty: 1 }], shipping_pence: 0,
      ship: { name: 'A', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });

    const bob = await agent();
    await signIn(bob, 'bob@example.com', PASSWORD);

    assert.equal((await bob.get(`/account/orders/${aliceOrder.id}`)).status, 404);
  });

  await t.test('an order claimed by an account is hidden from anonymous token holders', async () => {
    const user = await users.create({ email: 'owner@example.com', password: PASSWORD, name: 'O' });
    const product = await sellable('owned-thing');
    const order = await orders.create({
      email: 'owner@example.com', user_id: user.id,
      lines: [{ product, qty: 1 }], shipping_pence: 0,
      ship: { name: 'O', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });

    assert.equal((await request(app).get(`/order/${order.public_token}`)).status, 404);
  });

  await t.test('a guest order stays reachable by its token', async () => {
    const order = await guestOrderFor('guest@example.com');
    const res = await request(app).get(`/order/${order.public_token}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /guest@example\.com/);
  });

  await t.test('/account requires signing in', async () => {
    const res = await request(app).get('/account');
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/account\/login/);
  });

  await t.test('the login redirect only ever returns to a local path', async () => {
    await users.create({ email: 'redir@example.com', password: PASSWORD, name: 'R' });

    const client = await agent();
    const token = await csrfFrom(client, '/account/login');
    const res = await client.post('/account/login').type('form').send({
      email: 'redir@example.com', password: PASSWORD,
      next: 'https://evil.example.com/steal', _csrf: token,
    });

    assert.equal(res.headers.location, '/account', 'an off-site redirect target is discarded');
  });
});
