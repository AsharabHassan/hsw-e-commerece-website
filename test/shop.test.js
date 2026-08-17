import test from 'node:test';
import assert from 'node:assert/strict';

import { truncateAll } from './helpers/db.js';
import { getApp, agent, csrfFrom, request } from './helpers/app.js';

import products from '../models/products.js';
import categories from '../models/categories.js';

async function publish(fields) {
  return products.create({ is_published: true, is_placeholder: false, ...fields });
}

test('storefront', async (t) => {
  const app = await getApp();
  t.beforeEach(truncateAll);

  await t.test('the home page renders', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /Harley Street Wellness/);
  });

  await t.test('an unknown route renders the branded 404', async () => {
    const res = await request(app).get('/no-such-page');
    assert.equal(res.status, 404);
    assert.match(res.text, /could not find that page/i);
    assert.match(res.text, /Harley Street Wellness/, 'the 404 keeps the site chrome');
  });

  await t.test('an unpublished product 404s rather than leaking a draft', async () => {
    await products.create({ slug: 'secret', name: 'Secret', price_pence: 100, is_published: false });
    const res = await request(app).get('/shop/secret');
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /Secret/);
  });

  await t.test('a published product renders its price and story blocks', async () => {
    await publish({
      slug: 'live-one',
      name: 'Live One',
      price_pence: 5400,
      story_blocks: [{ type: 'faq', items: [{ q: 'Is it good?', a: ['Yes.'] }] }],
    });

    const res = await request(app).get('/shop/live-one');
    assert.equal(res.status, 200);
    assert.match(res.text, /£54\.00/);
    assert.match(res.text, /Is it good\?/);
    assert.match(res.text, /Yes\./);
  });

  await t.test('a placeholder shows the notice and offers no way to buy', async () => {
    await products.create({
      slug: 'ph', name: 'Placeholder Item', price_pence: 100,
      is_published: true, is_placeholder: true,
    });

    const res = await request(app).get('/shop/ph');
    assert.equal(res.status, 200);
    assert.match(res.text, /Placeholder listing — not for sale/i);
    assert.doesNotMatch(res.text, /name="product_id"/, 'no add-to-basket form is rendered');
  });

  await t.test('structured data omits an offer for a placeholder', async () => {
    await products.create({ slug: 'ph2', name: 'PH2', price_pence: 9900, is_published: true, is_placeholder: true });
    const res = await request(app).get('/shop/ph2');

    const jsonLd = res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
    const data = JSON.parse(jsonLd);
    assert.equal(data['@type'], 'Product');
    assert.equal(data.offers, undefined, 'no fabricated offer is published for a placeholder');
  });

  await t.test('structured data includes a real offer for a real product', async () => {
    await publish({ slug: 'real', name: 'Real', price_pence: 5400 });
    const res = await request(app).get('/shop/real');

    const data = JSON.parse(res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(data.offers.price, '54.00');
    assert.equal(data.offers.priceCurrency, 'GBP');
  });

  await t.test('the catalogue filters by category', async () => {
    const cat = await categories.create({ slug: 'supplements', name: 'Supplements' });
    await publish({ slug: 'in-cat', name: 'In Category', price_pence: 100, category_id: cat.id });
    await publish({ slug: 'out-cat', name: 'Out Of Category', price_pence: 100 });

    const res = await request(app).get('/shop?category=supplements');
    assert.match(res.text, /In Category/);
    assert.doesNotMatch(res.text, /Out Of Category/);
  });

  await t.test('an unknown category 404s', async () => {
    assert.equal((await request(app).get('/shop?category=nope')).status, 404);
  });

  await t.test('the sitemap lists real products but not placeholders', async () => {
    await publish({ slug: 'sellable', name: 'Sellable', price_pence: 100 });
    await products.create({ slug: 'not-sellable', name: 'NS', price_pence: 100, is_published: true, is_placeholder: true });

    const res = await request(app).get('/sitemap.xml');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /xml/);
    assert.match(res.text, /\/shop\/sellable/);
    assert.doesNotMatch(res.text, /\/shop\/not-sellable/);
  });
});

test('cross-site request forgery', async (t) => {
  const app = await getApp();
  t.beforeEach(truncateAll);

  await t.test('a POST without a token is refused', async () => {
    const res = await request(app).post('/cart/add').type('form').send({ product_id: 1, qty: 1 });
    assert.equal(res.status, 403);
    assert.match(res.text, /could not be verified/i);
  });

  await t.test('a POST with someone else\'s token is refused', async () => {
    const client = await agent();
    await client.get('/cart');
    const res = await client
      .post('/cart/add')
      .type('form')
      .send({ product_id: 1, qty: 1, _csrf: 'a'.repeat(64) });
    assert.equal(res.status, 403);
  });

  await t.test('a POST with the session\'s own token is accepted', async () => {
    const product = await publish({ slug: 'ok', name: 'Ok', price_pence: 100 });
    const client = await agent();
    const token = await csrfFrom(client);

    const res = await client
      .post('/cart/add')
      .type('form')
      .send({ product_id: product.id, qty: 1, _csrf: token });

    assert.equal(res.status, 302);
  });
});

test('legal pages', async (t) => {
  const app = await getApp();

  await t.test('the returns page states the statutory 14-day right', async () => {
    const res = await request(app).get('/shipping-returns');
    assert.equal(res.status, 200);
    assert.match(res.text, /14 days/);
    assert.match(res.text, /Consumer Contracts/);
  });

  await t.test('terms and privacy render', async () => {
    assert.equal((await request(app).get('/terms')).status, 200);
    assert.equal((await request(app).get('/privacy')).status, 200);
  });

  await t.test('the privacy policy describes the session cookie it actually sets', async () => {
    const res = await request(app).get('/privacy');
    assert.match(res.text, /hsw\.sid/);
  });
});
