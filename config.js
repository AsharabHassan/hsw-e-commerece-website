// Configuration is parsed and validated once, at boot.
//
// A misconfigured deployment should fail immediately with a readable message,
// not at the customer's first checkout attempt.

import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default('http://localhost:3000'),

  // Absent => PGlite (dev/test). Present => real Postgres (production).
  DATABASE_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(16).optional(),

  // All optional. Absent means "payments not configured", which is a
  // handled state, not a crash.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // Session cookies are marked `secure` in production, which means the
  // browser only ever sends them over HTTPS. That is correct — and it makes
  // the site unusable over plain HTTP, so an IP-only staging box before TLS
  // is set up would let nobody log in.
  //
  // Set SECURE_COOKIES=false for that window ONLY. Anything a customer
  // touches must be HTTPS: over HTTP a session cookie crosses the network in
  // clear text and can be copied by anyone on the path.
  SECURE_COOKIES: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),

  // Cash on delivery. Set COD_ENABLED=false to withdraw it without a deploy.
  COD_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Handling fee for collecting cash, in PENCE. 425 = £4.25.
  // This must reflect a genuine cost of collecting cash rather than a penalty
  // for not paying by card.
  COD_FEE_PENCE: z.coerce.number().int().min(0).default(425),

  SHIPPING_PENCE: z.coerce.number().int().min(0).default(495),
  FREE_SHIPPING_OVER_PENCE: z.coerce.number().int().min(0).default(7500),

  STORE_NAME: z.string().default('Harley Street Wellness'),
  STORE_EMAIL: z.string().default('hello@harleystreetmedicalwellness.co.uk'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('\nInvalid configuration — refusing to start:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  console.error('\nSee .env.example for the full list of variables.\n');
  process.exit(1);
}

const env = parsed.data;
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.SESSION_SECRET) {
  console.error('\nSESSION_SECRET is required in production.');
  console.error('Generate one with:  openssl rand -hex 32\n');
  process.exit(1);
}

if (isProd && !env.DATABASE_URL) {
  console.error('\nDATABASE_URL is required in production.');
  console.error('PGlite is a development convenience and must not be used to serve customers.\n');
  process.exit(1);
}

export default {
  env: env.NODE_ENV,
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  baseUrl: env.BASE_URL.replace(/\/+$/, ''),
  databaseUrl: env.DATABASE_URL,
  sessionSecret: env.SESSION_SECRET ?? 'dev-only-insecure-session-secret',

  // Defaults to "secure in production". Only an explicit SECURE_COOKIES=false
  // turns it off, so it cannot happen by accident.
  secureCookies: env.SECURE_COOKIES ?? isProd,

  shippingPence: env.SHIPPING_PENCE,

  cod: {
    enabled: env.COD_ENABLED,
    feePence: env.COD_FEE_PENCE,
  },
  freeShippingOverPence: env.FREE_SHIPPING_OVER_PENCE,

  storeName: env.STORE_NAME,
  storeEmail: env.STORE_EMAIL,

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY,
    configured: Boolean(env.STRIPE_SECRET_KEY),
  },
};
