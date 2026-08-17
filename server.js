// Entry point. Everything of substance is in app.js so the test suite can
// drive the application without binding a port.

import config from './config.js';
import { createApp } from './app.js';
import { close as closeDb, driver } from './db/index.js';

const app = await createApp();

const server = app.listen(config.port, () => {
  console.log(`${config.storeName} store`);
  console.log(`  env      ${config.env}`);
  console.log(`  database ${driver.name ? '' : ''}${config.databaseUrl ? 'postgres' : 'pglite (development)'}`);
  console.log(`  payments ${config.stripe.configured ? 'stripe configured' : 'NOT CONFIGURED — checkout is disabled'}`);
  console.log(`  listening on http://localhost:${config.port}`);
});

// PM2 and systemd send SIGINT/SIGTERM; finish in-flight requests, then let go
// of the database rather than leaving connections for Postgres to reap.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
