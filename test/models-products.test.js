import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, truncateAll, closeDb } from './helpers/db.js';

const { default: products } = await import('../models/products.js').catch(() => ({ default: null }));
const { default: categories } = await import('../models/categories.js').catch(() => ({ default: null }));

test('product model', async (t) => {
  await setupDb();
  t.after(closeDb);
  t.beforeEach(truncateAll);

  await t.test('create returns the row it inserted', async () => {
    const p = await products.create({
      slug: 'a-thing', name: 'A Thing', price_pence: 5400, is_published: true, is_placeholder: false,
    });
    assert.equal(p.slug, 'a-thing');
    assert.equal(p.price_pence, 5400);
    assert.equal(typeof p.id, 'number');
  });

  await t.test('getBySlug hides unpublished products', async () => {
    await products.create({ slug: 'hidden', name: 'Hidden', price_pence: 1000, is_published: false });
    assert.equal(await products.getBySlug('hidden'), null);

    await products.create({ slug: 'shown', name: 'Shown', price_pence: 1000, is_published: true });
    assert.equal((await products.getBySlug('shown')).name, 'Shown');
  });

  await t.test('getById ignores publication state, for admin use', async () => {
    const p = await products.create({ slug: 'draft', name: 'Draft', price_pence: 1, is_published: false });
    assert.equal((await products.getById(p.id)).slug, 'draft');
  });

  await t.test('priceMap returns authoritative prices and skips unknown ids', async () => {
    const p = await products.create({ slug: 'p1', name: 'P1', price_pence: 5400, is_published: true });
    const map = await products.priceMap([p.id, 99999]);
    assert.equal(map.get(p.id).price_pence, 5400);
    assert.equal(map.has(99999), false);
  });

  await t.test('priceMap tolerates an empty id list', async () => {
    const map = await products.priceMap([]);
    assert.equal(map.size, 0);
  });

  await t.test('story_blocks round-trips as JSON', async () => {
    const blocks = [{ type: 'faq', items: [{ q: 'Q', a: 'A' }] }];
    const p = await products.create({ slug: 'blocks', name: 'B', price_pence: 1, story_blocks: blocks });
    assert.deepEqual((await products.getById(p.id)).story_blocks, blocks);
  });

  await t.test('story_blocks defaults to an empty array, never null', async () => {
    const p = await products.create({ slug: 'noblocks', name: 'N', price_pence: 1 });
    assert.deepEqual((await products.getById(p.id)).story_blocks, []);
  });

  await t.test('update changes only the fields passed', async () => {
    const p = await products.create({ slug: 'u', name: 'Before', subtitle: 'Keep me', price_pence: 100 });
    const after = await products.update(p.id, { name: 'After' });
    assert.equal(after.name, 'After');
    assert.equal(after.subtitle, 'Keep me');
    assert.equal(after.price_pence, 100);
  });

  await t.test('update rejects an unknown column', async () => {
    const p = await products.create({ slug: 'u2', name: 'X', price_pence: 1 });
    await assert.rejects(() => products.update(p.id, { 'price_pence = 0; drop table products; --': 1 }));
  });

  await t.test('listPublished excludes drafts and orders by sort then name', async () => {
    await products.create({ slug: 'z', name: 'Zeta', price_pence: 1, is_published: true });
    await products.create({ slug: 'a', name: 'Alpha', price_pence: 1, is_published: true });
    await products.create({ slug: 'd', name: 'Draft', price_pence: 1, is_published: false });

    const list = await products.listPublished();
    assert.deepEqual(list.map((p) => p.name), ['Alpha', 'Zeta']);
  });

  await t.test('listPublished filters by category slug', async () => {
    const cat = await categories.create({ slug: 'supplements', name: 'Supplements' });
    await products.create({ slug: 'in', name: 'In', price_pence: 1, is_published: true, category_id: cat.id });
    await products.create({ slug: 'out', name: 'Out', price_pence: 1, is_published: true });

    const list = await products.listPublished({ categorySlug: 'supplements' });
    assert.deepEqual(list.map((p) => p.name), ['In']);
  });

  await t.test('images come back attached, in sort order', async () => {
    const p = await products.create({ slug: 'img', name: 'Img', price_pence: 1, is_published: true });
    await products.addImage(p.id, { path: '/uploads/b.jpg', alt: 'Second', sort: 2 });
    await products.addImage(p.id, { path: '/uploads/a.jpg', alt: 'First', sort: 1 });

    const fetched = await products.getBySlug('img');
    assert.deepEqual(fetched.images.map((i) => i.alt), ['First', 'Second']);
  });

  await t.test('deleting a product deletes its images', async () => {
    const p = await products.create({ slug: 'del', name: 'Del', price_pence: 1 });
    await products.addImage(p.id, { path: '/uploads/x.jpg', alt: '' });
    await products.remove(p.id);

    const db = await setupDb();
    const { rows } = await db.query('select count(*)::int as n from product_images');
    assert.equal(rows[0].n, 0);
  });

  await t.test('slugs are unique', async () => {
    await products.create({ slug: 'dupe', name: 'One', price_pence: 1 });
    await assert.rejects(() => products.create({ slug: 'dupe', name: 'Two', price_pence: 1 }));
  });
});

test('category model', async (t) => {
  await setupDb();
  t.after(closeDb);
  t.beforeEach(truncateAll);

  await t.test('list returns categories in sort order', async () => {
    await categories.create({ slug: 'b', name: 'Bee', sort: 2 });
    await categories.create({ slug: 'a', name: 'Ay', sort: 1 });
    assert.deepEqual((await categories.list()).map((c) => c.slug), ['a', 'b']);
  });

  await t.test('deleting a category leaves its products in place', async () => {
    const cat = await categories.create({ slug: 'temp', name: 'Temp' });
    const p = await products.create({ slug: 'orphan', name: 'Orphan', price_pence: 1, category_id: cat.id });
    await categories.remove(cat.id);
    assert.equal((await products.getById(p.id)).category_id, null);
  });
});
