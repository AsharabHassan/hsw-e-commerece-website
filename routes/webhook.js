// Stripe webhook.
//
// This is the ONLY place an order becomes paid. The browser redirect back from
// Stripe renders a page and changes nothing — otherwise anyone could mark
// their own order paid by visiting the success URL.
//
// Mounted with express.raw() before any body parser: signature verification
// needs the exact bytes Stripe signed, and a re-serialised JSON object is not
// byte-identical to what was sent.

import express from 'express';

import orders from '../models/orders.js';
import stripe from '../lib/stripe.js';

const router = express.Router();

router.post('/stripe', async (req, res) => {
  const signature = req.get('stripe-signature');

  if (!signature) {
    return res.status(400).send('Missing stripe-signature header');
  }

  let event;
  try {
    event = stripe.constructEvent(req.body, signature);
  } catch (err) {
    // Do not log the body: it is unverified and attacker-controlled.
    console.warn('Rejected Stripe webhook:', err.message);
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Stripe can emit this before the payment settles for delayed methods.
        if (session.payment_status !== 'paid') break;

        const orderId = Number(session.metadata?.order_id ?? session.client_reference_id);
        if (!Number.isInteger(orderId)) {
          console.warn('Stripe session with no usable order id:', session.id);
          break;
        }

        const paid = await orders.markPaid(orderId, {
          paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        });

        // markPaid is idempotent at the database level; a repeat delivery,
        // which Stripe explicitly permits, is a no-op rather than an error.
        console.log(paid ? `Order ${orderId} marked paid` : `Order ${orderId} was already paid`);
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        const orderId = Number(session.metadata?.order_id);
        if (Number.isInteger(orderId)) await orders.markPaid(orderId);
        break;
      }

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        const orderId = Number(session.metadata?.order_id);
        if (Number.isInteger(orderId)) {
          const order = await orders.getById(orderId);
          if (order?.status === 'pending') await orders.setStatus(orderId, 'cancelled');
        }
        break;
      }

      default:
        // Everything else is acknowledged and ignored, so Stripe stops
        // retrying events this shop does not act on.
        break;
    }

    res.json({ received: true });
  } catch (err) {
    // A 500 tells Stripe to retry, which is what we want if our database was
    // briefly unavailable.
    console.error('Error handling Stripe webhook:', err);
    res.status(500).send('Webhook handler failed');
  }
});

export default router;
