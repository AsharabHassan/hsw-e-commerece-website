// Legal pages.
//
// These are not optional decoration. Stripe will not activate an account
// without terms, a privacy policy and a refunds policy, and the Consumer
// Contracts Regulations require a distance seller to state the 14-day
// cancellation right before purchase.
//
// The copy carries visible TBD markers wherever it needs a real company
// detail. Inventing a company number or a registered address would be worse
// than leaving the gap visible.

import express from 'express';

const router = express.Router();

const PAGES = {
  terms: { view: 'legal/terms.njk', title: 'Terms of Sale' },
  privacy: { view: 'legal/privacy.njk', title: 'Privacy Policy' },
  'shipping-returns': { view: 'legal/shipping-returns.njk', title: 'Delivery & Returns' },
};

for (const [path, page] of Object.entries(PAGES)) {
  router.get(`/${path}`, (req, res) => {
    res.render(page.view, { pageTitle: page.title, updated: 'August 2026' });
  });
}

export default router;
