// Customer and admin accounts.
//
// Password hashing uses Node's built-in scrypt rather than bcrypt: scrypt is
// memory-hard, is in the standard library, and needs no native compilation —
// which matters both on a Windows development machine and on a droplet where
// `npm ci` should never have to invoke a C++ toolchain.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { query } from '../db/index.js';

const scrypt = promisify(scryptCb);

// OWASP lists several equivalent scrypt settings. N=2^15, r=8, p=2 is one of
// them, and it needs 32MB per hash rather than the 128MB that N=2^17 demands.
// That matters twice over: Node caps scrypt memory at 32MB by default, and a
// login endpoint that allocates 128MB per attempt is its own denial-of-service
// vector. maxmem is set explicitly so the setting is not at the mercy of a
// runtime default.
const PARAMS = { N: 2 ** 15, r: 8, p: 2, keylen: 64, maxmem: 64 * 1024 * 1024 };

function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/** @returns {Promise<string>} "scrypt$N$r$p$salt$hash" */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PARAMS.keylen, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** Constant-time verification. Returns false rather than throwing on junk. */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    // Parameters come from the stored hash, not from PARAMS, so hashes
    // written under older settings still verify after a parameter change.
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

const PUBLIC_COLUMNS = 'id, email, name, is_admin, created_at';

const users = {
  async create({ email, password, name = '', is_admin = false }) {
    const hash = await hashPassword(password);
    const { rows } = await query(
      `insert into users (email, password_hash, name, is_admin)
       values ($1, $2, $3, $4)
       returning ${PUBLIC_COLUMNS}`,
      [normaliseEmail(email), hash, name.trim(), is_admin],
    );
    return rows[0];
  },

  async getById(id) {
    const { rows } = await query(`select ${PUBLIC_COLUMNS} from users where id = $1`, [id]);
    return rows[0] ?? null;
  },

  async findByEmail(email) {
    const { rows } = await query(`select ${PUBLIC_COLUMNS} from users where email = $1`, [
      normaliseEmail(email),
    ]);
    return rows[0] ?? null;
  },

  async emailTaken(email) {
    const { rows } = await query('select 1 from users where email = $1', [normaliseEmail(email)]);
    return rows.length > 0;
  },

  /**
   * Verify credentials.
   *
   * When the email is unknown we still run a hash comparison against a dummy
   * value, so the response time does not tell an attacker which addresses have
   * accounts.
   *
   * @returns {Promise<object|null>} the public user row, or null
   */
  async verify(email, password) {
    const { rows } = await query(
      `select ${PUBLIC_COLUMNS}, password_hash from users where email = $1`,
      [normaliseEmail(email)],
    );

    const row = rows[0];
    if (!row) {
      await verifyPassword(password, await hashPassword('timing-equalisation'));
      return null;
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return null;

    delete row.password_hash;
    return row;
  },

  async setPassword(id, password) {
    await query('update users set password_hash = $2 where id = $1', [id, await hashPassword(password)]);
  },

  async setAdmin(id, isAdmin) {
    const { rows } = await query(
      `update users set is_admin = $2 where id = $1 returning ${PUBLIC_COLUMNS}`,
      [id, isAdmin],
    );
    return rows[0] ?? null;
  },

  /**
   * Attach past guest orders to a newly registered account.
   * Called on registration; the email is the only link a guest order has.
   * @returns {Promise<number>} how many orders were claimed
   */
  async linkGuestOrders(userId, email) {
    const { rows } = await query(
      `update orders set user_id = $1
        where user_id is null and lower(email) = $2
        returning id`,
      [userId, normaliseEmail(email)],
    );
    return rows.length;
  },

  async list() {
    const { rows } = await query(`select ${PUBLIC_COLUMNS} from users order by created_at desc`);
    return rows;
  },

  async count() {
    const { rows } = await query('select count(*)::int as n from users');
    return rows[0].n;
  },
};

export default users;
