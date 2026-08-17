// Customer accounts: register, sign in, order history.
//
// Accounts are optional. Guest checkout is the default path, and registering
// later claims any past orders placed with the same email address.

import express from 'express';
import { z } from 'zod';

import users from '../models/users.js';
import orders from '../models/orders.js';
import { login, logout, requireUser, rateLimit, clearRateLimit } from '../lib/auth.js';
import { validate, reRenderOnError } from '../lib/validate.js';

const router = express.Router();

/** Only ever redirect to a path on this site. */
function safeNext(value) {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/account';
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  next: z.string().optional(),
});

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name').max(120),
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    password: z.string().min(10, 'Use at least 10 characters').max(200),
    password_confirm: z.string(),
    next: z.string().optional(),
  })
  .refine((data) => data.password === data.password_confirm, {
    path: ['password_confirm'],
    message: 'The passwords do not match',
  });

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/account');
  res.render('account/login.njk', { values: {}, errors: {}, next: safeNext(req.query.next) });
});

router.post(
  '/login',
  rateLimit({ max: 10, key: (req) => `login:${req.ip}:${req.body?.email ?? ''}` }),
  validate(credentialsSchema, {
    onError: reRenderOnError('account/login.njk', (req) => ({ next: safeNext(req.body?.next) })),
  }),
  async (req, res, next) => {
    try {
      const user = await users.verify(req.valid.email, req.valid.password);

      if (!user) {
        // One message for both an unknown address and a wrong password: the
        // form must not tell an attacker which emails have accounts.
        return res.status(401).render('account/login.njk', {
          values: { email: req.valid.email },
          errors: { _: 'Those details were not recognised.' },
          next: safeNext(req.valid.next),
        });
      }

      clearRateLimit(`login:${req.ip}:${req.valid.email}`);
      await login(req, user);

      res.redirect(safeNext(req.valid.next));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/account');
  res.render('account/register.njk', { values: {}, errors: {}, next: safeNext(req.query.next) });
});

router.post(
  '/register',
  rateLimit({ max: 10, key: (req) => `register:${req.ip}` }),
  validate(registerSchema, {
    onError: reRenderOnError('account/register.njk', (req) => ({ next: safeNext(req.body?.next) })),
  }),
  async (req, res, next) => {
    try {
      const { name, email, password } = req.valid;

      if (await users.emailTaken(email)) {
        return res.status(409).render('account/register.njk', {
          values: { name, email },
          errors: { email: 'An account already exists for that address. Sign in instead.' },
          next: safeNext(req.valid.next),
        });
      }

      const user = await users.create({ name, email, password });

      // Claim any guest orders placed with this address.
      const claimed = await users.linkGuestOrders(user.id, email);

      await login(req, user);

      req.session.flash = {
        kind: 'ok',
        message: claimed
          ? `Account created. ${claimed} previous order${claimed === 1 ? '' : 's'} added to your history.`
          : 'Account created.',
      };

      res.redirect(safeNext(req.valid.next));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

router.post('/logout', async (req, res, next) => {
  try {
    await logout(req);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Order history
// ---------------------------------------------------------------------------

router.get('/', requireUser, async (req, res, next) => {
  try {
    res.render('account/index.njk', {
      orders: await orders.listForUser(res.locals.user.id),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', requireUser, async (req, res, next) => {
  try {
    const order = await orders.getById(Number(req.params.id));

    // Someone else's order is indistinguishable from one that does not exist.
    if (!order || order.user_id !== res.locals.user.id) return next();

    res.render('account/order.njk', { order });
  } catch (err) {
    next(err);
  }
});

export default router;
