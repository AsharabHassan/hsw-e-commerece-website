// Basket routes.
//
// Every mutation is a POST followed by a redirect, so refreshing the basket
// page never re-submits the last action.

import express from 'express';
import { z } from 'zod';

import cart from '../lib/cart.js';
import products from '../models/products.js';
import { validate } from '../lib/validate.js';

const router = express.Router();

const lineSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().min(0).max(cart.MAX_QTY).default(1),
  // Present in the form so "Add to basket" on a product page returns there.
  redirect_to: z.string().startsWith('/').max(200).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const basket = await cart.hydrate(req.session);
    res.render('shop/cart.njk', {
      basket,
      cancelled: req.query.cancelled === '1',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/add', validate(lineSchema), async (req, res, next) => {
  try {
    const { product_id: productId, qty, redirect_to: redirectTo } = req.valid;

    const product = await products.getById(productId);

    // A placeholder is seeded demo content with an invented price. Letting one
    // into a basket is the first step towards charging someone for it.
    if (!product || !product.is_published || product.is_placeholder) {
      req.session.flash = {
        kind: 'error',
        message: 'That item is not available to buy.',
      };
      return res.redirect(redirectTo ?? '/shop');
    }

    cart.add(req.session, productId, qty || 1);
    req.session.flash = { kind: 'ok', message: `${product.name} added to your basket.` };

    res.redirect(redirectTo ?? '/cart');
  } catch (err) {
    next(err);
  }
});

router.post('/update', validate(lineSchema), (req, res) => {
  cart.update(req.session, req.valid.product_id, req.valid.qty);
  res.redirect('/cart');
});

router.post('/remove', validate(lineSchema), (req, res) => {
  cart.remove(req.session, req.valid.product_id);
  res.redirect('/cart');
});

router.post('/clear', (req, res) => {
  cart.clear(req.session);
  res.redirect('/cart');
});

export default router;
