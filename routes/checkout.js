// Checkout and order confirmation.

import express from 'express';
import { z } from 'zod';

import cart from '../lib/cart.js';
import orders from '../models/orders.js';
import stripe from '../lib/stripe.js';
import config from '../config.js';
import { validate, reRenderOnError } from '../lib/validate.js';
import { currentUser } from '../lib/auth.js';

const router = express.Router();

// UK postcode, loosely: enough to catch typos, not so strict that a valid
// edge case (GIR 0AA, BFPO) gets a customer stuck at the last step.
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$|^GIR\s*0AA$|^BFPO\s*\d{1,4}$/i;

const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  ship_name: z.string().trim().min(2, 'Enter the recipient name').max(120),
  ship_line1: z.string().trim().min(2, 'Enter the first line of the address').max(160),
  ship_line2: z.string().trim().max(160).optional().or(z.literal('')),
  ship_city: z.string().trim().min(2, 'Enter the town or city').max(80),
  // One refinement rather than a chain: zod reports the FIRST failing check,
  // so a long string would otherwise be rejected for its length with a message
  // that says nothing about postcodes.
  ship_postcode: z
    .string()
    .trim()
    .refine((value) => POSTCODE.test(value), { message: 'Enter a valid UK postcode' }),
  ship_phone: z.string().trim().max(32).optional().or(z.literal('')),

  // The only thing about money the customer gets to choose: HOW to pay, never
  // how much.
  payment_method: z.enum(['card', 'cod']).default('card'),
  // Note what is NOT here: no price, no total, no product name. Those come
  // from the database and nowhere else.
});

async function checkoutLocals(req) {
  return {
    basket: await cart.hydrate(req.session),
    codEnabled: config.cod.enabled,
    codFeePence: config.cod.feePence,
  };
}

router.get('/checkout', async (req, res, next) => {
  try {
    const basket = await cart.hydrate(req.session);

    if (basket.lines.length === 0) {
      return res.redirect('/cart');
    }

    const user = await currentUser(req);

    res.render('shop/checkout.njk', {
      basket,
      codEnabled: config.cod.enabled,
      codFeePence: config.cod.feePence,
      values: { email: user?.email ?? '', ship_name: user?.name ?? '', payment_method: 'card' },
      errors: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/checkout',
  validate(checkoutSchema, { onError: reRenderOnError('shop/checkout.njk', checkoutLocals) }),
  async (req, res, next) => {
    try {
      // Re-price from the database. Whatever the browser sent is ignored.
      const basket = await cart.hydrate(req.session);

      if (basket.lines.length === 0) {
        req.session.flash = { kind: 'error', message: 'Your basket is empty.' };
        return res.redirect('/cart');
      }

      if (basket.removed > 0) {
        req.session.flash = {
          kind: 'error',
          message: 'Some items are no longer available and were removed. Please review your basket.',
        };
        return res.redirect('/cart');
      }

      const user = await currentUser(req);
      const v = req.valid;

      // Cash on delivery is only ever what the server permits, not what the
      // form asked for: a disabled COD setting cannot be re-enabled by
      // posting payment_method=cod.
      const payingCash = v.payment_method === 'cod' && config.cod.enabled;

      if (!payingCash && !stripe.isConfigured()) {
        return res.status(503).render('shop/payments-unconfigured.njk', {
          basket,
          codEnabled: config.cod.enabled,
        });
      }

      const order = await orders.create({
        email: v.email,
        user_id: user?.id ?? null,
        lines: basket.lines,
        shipping_pence: basket.shipping_pence,
        payment_method: payingCash ? 'cod' : 'card',
        cod_fee_pence: payingCash ? config.cod.feePence : 0,
        ship: {
          name: v.ship_name,
          line1: v.ship_line1,
          line2: v.ship_line2 || null,
          city: v.ship_city,
          postcode: v.ship_postcode.toUpperCase(),
          country: 'GB',
          phone: v.ship_phone || null,
        },
      });

      // A cash order is complete as soon as it is recorded: there is nothing
      // to redirect to, and no payment to confirm until the courier hands it
      // over.
      if (payingCash) {
        cart.clear(req.session);
        req.session.recentOrders = [...(req.session.recentOrders ?? []), order.public_token].slice(-10);
        return req.session.save(() => res.redirect(303, `/order/${order.public_token}`));
      }

      const items = await orders.itemsFor(order.id);
      const session = await stripe.createCheckoutSession(order, items);
      await orders.attachStripeSession(order.id, session.id);

      // The order now holds the items, so the basket has done its job. Keeping
      // it would mean a customer who pays and then browses sees a stale basket.
      cart.clear(req.session);

      // Remember which orders this browser started, so a guest can find the
      // confirmation again without an account.
      req.session.recentOrders = [...(req.session.recentOrders ?? []), order.public_token].slice(-10);

      req.session.save(() => res.redirect(303, session.url));
    } catch (err) {
      next(err);
    }
  },
);

router.get('/order/:token', async (req, res, next) => {
  try {
    const order = await orders.getByToken(req.params.token);
    if (!order) return next();

    // A signed-in customer may only see their own orders; a guest may see any
    // order whose token they hold, which is the point of the token.
    const user = await currentUser(req);
    if (order.user_id && (!user || (order.user_id !== user.id && !user.is_admin))) {
      return next();
    }

    res.render('shop/order.njk', {
      order,
      // Arriving straight back from Stripe: the webhook may not have landed
      // yet, so the page says "processing" rather than claiming payment.
      justReturned: req.query.from === 'stripe',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
