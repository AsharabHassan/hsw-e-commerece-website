// express-session store backed by our own db.query().
//
// connect-pg-simple wants a node-postgres pool, which would not work against
// PGlite in development and test. Writing the store against our two-driver
// query interface keeps one session mechanism working everywhere.

import session from 'express-session';
import { query } from '../db/index.js';

const Store = session.Store;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default class PgSessionStore extends Store {
  /**
   * @param {{ttlMs?: number, sweepIntervalMs?: number}} [options]
   */
  constructor({ ttlMs = 30 * ONE_DAY_MS, sweepIntervalMs = 60 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;

    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        this.sweep().catch((err) => console.error('Session sweep failed:', err.message));
      }, sweepIntervalMs);
      // Do not hold the process open for the sweeper.
      this.sweepTimer.unref?.();
    }
  }

  expiryFor(sess) {
    const cookieExpiry = sess?.cookie?.expires;
    if (cookieExpiry) return new Date(cookieExpiry);
    return new Date(Date.now() + this.ttlMs);
  }

  get(sid, callback) {
    query('select sess from sessions where sid = $1 and expire > now()', [sid])
      .then(({ rows }) => {
        if (rows.length === 0) return callback(null, null);
        const sess = rows[0].sess;
        callback(null, typeof sess === 'string' ? JSON.parse(sess) : sess);
      })
      .catch((err) => callback(err));
  }

  set(sid, sess, callback = () => {}) {
    query(
      `insert into sessions (sid, sess, expire) values ($1, $2::jsonb, $3)
       on conflict (sid) do update set sess = excluded.sess, expire = excluded.expire`,
      [sid, JSON.stringify(sess), this.expiryFor(sess)],
    )
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sid, callback = () => {}) {
    query('delete from sessions where sid = $1', [sid])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, sess, callback = () => {}) {
    query('update sessions set expire = $2 where sid = $1', [sid, this.expiryFor(sess)])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  length(callback) {
    query('select count(*)::int as n from sessions where expire > now()')
      .then(({ rows }) => callback(null, rows[0].n))
      .catch((err) => callback(err));
  }

  clear(callback = () => {}) {
    query('delete from sessions')
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  /** Delete expired rows. Runs on a timer; also safe to call directly. */
  async sweep() {
    await query('delete from sessions where expire < now()');
  }

  close() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
}
