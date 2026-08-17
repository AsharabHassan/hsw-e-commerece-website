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

  shippingPence: env.SHIPPING_PENCE,
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
