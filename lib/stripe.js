// Stripe integration.
//
// Card details never touch this server: the customer is redirected to Stripe's
// hosted Checkout page and comes back. That keeps PCI scope to SAQ-A, which is
// the difference between filling in a short self-assessment and having your
// server audited.
//
// The whole module tolerates missing keys. With no secret key the shop still
// runs, browses and builds baskets; only the final step reports that payments
// are not configured.

import Stripe from 'stripe';

import config from '../config.js';

let client = null;

function stripeClient() {
  if (overrides) return overrides;
  if (!config.stripe.configured) {
    throw new Error('Stripe is not configured (STRIPE_SECRET_KEY is unset)');
  }
  if (!client) {
    client = new Stripe(config.stripe.secretKey, {
      apiVersion: '2024-12-18.acacia',
      appInfo: { name: 'HSW Store' },
      maxNetworkRetries: 2,
    });
  }
  return client;
}

// Test seam.
//
// The most important property of this module is that the line items sent to
// Stripe are the ones the database recorded. Proving that requires observing
// the call, and the alternative — experimental ESM module mocking behind a
// runtime flag — is more machinery than one injected object.
let overrides = null;

/** @internal Used by the test suite. Pass null to restore real behaviour. */
export function _setClientForTests(fake) {
  overrides = fake;
  client = null;
}

export const isConfigured = () => Boolean(overrides) || config.stripe.configured;

/**
 * Create a hosted Checkout Session for an order.
 *
 * Line items are built from the SNAPSHOTTED order rows, so what Stripe charges
 * is by construction the same as what the database recorded.
 *
 * @param {object} order
 * @param {{name_snapshot: string, unit_price_pence: number, qty: number}[]} items
 * @returns {Promise<{id: string, url: string}>}
 */
export async function createCheckoutSession(order, items) {
  const stripe = stripeClient();

  const lineItems = items.map((item) => ({
    quantity: item.qty,
    price_data: {
      currency: 'gbp',
      unit_amount: item.unit_price_pence,
      product_data: { name: item.name_snapshot },
    },
  }));

  if (order.shipping_pence > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: order.shipping_pence,
        product_data: { name: 'Tracked UK delivery' },
      },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: order.email,

    // The order is already in our database; this is how the webhook finds it.
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id), public_token: order.public_token },

    success_url: `${config.baseUrl}/order/${order.public_token}?from=stripe`,
    cancel_url: `${config.baseUrl}/cart?cancelled=1`,

    // Distance-selling rules require the customer to see the terms before
    // paying; Stripe surfaces these on the Checkout page.
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: {
        message: `I agree to the [Terms of Sale](${config.baseUrl}/terms) and [Privacy Policy](${config.baseUrl}/privacy).`,
      },
    },
  });

  return { id: session.id, url: session.url };
}

/**
 * Verify and parse a webhook payload.
 *
 * @param {Buffer} rawBody the exact bytes Stripe signed — not a parsed object
 * @param {string} signature the stripe-signature header
 * @returns {import('stripe').Stripe.Event}
 * @throws if the signature does not verify
 */
export function constructEvent(rawBody, signature) {
  if (!config.stripe.webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set; refusing to trust webhook payloads');
  }
  return stripeClient().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

/** Look a session back up, e.g. to recover a payment intent id. */
export async function retrieveSession(sessionId) {
  return stripeClient().checkout.sessions.retrieve(sessionId);
}

export default { isConfigured, createCheckoutSession, constructEvent, retrieveSession };
