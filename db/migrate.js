// Forward-only migration runner.
//
// Every .sql file in db/migrations is applied once, in filename order, inside
// a transaction, and recorded in schema_migrations. There is no "down" — to
// undo something, write a new migration. Rollback scripts are written once,
// tested never, and run at the worst possible moment.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { query, withTransaction, close } from './index.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureLedger() {
  await query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

/**
 * Apply any migrations that have not run yet.
 * @returns {Promise<string[]>} filenames applied by this call
 */
export async function migrate() {
  await ensureLedger();

  const { rows } = await query('select filename from schema_migrations');
  const done = new Set(rows.map((r) => r.filename));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = [];

  for (const filename of files) {
    if (done.has(filename)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');

    await withTransaction(async (client) => {
      await client.exec(sql);
      await client.query('insert into schema_migrations (filename) values ($1)', [filename]);
    });

    applied.push(filename);
  }

  return applied;
}

// `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.js')) {
  try {
    const applied = await migrate();
    if (applied.length === 0) {
      console.log('Database is up to date; nothing to apply.');
    } else {
      for (const f of applied) console.log(`applied ${f}`);
    }
    await close();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
    await close();
  }
}
