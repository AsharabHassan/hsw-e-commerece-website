import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, truncateAll, closeDb } from './helpers/db.js';

test('database layer', async (t) => {
  const db = await setupDb();
  t.after(closeDb);

  await t.test('migrations are idempotent', async () => {
    const { migrate } = await import('../db/migrate.js');
    const again = await migrate();
    assert.deepEqual(again, [], 're-running migrations applies nothing');
  });

  await t.test('the core tables exist and start empty', async () => {
    await truncateAll();
    for (const table of ['products', 'categories', 'users', 'orders', 'order_items', 'product_images']) {
      const { rows } = await db.query(`select count(*)::int as n from ${table}`);
      assert.equal(rows[0].n, 0, `${table} should be empty`);
    }
  });

  await t.test('queries are parameterised', async () => {
    await truncateAll();
    const hostile = "Robert'); DROP TABLE products;--";
    await db.query(
      'insert into products (slug, name, price_pence) values ($1, $2, $3)',
      ['test-item', hostile, 5400],
    );
    const { rows } = await db.query('select name, price_pence from products where slug = $1', ['test-item']);
    assert.equal(rows[0].name, hostile, 'the value is stored as data, not executed');
    assert.equal(rows[0].price_pence, 5400);
  });

  await t.test('price_pence rejects negative values', async () => {
    await truncateAll();
    await assert.rejects(
      () => db.query('insert into products (slug, name, price_pence) values ($1, $2, $3)', ['neg', 'Neg', -1]),
      /price_pence|constraint|check/i,
    );
  });

  await t.test('withTransaction rolls back on error', async () => {
    await truncateAll();
    await assert.rejects(() =>
      db.withTransaction(async (client) => {
        await client.query('insert into products (slug, name, price_pence) values ($1, $2, $3)', ['tx', 'Tx', 100]);
        throw new Error('boom');
      }),
    );
    const { rows } = await db.query('select count(*)::int as n from products');
    assert.equal(rows[0].n, 0, 'the insert was rolled back');
  });

  await t.test('withTransaction commits on success', async () => {
    await truncateAll();
    await db.withTransaction(async (client) => {
      await client.query('insert into products (slug, name, price_pence) values ($1, $2, $3)', ['ok', 'Ok', 100]);
    });
    const { rows } = await db.query('select count(*)::int as n from products');
    assert.equal(rows[0].n, 1);
  });
});
