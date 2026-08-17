import test from 'node:test';
import assert from 'node:assert/strict';

import { truncateAll } from './helpers/db.js';
import { getApp, agent, csrfFrom, signIn, request } from './helpers/app.js';

import users from '../models/users.js';
import products from '../models/products.js';
import orders from '../models/orders.js';

const PASSWORD = 'a-long-enough-password';

async function adminClient() {
  await users.create({ email: 'admin@example.com', password: PASSWORD, name: 'Admin', is_admin: true });
  const client = await agent();
  await signIn(client, 'admin@example.com', PASSWORD);
  return client;
}

async function customerClient() {
  await users.create({ email: 'customer@example.com', password: PASSWORD, name: 'Customer' });
  const client = await agent();
  await signIn(client, 'customer@example.com', PASSWORD);
  return client;
}

test('admin access control', async (t) => {
  const app = await getApp();
  t.beforeEach(truncateAll);

  await t.test('an anonymous visitor is sent to sign in', async () => {
    const res = await request(app).get('/admin');
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/account\/login/);
  });

  await t.test('a signed-in customer is refused, not redirected in a loop', async () => {
    const client = await customerClient();
    const res = await client.get('/admin');

    assert.equal(res.status, 403);
    assert.match(res.text, /staff only/i);
  });

  await t.test('an admin gets in', async () => {
    const client = await adminClient();
    const res = await client.get('/admin');

    assert.equal(res.status, 200);
    assert.match(res.text, /Dashboard/);
  });

  await t.test('every admin sub-route is guarded', async () => {
    const client = await customerClient();

    for (const path of ['/admin/products', '/admin/products/new', '/admin/orders', '/admin/categories']) {
      const res = await client.get(path);
      assert.equal(res.status, 403, `${path} should be forbidden to a customer`);
    }
  });

  await t.test('admin pages are marked no-store', async () => {
    const client = await adminClient();
    const res = await client.get('/admin');
    assert.match(res.headers['cache-control'], /no-store/);
  });
});

test('admin product management', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);

  await t.test('creating a product from the form', async () => {
    const client = await adminClient();
    const token = await csrfFrom(client, '/admin/products/new');

    const res = await client.post('/admin/products/new').type('form').send({
      name: 'Created Product',
      slug: 'created-product',
      price: '54.00',
      summary: '120 Capsules',
      is_published: 'on',
      _csrf: token,
    });

    assert.equal(res.status, 302);

    const created = (await products.listAll()).find((p) => p.slug === 'created-product');
    assert.equal(created.name, 'Created Product');
    assert.equal(created.price_pence, 5400, 'pounds are parsed into pence');
    assert.equal(created.is_published, true);
    assert.equal(created.is_placeholder, false, 'an unticked checkbox means false');
  });

  await t.test('a price is parsed into integer pence, never a float', async () => {
    const client = await adminClient();
    const token = await csrfFrom(client, '/admin/products/new');

    await client.post('/admin/products/new').type('form').send({
      name: 'Odd Price', slug: 'odd-price', price: '£1,054.05', _csrf: token,
    });

    const created = (await products.listAll()).find((p) => p.slug === 'odd-price');
    assert.equal(created.price_pence, 105405);
    assert.ok(Number.isInteger(created.price_pence));
  });

  await t.test('an unparseable price is rejected with a usable message', async () => {
    const client = await adminClient();
    const token = await csrfFrom(client, '/admin/products/new');

    const res = await client.post('/admin/products/new').type('form').send({
      name: 'Bad Price', slug: 'bad-price', price: 'about fifty quid', _csrf: token,
    });

    assert.equal(res.status, 400);
    assert.match(res.text, /Enter a price such as/);
  });

  await t.test('a duplicate slug is refused', async () => {
    await products.create({ slug: 'taken', name: 'Taken', price_pence: 100 });

    const client = await adminClient();
    const token = await csrfFrom(client, '/admin/products/new');

    const res = await client.post('/admin/products/new').type('form').send({
      name: 'Another', slug: 'taken', price: '10.00', _csrf: token,
    });

    assert.equal(res.status, 409);
    assert.match(res.text, /already uses that URL slug/);
  });

  await t.test('story blocks are sanitised when saved', async () => {
    const product = await products.create({ slug: 'blocks', name: 'Blocks', price_pence: 100 });

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/products/${product.id}`);

    await client.post(`/admin/products/${product.id}`).type('form').send({
      name: 'Blocks',
      slug: 'blocks',
      price: '1.00',
      story_blocks: JSON.stringify([
        { type: 'faq', items: [{ q: '<script>alert(1)</script>', a: ['<img src=x onerror=alert(1)>'] }] },
        { type: 'not-a-real-type', payload: 'ignored' },
      ]),
      _csrf: token,
    });

    const saved = await products.getById(product.id);
    const json = JSON.stringify(saved.story_blocks);

    // Unknown tags are escaped rather than deleted, so the operator does not
    // silently lose text. "onerror" therefore survives as inert characters —
    // what must not survive is a live tag.
    assert.ok(!json.includes('<script'), 'no live script tag survived');
    assert.ok(!json.includes('<img'), 'no live img tag survived');
    assert.match(json, /&lt;img/, 'the text is preserved, escaped');
    assert.equal(saved.story_blocks.length, 1, 'the unknown block type was dropped');
  });

  await t.test('invalid JSON in the blocks field is reported, not swallowed', async () => {
    const product = await products.create({ slug: 'badjson', name: 'Bad JSON', price_pence: 100 });

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/products/${product.id}`);

    const res = await client.post(`/admin/products/${product.id}`).type('form').send({
      name: 'Bad JSON', slug: 'badjson', price: '1.00',
      story_blocks: '{ this is not json',
      _csrf: token,
    });

    assert.equal(res.status, 400);
    assert.match(res.text, /not valid JSON/);
  });

  await t.test('editing a product does not rewrite historical order lines', async () => {
    const product = await products.create({
      slug: 'historical', name: 'Old Name', price_pence: 5400,
      is_published: true, is_placeholder: false,
    });

    const order = await orders.create({
      email: 'buyer@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      ship: { name: 'B', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/products/${product.id}`);

    await client.post(`/admin/products/${product.id}`).type('form').send({
      name: 'New Name', slug: 'historical', price: '99.00', _csrf: token,
    });

    const items = await orders.itemsFor(order.id);
    assert.equal(items[0].name_snapshot, 'Old Name');
    assert.equal(items[0].unit_price_pence, 5400);
  });

  await t.test('an image upload with a non-image mime type is refused', async () => {
    const product = await products.create({ slug: 'upload', name: 'Upload', price_pence: 100 });

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/products/${product.id}`);

    const res = await client
      .post(`/admin/products/${product.id}/images`)
      .field('_csrf', token)
      .attach('image', Buffer.from('MZ\x90\x00'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });

    assert.equal(res.status, 302, 'back to the form');

    const reloaded = await products.getById(product.id);
    assert.equal(reloaded.images.length, 0, 'nothing was recorded');

    const form = await client.get(`/admin/products/${product.id}`);
    assert.match(form.text, /Only JPEG, PNG, WebP and AVIF/, 'the operator is told why');
  });
});

test('admin order management', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);

  async function anOrder() {
    const product = await products.create({
      slug: `o-${Math.floor(Math.random() * 1e9)}`, name: 'Ordered', price_pence: 1000,
      is_published: true, is_placeholder: false,
    });
    return orders.create({
      email: 'buyer@example.com',
      lines: [{ product, qty: 1 }],
      shipping_pence: 0,
      ship: { name: 'B', line1: '1 St', city: 'London', postcode: 'W1G 9QD' },
    });
  }

  await t.test('an order can be marked shipped', async () => {
    const order = await anOrder();
    await orders.markPaid(order.id);

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/orders/${order.id}`);

    await client.post(`/admin/orders/${order.id}/status`).type('form').send({ status: 'shipped', _csrf: token });

    assert.equal((await orders.getById(order.id)).status, 'shipped');
  });

  await t.test('an admin cannot mark an order paid by hand', async () => {
    const order = await anOrder();

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/orders/${order.id}`);

    await client.post(`/admin/orders/${order.id}/status`).type('form').send({ status: 'paid', _csrf: token });

    assert.equal(
      (await orders.getById(order.id)).status,
      'pending',
      'payment state belongs to the Stripe webhook, not to a dropdown',
    );
  });

  await t.test('an invalid status is refused', async () => {
    const order = await anOrder();

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/orders/${order.id}`);

    await client.post(`/admin/orders/${order.id}/status`).type('form').send({ status: 'free', _csrf: token });

    assert.equal((await orders.getById(order.id)).status, 'pending');
  });

  await t.test('the order list shows an order', async () => {
    const order = await anOrder();
    const client = await adminClient();

    const res = await client.get('/admin/orders');
    assert.equal(res.status, 200);
    assert.match(res.text, new RegExp(order.public_token.slice(0, 8).toUpperCase()));
  });

  await t.test('the dashboard warns while placeholders remain', async () => {
    await products.create({ slug: 'ph', name: 'PH', price_pence: 100, is_published: true, is_placeholder: true });

    const client = await adminClient();
    const res = await client.get('/admin');

    assert.match(res.text, /still marked as a placeholder/i);
  });

  await t.test('the dashboard warns while Stripe is unconfigured', async () => {
    const client = await adminClient();
    const res = await client.get('/admin');
    assert.match(res.text, /Payments are not configured/i);
  });
});

test('multipart uploads and CSRF', async (t) => {
  await getApp();
  t.beforeEach(truncateAll);

  // A 1x1 PNG. The smallest thing that is genuinely image/png.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  await t.test('a valid upload with a token is stored', async () => {
    const product = await products.create({ slug: 'up-ok', name: 'Up OK', price_pence: 100 });

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/products/${product.id}`);

    const res = await client
      .post(`/admin/products/${product.id}/images`)
      .field('_csrf', token)
      .field('alt', 'A test image')
      .attach('image', PNG, { filename: 'shot.png', contentType: 'image/png' });

    assert.equal(res.status, 302);

    const reloaded = await products.getById(product.id);
    assert.equal(reloaded.images.length, 1);
    assert.equal(reloaded.images[0].alt, 'A test image');
    assert.match(reloaded.images[0].path, /^\/uploads\/\d+-[a-f0-9]{16}\.png$/,
      'the stored filename is generated, never taken from the client');
  });

  await t.test('an upload without a valid token is refused and the file discarded', async () => {
    const product = await products.create({ slug: 'up-csrf', name: 'Up CSRF', price_pence: 100 });

    const client = await adminClient();

    const res = await client
      .post(`/admin/products/${product.id}/images`)
      .field('_csrf', 'a'.repeat(64))
      .attach('image', PNG, { filename: 'shot.png', contentType: 'image/png' });

    assert.equal(res.status, 403);

    const reloaded = await products.getById(product.id);
    assert.equal(reloaded.images.length, 0, 'nothing was recorded');
  });

  await t.test('a deleted image is removed from the record', async () => {
    const product = await products.create({ slug: 'up-del', name: 'Up Del', price_pence: 100 });

    const client = await adminClient();
    const token = await csrfFrom(client, `/admin/products/${product.id}`);

    await client
      .post(`/admin/products/${product.id}/images`)
      .field('_csrf', token)
      .attach('image', PNG, { filename: 'shot.png', contentType: 'image/png' });

    const withImage = await products.getById(product.id);
    const imageId = withImage.images[0].id;

    await client
      .post(`/admin/products/${product.id}/images/${imageId}/delete`)
      .type('form')
      .send({ _csrf: token });

    assert.equal((await products.getById(product.id)).images.length, 0);
  });
});
