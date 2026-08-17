// Double-submit CSRF protection.
//
// A random token is minted per session, rendered into every form, and required
// on every state-changing request. `csurf` is deprecated and unmaintained, and
// the mechanism is thirty lines, so it lives here where it can be read.

import { randomBytes, timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Stripe signs its own webhooks and cannot send our token; that route does its
// own, stronger, verification.
const EXEMPT = [/^\/webhooks\//];

function mint() {
  return randomBytes(32).toString('hex');
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Reject a request whose token does not match the session's. */
export function enforceCsrf(req, res, next) {
  const supplied = req.body?._csrf ?? req.get('x-csrf-token');

  if (!equal(supplied, req.session?.csrfToken)) {
    res.status(403);
    return res.render('error.njk', {
      title: 'Request blocked',
      heading: 'That request could not be verified',
      message:
        'Your session may have expired, or the page was open for a long time. Go back, reload the page and try again.',
      status: 403,
    });
  }

  return next();
}

export function csrf(req, res, next) {
  if (!req.session) return next(new Error('csrf middleware requires a session'));

  if (!req.session.csrfToken) req.session.csrfToken = mint();
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT.some((re) => re.test(req.path))) return next();

  // Multipart bodies have not been parsed yet — multer runs later, inside the
  // route — so there is no token to read here. Those routes call enforceCsrf
  // themselves immediately after multer, and discard the uploaded file if the
  // check fails. The only such route is the admin image upload.
  if (req.is('multipart/form-data')) return next();

  return enforceCsrf(req, res, next);
}

/** Rotate the token — call after login, alongside session regeneration. */
export function rotateCsrf(req) {
  req.session.csrfToken = mint();
  return req.session.csrfToken;
}
