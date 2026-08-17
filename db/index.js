// One query interface, two drivers.
//
//   DATABASE_URL set  -> node-postgres against a real Postgres server (production)
//   otherwise         -> PGlite, Postgres compiled to WebAssembly (dev, test)
//
// PGlite *is* Postgres, so SQL, types and JSONB behaviour match and the same
// migrations run against both. This lets `npm test` and `npm run dev` work with
// no external services, while production runs an ordinary Postgres server.

import config from '../config.js';

/** @type {{query: Function, withTransaction: Function, close: Function} | null} */
let impl = null;
let initialising = null;

async function createPostgres() {
  const { default: pg } = await import('pg');

  // PGlite returns plain JS values for int8/numeric; make node-postgres agree
  // so model code does not have to care which driver it is talking to.
  pg.types.setTypeParser(pg.types.builtins.INT8, (v) => parseInt(v, 10));

  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on an idle Postgres client:', err);
  });

  return {
    driver: 'postgres',
    query: (text, params) => pool.query(text, params),
    // Multi-statement script. node-postgres allows this over the simple query
    // protocol, which is exactly the case where no parameters are involved.
    exec: (text) => pool.query(text),
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({
          query: (text, params) => client.query(text, params),
          exec: (text) => client.query(text),
        });
        await client.query('commit');
        return out;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch {
          // The connection is already broken; the pool will discard it.
        }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite() {
  const { PGlite } = await import('@electric-sql/pglite');

  const inMemory = process.env.PGLITE_MEMORY === '1';
  const location = inMemory ? 'memory://' : (process.env.PGLITE_DIR ?? '.data/pglite');

  // PGlite calls mkdir without `recursive`, so the parent has to exist first.
  if (!inMemory) {
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(location), { recursive: true });
  }

  const lite = await PGlite.create(location);

  // PGlite has no connection pool, so a transaction is just serialised
  // statements on the single instance.
  const run = (text, params) => lite.query(text, params ?? []);

  return {
    driver: 'pglite',
    query: run,
    // PGlite's query() is strictly one statement per call; exec() is the
    // multi-statement entry point used for migration and seed scripts.
    exec: (text) => lite.exec(text),
    withTransaction: async (fn) => {
      await run('begin');
      try {
        const out = await fn({ query: run, exec: (text) => lite.exec(text) });
        await run('commit');
        return out;
      } catch (err) {
        try {
          await run('rollback');
        } catch {
          // Nothing useful to do; surface the original error.
        }
        throw err;
      }
    },
    close: () => lite.close(),
  };
}

async function init() {
  if (impl) return impl;
  if (!initialising) {
    initialising = (config.databaseUrl ? createPostgres() : createPglite())
      .then((created) => {
        impl = created;
        return impl;
      })
      .finally(() => {
        initialising = null;
      });
  }
  return initialising;
}

/**
 * Run a parameterised query.
 * @param {string} text SQL with $1, $2 placeholders
 * @param {unknown[]} [params]
 * @returns {Promise<{rows: any[]}>}
 */
export async function query(text, params) {
  return (await init()).query(text, params);
}

/**
 * Run `fn` inside a transaction, committing on return and rolling back on throw.
 * @template T
 * @param {(client: {query: Function}) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  return (await init()).withTransaction(fn);
}

/**
 * Run a multi-statement SQL script with no parameters (migrations, seeds).
 * @param {string} text
 */
export async function exec(text) {
  return (await init()).exec(text);
}

/** Which driver is in use — useful in diagnostics and the admin dashboard. */
export async function driver() {
  return (await init()).driver;
}

/** Close the pool or instance. */
export async function close() {
  if (impl) {
    const current = impl;
    impl = null;
    await current.close();
  }
}
