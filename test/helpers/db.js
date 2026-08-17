// Test database harness.
//
// node --test runs each test FILE in its own child process, so module-level
// state here is already isolated per file. Within a file, tests share one
// in-memory PGlite instance and call truncateAll() between them.

process.env.NODE_ENV = 'test';
process.env.PGLITE_MEMORY = '1';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough';
delete process.env.DATABASE_URL;

const TABLES = [
  'order_items',
  'orders',
  'product_images',
  'products',
  'categories',
  'sessions',
  'users',
];

let ready = null;

/**
 * Migrate the in-memory database. Safe to call from every test file.
 * @returns {Promise<{query: Function, withTransaction: Function, close: Function}>}
 */
export function setupDb() {
  if (!ready) {
    ready = (async () => {
      const db = await import('../../db/index.js');
      const { migrate } = await import('../../db/migrate.js');
      await migrate();
      return db;
    })();
  }
  return ready;
}

/** Empty every table, resetting identity sequences. */
export async function truncateAll() {
  const db = await setupDb();
  await db.query(`truncate ${TABLES.join(', ')} restart identity cascade`);
}

/**
 * Close the instance.
 *
 * Registered automatically on `beforeExit` rather than called per suite: node's
 * test runner gives each FILE its own process but runs the suites inside it
 * sequentially, so closing after one suite would leave the next one talking to
 * an unmigrated database.
 */
export async function closeDb() {
  if (!ready) return;
  const db = await ready;
  ready = null;
  await db.close();
}

process.once('beforeExit', () => {
  closeDb().catch(() => {});
});
