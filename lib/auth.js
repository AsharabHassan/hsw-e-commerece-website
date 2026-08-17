// Session authentication and route guards.

import { rotateCsrf } from './csrf.js';
import users from '../models/users.js';

/**
 * Log a user in.
 *
 * The session id is regenerated so a token an attacker planted before login
 * cannot be used after it (session fixation). The basket is carried across by
 * hand, because regenerate() deliberately throws the old session away.
 */
export function login(req, user) {
  return new Promise((resolve, reject) => {
    const basket = req.session.cart ?? [];

    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.cart = basket;
      rotateCsrf(req);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve(user)));
    });
  });
}

export function logout(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

/** Current user, or null. Cached on the request. */
export async function currentUser(req) {
  if (!req.session?.userId) return null;
  if (req._user === undefined) req._user = await users.getById(req.session.userId);
  return req._user;
}

/** Require any signed-in user; bounce to login with a return path. */
export async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) {
      const to = encodeURIComponent(req.originalUrl);
      return res.redirect(`/account/login?next=${to}`);
    }
    res.locals.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Require an admin.
 *
 * An anonymous visitor is redirected to log in; a signed-in customer gets 403.
 * The distinction matters: redirecting a logged-in non-admin to a login form
 * they are already past is a dead end.
 */
export async function requireAdmin(req, res, next) {
  try {
    const user = await currentUser(req);

    if (!user) {
      const to = encodeURIComponent(req.originalUrl);
      return res.redirect(`/account/login?next=${to}`);
    }

    if (!user.is_admin) {
      return res.status(403).render('error.njk', {
        status: 403,
        title: 'Not permitted',
        heading: 'That area is staff only',
        message: 'Your account does not have administrator access.',
      });
    }

    res.locals.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// In-memory and per-process, which is the right trade for a single-droplet
// deployment: it costs nothing, needs no Redis, and resets on restart. If this
// ever runs on more than one node, move it to the database.

const attempts = new Map();

/**
 * @param {{windowMs?: number, max?: number, key?: (req) => string}} options
 */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, key = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const id = key(req);
    const now = Date.now();

    const record = attempts.get(id);
    if (!record || now > record.resetAt) {
      attempts.set(id, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count += 1;

    if (record.count > max) {
      const minutes = Math.ceil((record.resetAt - now) / 60000);
      res.status(429);
      return res.render('error.njk', {
        status: 429,
        title: 'Too many attempts',
        heading: 'Too many attempts',
        message: `Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
      });
    }

    return next();
  };
}

/** Clear the counter for a key — call after a successful login. */
export function clearRateLimit(id) {
  attempts.delete(id);
}

// Keep the map from growing without bound on a long-running process.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, record] of attempts) if (now > record.resetAt) attempts.delete(id);
}, 10 * 60 * 1000);
sweeper.unref?.();
