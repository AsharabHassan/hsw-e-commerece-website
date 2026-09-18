import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setupDb, truncateAll } from './helpers/db.js';

import products from '../models/products.js';
import { updateUrolithin } from '../db/update-urolithin.js';
import { UROLITHIN_IMAGES } from '../db/content/urolithin-a.js';

test('Urolithin A listing update', async (t) => {
  await setupDb();
  t.beforeEach(truncateAll);

  await t.test('rewrites the copy and images but leaves price and flags alone', async () => {
    const p = await products.create({
      slug: 'urolithin-a-complex', name: 'Old', summary: '120 Capsules', price_pence: 6123,
      is_published: true, is_placeholder: false,
    });
    await products.addImage(p.id, { path: '/uploads/old.jpg', alt: 'old' });

    await updateUrolithin({ quiet: true });
    const after = await products.getById(p.id);

    assert.equal(after.price_pence, 6123);
    assert.equal(after.is_placeholder, false);
    assert.equal(after.is_published, true);
    assert.equal(after.summary, '60 Softgels · 30 Servings');
    assert.deepEqual(after.images.map((i) => i.path), UROLITHIN_IMAGES.map((i) => i.path));

    const facts = after.story_blocks.find((b) => b.type === 'facts');
    assert.equal(facts.serving, '2 softgels');
    assert.equal(facts.servingsPerContainer, '30');
    assert.equal(facts.totalRow.amount, '2000 mg');

    const gallery = after.story_blocks.find((b) => b.type === 'gallery');
    assert.ok(gallery.slots.every((s) => s.image), 'every gallery slot survived sanitising with its image');
  });

  await t.test('is safe to run twice', async () => {
    await products.create({ slug: 'urolithin-a-complex', name: 'Old', price_pence: 5400 });
    await updateUrolithin({ quiet: true });
    const id = await updateUrolithin({ quiet: true });
    assert.equal((await products.getById(id)).images.length, UROLITHIN_IMAGES.length);
  });

  await t.test('every referenced image exists in public/', () => {
    for (const { path } of UROLITHIN_IMAGES) {
      assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), path);
    }
  });
});
