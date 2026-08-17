// Express application assembly.
//
// server.js only calls createApp() and listens, so tests can drive the app
// through supertest without binding a port.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import nunjucks from 'nunjucks';

import config from './config.js';
import { migrate } from './db/migrate.js';
import PgSessionStore from './lib/session-store.js';
import { csrf } from './lib/csrf.js';
import { formatPence, penceToInput } from './lib/money.js';
import cart from './lib/cart.js';

import categories from './models/categories.js';
import users from './models/users.js';

import shopRoutes from './routes/shop.js';
import cartRoutes from './routes/cart.js';
import checkoutRoutes from './routes/checkout.js';
import webhookRoutes from './routes/webhook.js';
import accountRoutes from './routes/account.js';
import adminRoutes from './routes/admin.js';
import legalRoutes from './routes/legal.js';
import sitemapRoutes from './routes/sitemap.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {{runMigrations?: boolean}} [options]
 * @returns {Promise<import('express').Express>}
 */
export async function createApp({ runMigrations = true } = {}) {
  if (runMigrations) await migrate();

  const app = express();

  // nginx terminates TLS; without this, secure cookies are never set and
  // req.ip is always the proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------
  const env = nunjucks.configure(path.join(ROOT, 'views'), {
    autoescape: true,
    express: app,
    // noCache alone re-reads templates on every render in development.
    // `watch` would additionally require chokidar, for no benefit here.
    noCache: !config.isProd,
  });

  env.addFilter('money', formatPence);

  // Customer-facing order reference: the first 8 characters of the public
  // token. Nunjucks has no slice syntax, so this is a filter rather than
  // something templates try to express inline.
  env.addFilter('orderRef', (token) => String(token ?? '').slice(0, 8).toUpperCase());

  env.addFilter('poundsInput', penceToInput);
  env.addFilter('date', (value, opts = {}) =>
    value
      ? new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'medium',
          ...(opts.withTime ? { timeStyle: 'short' } : {}),
        }).format(new Date(value))
      : '',
  );
  // Story-block text is sanitised on save (lib/sanitize.js), so it is safe to
  // mark as HTML here. Nothing else in the codebase uses this filter.
  env.addFilter('inline', (value) => new nunjucks.runtime.SafeString(value ?? ''));

  app.set('view engine', 'njk');

  // -------------------------------------------------------------------------
  // Security headers
  // -------------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // The brand fonts are served by Google; the layout carries one
          // inline bootstrap script for the anti-flash theme switch.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          // Stripe Checkout is a full redirect, so no frame or connect
          // permissions are needed for it.
          formAction: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      hsts: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // -------------------------------------------------------------------------
  // Stripe webhook — MUST be mounted before express.urlencoded/json, because
  // signature verification needs the exact raw bytes Stripe signed.
  // -------------------------------------------------------------------------
  app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

  // -------------------------------------------------------------------------
  // Body parsing, static files, sessions
  // -------------------------------------------------------------------------
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(
    express.static(path.join(ROOT, 'public'), {
      maxAge: config.isProd ? '365d' : 0,
      etag: true,
    }),
  );

  const sessionStore = new PgSessionStore();
  app.locals.sessionStore = sessionStore;

  app.use(
    session({
      name: 'hsw.sid',
      store: sessionStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.isProd,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // -------------------------------------------------------------------------
  // Locals every template can rely on.
  //
  // This runs BEFORE the CSRF check, because a rejected request still renders
  // a page, and that page still needs the site chrome.
  // -------------------------------------------------------------------------
  app.use(async (req, res, next) => {
    try {
      res.locals.currentPath = req.path;
      res.locals.baseUrl = config.baseUrl;
      res.locals.storeName = config.storeName;
      res.locals.storeEmail = config.storeEmail;
      res.locals.freeShippingOver = config.freeShippingOverPence;
      res.locals.shippingPence = config.shippingPence;
      res.locals.year = new Date().getFullYear();
      res.locals.stripeConfigured = config.stripe.configured;

      res.locals.cartCount = cart.count(req.session);
      res.locals.navCategories = await categories.list();

      res.locals.user = req.session?.userId ? await users.getById(req.session.userId) : null;

      // One-shot flash message, consumed on render.
      res.locals.flash = req.session?.flash ?? null;
      if (req.session?.flash) delete req.session.flash;

      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(csrf);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  app.use('/', sitemapRoutes);
  app.use('/', legalRoutes);
  app.use('/account', accountRoutes);
  app.use('/admin', adminRoutes);
  app.use('/cart', cartRoutes);
  app.use('/', checkoutRoutes);
  app.use('/', shopRoutes);

  // -------------------------------------------------------------------------
  // 404 and error handling
  // -------------------------------------------------------------------------
  app.use((req, res) => {
    res.status(404).render('error.njk', {
      status: 404,
      title: 'Page not found',
      heading: 'We could not find that page',
      message: 'The link may be out of date, or the product may no longer be listed.',
    });
  });

  // eslint-disable-next-line no-unused-vars -- Express identifies error
  // handlers by arity; the 4th parameter must be present.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).render('error.njk', {
      status: err.status || 500,
      title: 'Something went wrong',
      heading: 'Something went wrong at our end',
      message: config.isProd
        ? 'The error has been logged. Please try again, or contact us if it keeps happening.'
        : err.stack,
    });
  });

  return app;
}

export default createApp;
